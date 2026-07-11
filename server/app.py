"""
Ghar server — T8 (/variants) + T15 (/brief), per docs/CONTRACT.md (the contract is LAW).

Run:  cd server && uvicorn app:app --host 0.0.0.0 --port 8000
Env:  GEMINI_API_KEY (required), IMAGE_MODEL (default gemini-3.1-flash-image),
      BRIEF_MODEL (default gemini-3.5-flash)

SDK shapes verified against official docs 2026-07-11:
  https://ai.google.dev/gemini-api/docs/generate-content/image-generation
    client.models.generate_content(model="gemini-3.1-flash-image", contents=[prompt, image])
    -> iterate response.parts, part.inline_data holds the image bytes
  https://ai.google.dev/gemini-api/docs/generate-content/google-search
    types.Tool(google_search=types.GoogleSearch()) inside GenerateContentConfig, response.text
"""

import asyncio
import base64
import json
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------- paths / env

SERVER_DIR = Path(__file__).resolve().parent
STATIC_DIR = SERVER_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
BRIEF_CACHE_PATH = STATIC_DIR / "brief_cache.json"


def _load_dotenv() -> None:
    """Tiny .env loader (repo root or server/) so we don't need python-dotenv."""
    for candidate in (SERVER_DIR.parent / ".env", SERVER_DIR / ".env"):
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_dotenv()

# google-genai SDK — lazy client so the app still starts (and /brief cache still
# works) without a key on the machine.
try:
    from google import genai
    from google.genai import types
except ImportError:  # pragma: no cover
    genai = None
    types = None

_client = None


def _get_client():
    global _client
    if _client is None:
        if genai is None:
            raise RuntimeError("google-genai not installed: pip install google-genai")
        # genai.Client() reads GEMINI_API_KEY from the environment (per docs).
        _client = genai.Client()
    return _client


def _image_model() -> str:
    # Read at call time so T3 can flip it via env without code changes.
    return os.environ.get("IMAGE_MODEL", "gemini-3.1-flash-image")


def _brief_model() -> str:
    return os.environ.get("BRIEF_MODEL", "gemini-3.5-flash")


# ---------------------------------------------------------------- prompts (docs/PROMPTS.md §3, §6)

EDIT_WRAPPER = (
    "Edit this photograph of a real room. {description}. "
    "Change ONLY the element(s) described. Keep the room's identity intact: same walls, "
    "same window, same floor, same camera angle, same perspective, same time of day. "
    "Photorealistic, natural lighting consistent with the original photo. "
    "This must still be recognizably the same room."
)

VARIANT_SUFFIXES = [
    ", in a warm minimal style with natural materials",
    ", in a contemporary Indian style with cane and block-print textiles",
    ", in a bold color-forward style",
    ", in a budget-friendly style using affordable materials",
]

BRIEF_PROMPT = """You are preparing an architect brief for a room redesign in Bengaluru, India.
DESIGN: {description}
OBJECTS TO SOURCE: {objects}

Return strict JSON (no markdown fences, no commentary) with exactly this shape:
{{
  "budget": [
    {{ "item": "string", "estimate_inr": 12500, "source_url": "https://... or null", "note": "estimate" }}
  ],
  "total_estimate_inr": 48000,
  "legal": [
    {{ "step": "string", "required": true, "detail": "string" }}
  ]
}}
1. "budget": for each object, a realistic Indian market price ESTIMATE in INR and a real vendor
   link found via search (prefer Pepperfry, Urban Ladder, IKEA India, Wakefit). Mark every price
   "estimate". If no good link is found, give the estimate with source_url null — never invent URLs.
2. "legal": the approval checklist for this renovation scope in a typical Bengaluru apartment
   society — painting/decor only -> usually no NOC; any civil/structural/electrical work -> society
   NOC (form + notice period), licensed electrician certificate, working-hours rules, debris
   disposal. Include only steps relevant to THIS scope. required: true/false per step.
Keep it to 5-8 budget lines and 4-6 legal steps. This will be read on a phone screen.
"""

# ---------------------------------------------------------------- app

app = FastAPI(title="Ghar server")

# Phone hits the laptop over hotspot LAN — allow everything.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# In-memory batch state: batch_id -> [ {slot, status, url}, x4 ]. No DB, no auth.
BATCHES: dict[str, list[dict]] = {}
_bg_tasks: set = set()  # keep refs so background tasks aren't GC'd


class VariantsRequest(BaseModel):
    description: str
    keyframe_b64: str


class BriefRequest(BaseModel):
    description: str
    objects: list[str]


# ---------------------------------------------------------------- /variants

def _decode_keyframe(b64: str) -> bytes:
    # Tolerate a data-URL prefix from the browser ("data:image/jpeg;base64,....").
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


def _edit_image_sync(prompt: str, image_bytes: bytes) -> bytes:
    """One NB2 edit call. Blocking — run via asyncio.to_thread.

    Docs (image-generation, generateContent flavor) show contents=[prompt, PIL_image];
    types.Part.from_bytes is the SDK's byte-input equivalent (same docs site, image
    understanding pages). VERIFY AGAINST DOCS if the SDK rejects the Part input.
    """
    client = _get_client()
    response = client.models.generate_content(
        model=_image_model(),
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            prompt,
        ],
    )
    for part in response.parts:
        if getattr(part, "inline_data", None) is not None and part.inline_data.data:
            data = part.inline_data.data
            if isinstance(data, str):  # defensive: some SDK versions return base64 str
                data = base64.b64decode(data)
            return data
    raise RuntimeError("model returned no image part")


async def _run_slot(batch_id: str, slot: int, description: str, image_bytes: bytes) -> None:
    prompt = EDIT_WRAPPER.format(description=description) + VARIANT_SUFFIXES[slot]
    try:
        out = await asyncio.to_thread(_edit_image_sync, prompt, image_bytes)
        filename = f"{batch_id}_{slot}.jpg"
        (STATIC_DIR / filename).write_bytes(out)
        BATCHES[batch_id][slot] = {"slot": slot, "status": "done", "url": f"/static/{filename}"}
    except Exception as exc:  # noqa: BLE001 — demo: fail the slot, never the batch
        print(f"[variants] {batch_id} slot {slot} FAILED: {exc}")
        BATCHES[batch_id][slot] = {"slot": slot, "status": "failed", "url": None}


async def _run_batch(batch_id: str, description: str, image_bytes: bytes) -> None:
    t0 = time.time()
    await asyncio.gather(*(_run_slot(batch_id, s, description, image_bytes) for s in range(4)))
    done = sum(1 for i in BATCHES[batch_id] if i["status"] == "done")
    print(f"[variants] {batch_id}: {done}/4 done in {time.time() - t0:.1f}s")


@app.post("/variants")
async def post_variants(req: VariantsRequest):
    try:
        image_bytes = _decode_keyframe(req.keyframe_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="keyframe_b64 is not valid base64")

    batch_id = f"b_{uuid.uuid4().hex[:8]}"
    BATCHES[batch_id] = [{"slot": s, "status": "pending", "url": None} for s in range(4)]

    task = asyncio.create_task(_run_batch(batch_id, req.description, image_bytes))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

    # Contract: immediate (<500ms), before any image exists.
    return {"batch_id": batch_id, "count": 4}


@app.get("/variants/{batch_id}")
async def get_variants(batch_id: str):
    if batch_id not in BATCHES:
        raise HTTPException(status_code=404, detail="unknown batch_id")
    return {"batch_id": batch_id, "images": BATCHES[batch_id]}


# ---------------------------------------------------------------- /brief

def _extract_json(text: str) -> dict:
    """Robustly pull a JSON object out of model text (strip ``` fences etc.)."""
    text = re.sub(r"```(?:json)?", "", text).strip().strip("`")
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output: {text[:200]!r}")
    return json.loads(text[start : end + 1])


def _brief_call_sync(description: str, objects: list[str]) -> dict:
    """ONE grounded text call. Shape verified against docs/generate-content/google-search."""
    client = _get_client()
    response = client.models.generate_content(
        model=_brief_model(),
        contents=BRIEF_PROMPT.format(description=description, objects=", ".join(objects)),
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    brief = _extract_json(response.text)
    # Minimal shape guard against the CONTRACT.md schema.
    if "budget" not in brief or "legal" not in brief:
        raise ValueError("brief JSON missing budget/legal keys")
    brief.setdefault(
        "total_estimate_inr",
        sum(int(line.get("estimate_inr") or 0) for line in brief["budget"]),
    )
    return brief


@app.post("/brief")
async def post_brief(req: BriefRequest):
    # Demo path: the cache IS the demo, the live call is the fallback (T15).
    if BRIEF_CACHE_PATH.exists():
        return json.loads(BRIEF_CACHE_PATH.read_text())

    try:
        brief = await asyncio.to_thread(_brief_call_sync, req.description, req.objects)
    except Exception as exc:  # noqa: BLE001
        print(f"[brief] live call FAILED: {exc}")
        # Last-ditch: ship the committed example so the demo never dies on stage.
        example = STATIC_DIR / "brief_cache_example.json"
        if example.exists():
            return json.loads(example.read_text())
        raise HTTPException(status_code=502, detail=f"brief generation failed: {exc}")

    BRIEF_CACHE_PATH.write_text(json.dumps(brief, indent=2, ensure_ascii=False))
    return brief


@app.get("/")
async def root():
    return {"ok": True, "image_model": _image_model(), "brief_model": _brief_model()}
