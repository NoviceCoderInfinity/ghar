# Ghar — describe a home, argue with your designer, walk through it

Designing a home today means typing prompts at a picture. Ghar deletes the prompt box: you
*talk* to Asha, a live AI interior designer. Describe the home you're dreaming of — "3BHK,
living room with a dining table, a gym room, modern techy vibe" — and she asks at most two
questions, sketches four concepts for the hero room, locks the style you pick by voice, then
designs the rest of the home **one room at a time in that style**, playing a cinematic
narrated tour of each room as it's confirmed. Interrupt her mid-tour with a change and she
refines the same design without losing its identity. When you say "send it to my architect",
she compiles the **Build Pack** — concept floor plan, room-by-room spec, budget, materials,
approvals checklist. Already have a room? Show it on camera or upload a photo and she
refurbishes that instead. One Live API session drives everything — the conversation is the
interface.

**Short demo:** https://youtu.be/y6zc4YT8a3E
**Detailed end-to-end demo:** https://youtu.be/1Mt2bvL1mV4

**Track:** PS1 (Real-Time Multimodal Interaction, Live API), with depth evidence for PS3 (NB2
throughput — 4 parallel concepts per turn, plan renders) and PS4 (NB2 → Omni chain — every
tour clip is an NB2 concept handed to Omni Flash).

## The three ways in (one designer, no mode switch)

1. **Design my home** (the hero) — no camera, no photo. A detailed spoken description →
   `imagine_space` text-to-image concepts → pick a style by voice → per-room design → per-room
   `generate_tour` with Asha narrating as a home tour guide → "▶ Tour whole home" plays every
   locked room back-to-back → "✓ Finish home" / "prepare my architect pack" → the Build Pack.
2. **Fix it** (upload) — a photo of your real room becomes the edit base; `generate_variants`
   refurbishes it: compliment → opportunity → concrete suggestion with a rupee range.
3. **See it** (live camera) — same as Fix-it but grounded in the live frame Asha is watching.

Asha never announces modes; she just uses whatever you give her.

## Architecture

```
Laptop browser (web/)
 ├─ Live API session (gemini-3.1-flash-live-preview)
 │    mic (+ optional camera frames) up, voice down, function calls emitted client-side
 ├─ Tool dispatcher (web/src/tools.ts) — tool responses returned instantly, work runs async
 │    imagine_space / generate_variants → POST /variants (null keyframe = pure text-to-image)
 │    refine_design                     → POST /variants (current concept as keyframe)
 │    generate_tour                     → POST /tour + poll (cached per area — re-tours are instant)
 │    note_home_spec                    → client-side home-spec store (drives plan + pack)
 │    play_scene                        → pre-rendered local clip
 │    compile_brief                     → POST /brief + POST /plan → Build Pack screen
 ├─ Stage (web/src/components/stage/) — 2×2 concept grid, tour playback, room gallery
 ├─ BuildPack (web/src/components/buildpack/) — floor plan + architect report
 └─ Brain feed panel — live ticker of what Asha is doing under the hood

FastAPI (server/)
 ├─ POST /variants      → 4 parallel NB2 image calls (edit if keyframe, generate if null) → static URLs
 ├─ POST /tour + GET    → Omni Flash image→video per confirmed room (per-area cache)
 ├─ POST /plan + GET    → NB2 concept floor-plan render from the accumulated home spec
 ├─ POST /brief         → grounded text call → budget + materials + approvals JSON
 └─ GET  /static/*      → generated images, plans, tour clips
```

## Models used (exact IDs)

| Role | Model |
|---|---|
| Live voice + camera session | `gemini-3.1-flash-live-preview` |
| Concept images & edits, floor-plan render | `gemini-3.1-flash-image` (NB2) |
| Room tour videos | `gemini-omni-flash-preview` (Interactions API, image→video; edits fed back as video input with `task: "edit"`) |
| Architect brief | `gemini-3.5-flash` + `google_search` grounding |

No prompt box anywhere. The Live session self-initiates `imagine_space`, `refine_design`,
`generate_tour`, `note_home_spec`, `generate_variants` and `play_scene` as function calls
mid-conversation; `compile_brief` fires only on an explicit user ask. Prices quoted in-session
are grounded `google_search` ESTIMATES with citations, never invented.

## Built during the event vs. starter code we adapted

**Starter code we adapted (disclosed):**
- `web/` is adapted from Google's official
  [live-api-web-console](https://github.com/google-gemini/live-api-web-console) starter
  (Apache-2.0, LICENSE preserved). We swapped the model ID, wired our persona/system
  instruction, tool declarations, dispatcher, and layout — the streaming scaffolding is theirs.

**Built during the event (today, 2026-07-11 — see commit timestamps):**
- Everything in `server/` — `/variants`, `/tour`, `/plan`, `/brief`, the Omni pre-render script.
- `web/src/components/stage/`, `buildpack/`, `rail/`, `brainfeed/` — concept grid, tours,
  Build Pack, brain feed.
- `web/src/tools.ts` — the seven-tool dispatcher and the client-side home-spec store.
- `prompts/` — the Asha persona, tour-guide voice, edit/generation wrappers.
- `demo/` + `server/static/` — all plan renders and tour clips were generated with NB2 and
  Omni Flash **during the event**; the cached brief comes from a grounded call made today.
  We say so on stage.

## Run it

```bash
# 1. env — server reads the repo-root .env, the web app reads web/.env (CRA prefix)
cp .env.example .env                      # GEMINI_API_KEY=<key>
cp web/.env.example web/.env              # REACT_APP_GEMINI_API_KEY=<key>
                                          # REACT_APP_SERVER_URL=http://localhost:8000

# 2. server
cd server
pip install -r requirements.txt           # fastapi, uvicorn, google-genai
uvicorn app:app --host 0.0.0.0 --port 8000

# 3. web (laptop browser — mic + optional webcam)
cd web
npm install
npm start                                  # http://localhost:3000

# 4. (background, once) pre-render the play_scene clips from the best edited corner image
python server/scripts/prerender.py server/static/<best_edit>.jpg
```

## Team

- **Anupam Rawat** (Dev A) — Live session spine, persona + session context, tool dispatcher,
  variant rail, brain feed (`web/`)
- **Abhishek** (Dev B) — generation pipeline (`server/`), whole-home Stage + tours + Build
  Pack (`web/src/components/stage/`, `buildpack/`), demo assets (`demo/`)
