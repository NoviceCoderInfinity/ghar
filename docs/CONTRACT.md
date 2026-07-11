# CONTRACT.md — the seam between Anupam's web/ and Abhishek's server/
# LOCKED at MERGE M1 (12:45). After that, changes only when both devs are physically paired.

## Architecture (who calls what)

```
Phone browser (web/)
 ├─ Live API session (gemini-3.1-flash-live-preview)  ← Anupam
 │    mic + camera frames up, voice down, function calls emitted client-side
 ├─ Tool dispatcher (web/src/tools.ts)                ← Anupam
 │    on generate_variants → POST server /variants (with latest camera keyframe)
 │    on play_scene       → play local clip demo/clips/<scene>.mp4
 │    every event         → append to brain-feed store
 ├─ Rail component (web/src/components/rail/)         ← Abhishek
 └─ Brain feed panel                                  ← Anupam

FastAPI (server/)                                     ← Abhishek
 ├─ POST /variants  → 4 parallel NB2 Lite edit calls → static URLs
 ├─ GET  /static/*  → generated images
 └─ scripts/prerender.py → Omni Flash clips → demo/clips/   (run in background, NOT a live endpoint)
```

## Function declarations (Live session tools) — exact shapes

```json
{
  "name": "generate_variants",
  "description": "Generate 4 redesign variants of what the camera currently sees. Call this whenever the conversation has produced a concrete design direction — do not ask permission, just call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "One-sentence design direction, e.g. 'replace the armchair with a rattan chair, warm neutral palette, keep everything else identical'"
      }
    },
    "required": ["description"]
  }
}
```

```json
{
  "name": "play_scene",
  "description": "Play a cinematic video of the currently selected design. Call when the user asks to see the room 'in the evening', 'at golden hour', 'in the monsoon', or 'living in it'.",
  "parameters": {
    "type": "object",
    "properties": {
      "scene": { "type": "string", "enum": ["evening", "monsoon"] }
    },
    "required": ["scene"]
  }
}
```

## HTTP contract

### POST /variants
Request:
```json
{ "description": "string (from the tool call)", "keyframe_b64": "string (jpeg, current camera frame)" }
```
Response — **immediate** (< 500ms), before images exist:
```json
{ "batch_id": "b_123", "count": 4 }
```
### GET /variants/{batch_id}
Poll every 1s (rail does this):
```json
{ "batch_id": "b_123",
  "images": [
    { "slot": 0, "status": "done",    "url": "/static/b_123_0.jpg" },
    { "slot": 1, "status": "pending", "url": null },
    { "slot": 2, "status": "done",    "url": "/static/b_123_2.jpg" },
    { "slot": 3, "status": "failed",  "url": null }
  ] }
```
Rail renders 4 placeholder tiles the moment the tool call fires (from the brain-feed store event),
fills each tile as its slot goes `done`, quietly hides `failed` slots.

## Brain-feed event store (client-side, web/src/state/events.ts) — Anupam owns, Abhishek reads
```ts
type FeedEvent =
  | { kind: "observation"; text: string; t: number }        // 👁 model noticed something
  | { kind: "tool_call"; name: string; args: object; t: number }  // 🔧 self-initiated call
  | { kind: "images"; batchId: string; done: number; ms: number; t: number } // 🖼
  | { kind: "note"; text: string; t: number };              // 📝 (stretch: preferences)
```

## Mock (Anupam uses until M2)
`web/src/tools.ts` has `USE_MOCK = true` → generate_variants resolves after 3s with
`demo/fixtures/mock_0..3.jpg`. Abhishek commits 4 real NB2 outputs of the corner as the mock
images by 1:15 so even the mock looks impressive. Flip `USE_MOCK = false` at M2.

## Env
```
GEMINI_API_KEY=            # both machines, from event credits
SERVER_URL=http://<anupam-laptop-LAN-ip>:8000   # phone must reach the server over hotspot LAN
```
NOTE: server runs on Anupam's laptop for the demo (phone + laptop on the same hotspot).
Abhishek develops on his machine, deploys by `git pull` on Anupam's at M2/M3.
