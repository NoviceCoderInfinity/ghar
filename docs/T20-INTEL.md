# T20-INTEL.md — live probe results for the DREAM-mode server path (for Abhishek)
# Probed 2026-07-11 afternoon against the running server on Anupam's laptop, real API key.
# STUDIO path is PROVEN on this machine: POST /variants → 4/4 slots done in 14.1s wall
# (immediate return in 0.021s, 3/4 done at 12.1s). /brief serves the armed cache in 0.055s.

## What happens today when there is no keyframe (both cases verified live)

1. `keyframe_b64: null` → **422 before your handler runs.** Pydantic rejects it because
   `VariantsRequest.keyframe_b64` is typed plain `str` (app.py ~line 146):
   ```json
   {"detail":[{"type":"string_type","loc":["body","keyframe_b64"],
     "msg":"Input should be a valid string","input":null}]}
   ```
2. `keyframe_b64: ""` → passes validation (b64decode("") == b""), batch is created, then
   `_edit_image_sync` sends empty image bytes and ALL 4 slots fail in 0.8s with:
   ```
   400 INVALID_ARGUMENT: "Unable to process input image."
   ```
   (Per-slot try/except isolates it — batch survives, rail would just show nothing.)

## The T20 fix, exactly
1. `VariantsRequest`: `keyframe_b64: str | None = None`.
2. In `_run_slot` (or `_edit_image_sync`): when there are no image bytes, branch to a
   text-to-image GENERATION call — same model, contents=[prompt] with no image Part — using a
   GENERATION wrapper instead of EDIT_WRAPPER, e.g.:
   "Photorealistic interior render, Indian home context. {description}. Natural light,
   realistic materials and proportions, eye-level view, 16:9."
   Keep the same 4 VARIANT_SUFFIXES so the rail stays stylistically consistent.
3. Client already sends `keyframe_b64: null` when the camera is off (tools.ts patched — T21
   done). No frontend change needed once the server accepts null.

## Notes
- The web dispatcher never blocks on a missing frame anymore; it logs "DREAM mode generation"
  and posts null. Mode detection = null keyframe. No new endpoint, no contract change beyond
  the nullable field.
- Latency planning: expect text-to-image ≈ image-edit latency (~10-14s for 4 parallel) — the
  three-beat wait narration already covers it.
