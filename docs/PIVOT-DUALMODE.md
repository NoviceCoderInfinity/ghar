# PIVOT-DUALMODE.md — scope pivot (2026-07-11, afternoon). This OVERRIDES phone-first
# assumptions in PLAN.md / TASKBOARD.md / DEMO_RUNBOOK.md where they conflict. Delta, not rewrite.

## What changed and why
1. **Laptop-first, phone optional.** All testing AND the demo run on the laptop (built-in mic +
   webcam, localhost server). Kills the hotspot/LAN/mobile-layout risk class entirely. Phone is
   a stretch goal only if everything else is green.
2. **Two modes, one designer.** The product is no longer only camera-heavy "refurbish my room":
   - **STUDIO mode (Anupam owns — existing setup):** camera on, Asha sees the room, variants
     edit the live keyframe. Unchanged pipeline.
   - **DREAM mode (Abhishek owns — NEW):** no visual input. User just TALKS ("a 2BHK living
     room, north-facing, Japandi, two lakhs") and Asha generates concept images from the
     conversation alone. For new plots, empty rooms, pre-purchase imagination.
   Pitch upgrade: "Point the camera at what exists, or just describe what doesn't yet."

## Architecture impact (small, by design)
- DREAM mode = the SAME `generate_variants(description)` tool + rail. Delta:
  - `/variants` accepts `keyframe_b64: null` → text-to-image generation (no edit wrapper);
    use a GENERATION prompt wrapper (photoreal interior, Indian context, 16:9) instead of the
    edit wrapper. Same batch/poll contract, same rail. **(Abhishek, server)**
  - Dispatcher: when no camera frame is available, send `keyframe_b64: null` instead of
    erroring. **(Anupam, ~5 lines in tools.ts — currently it early-returns on null keyframe)**
  - Persona: one paragraph telling Asha to interview for plot/size/light/budget when there is
    no camera, then call generate_variants with a rich self-composed description. **(either)**
  - Mode = presence/absence of webcam feed. No toggle UI needed; a small "Dream mode" badge
    when video is off is enough.

## Task delta
| ID | Task | Owner | Status |
|---|---|---|---|
| T20 | `/variants` null-keyframe → text-to-image path + generation wrapper | Abhishek | NEW |
| T21 | Dispatcher null-keyframe passthrough + Dream badge | Anupam | NEW (15 min) |
| T22 | Persona §DREAM paragraph + interview flow | Anupam (persona file) | NEW (15 min) |
| — | T14 mobile pass | Abhishek | DESCOPED → laptop layout sanity only |
| — | T13 language switch | Anupam | unchanged (stretch) |
| — | T19 splat gateway | Abhishek | unchanged (tonight's go/no-go) |

## Demo loop v3 (laptop, ~1:45, both modes)
1. Laptop webcam on the corner → Asha speaks first, observation. (STUDIO)
2. Judge interrupts; Asha pivots. Self-initiated generate_variants → rail fills (~13s, three-beat
   narration covers it).
3. "Show me the evening" → cached Omni clip.
4. **Camera off. "Now — I just bought a bare 2BHK in Whitefield, nothing in it. Japandi, two
   lakhs."** → Asha interviews (one question), then rail fills with pure-imagination concepts. (DREAM)
5. "Send it to my architect" → Brief screen. Close on the brain feed.

## Runbook overrides
- Connectivity: localhost — no hotspot needed for the loop (hotspot only as wifi backup for API calls).
- "Hand the judge the phone" beats → "slide the laptop to the judge / hand them the mic".
- DoDs saying "on the phone over hotspot" → "in the laptop browser".
