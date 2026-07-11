# GHAR — Master Plan (Google DeepMind Bangalore Hackathon)

**Product:** Ghar — a live interior designer in your pocket. Camera-first, no prompt box.
**Track:** PS1 (Real-Time Multimodal Interaction, Live API). Depth evidence: PS3 (NB2 Lite throughput) + PS4 (NB2→Omni chain).
**Team:** Anupam Rawat (Dev A — Live spine, `web/`), Abhishek (Dev B — generation pipeline, `server/` + rail).
**Window:** 12:00 → 5:00 PM. Submissions 5:00 PM sharp. Booth judging 5:00–6:45. Finals 7:00–8:00.

## The one rule
Every decision from 12:00 to 5:00 is tested against one question:
**"Does this make the 90-second demo loop better?"** If no, it does not get built.

## The 90-second loop (what we are building, nothing else)
1. Camera opens → designer **speaks first**, commenting on something visible.
2. Judge **interrupts** mid-sentence → designer pivots instantly.
3. Conversation about the corner → model **self-initiates** `generate_variants` → rail fills with 4 NB2 edits of the live corner in ~4s each. Brain feed shows the tool call firing.
4. Judge picks one by voice → "show me a Sunday evening here" → **cached Omni Flash clip** plays. "Now monsoon" → second cached clip.
5. Close: "No prompt box anywhere. Gemini is the event loop; NB2 and Omni are its hands."

## Timeline with merge points

| Clock | Phase | Anupam | Abhishek |
|---|---|---|---|
| 12:00–12:15 | **P0 Setup** | T0 repo + credits form | T1 keys + clone + fixtures |
| 12:15–12:45 | **P1 Gate** | T2 Live session spike | T3 NB2 + Omni validation |
| **12:45** | **MERGE M1** | GO/NO-GO decision · lock docs/CONTRACT.md · tag `m1-gate` | |
| 12:45–2:15 | **P2 Parallel build** | T4–T7 (persona, tool, kickoff, brain feed) | T8–T11 (variants API, rail, Omni pre-renders, climax) |
| **2:15** | **MERGE M2** | Integration: real tool dispatch → /variants → rail. PAIR until loop works. Tag `m2-loop` (~3:00) | |
| 3:00–4:00 | **P3 Moats** | T12 persona tuning · T13 language switch (stretch) | T14 climax wiring + mobile pass · T15 notebook (stretch) |
| **4:00** | **MERGE M3 — CODE FREEZE** | Tag `demo-freeze`. No code after this. | |
| 4:00–5:00 | **P4 Rehearse + submit** | T16 rehearse ×3 + record fallback · T18 submit by 4:45 | T16 rehearse · T17 README finalize |

Lunch (1:00 PM): fetch, eat at desks. The lunch line is a 30-minute scope cut.

## Git workflow (trunk-based, directory ownership — no PRs, no long branches)
- One public repo, both push **directly to `main`**.
- Conflict avoidance by ownership, not by process:
  - **Anupam owns:** `web/` (except `web/src/components/rail/`), `prompts/persona.md`
  - **Abhishek owns:** `server/`, `web/src/components/rail/`, `demo/`, `README.md`
  - **Locked after M1 (edit only when paired):** `docs/CONTRACT.md`, `AGENTS.md`
- `git pull --rebase` before every push. Commit every ~20 min minimum — commit timestamps are our
  proof of "new work only" (disqualification rule).
- Merge points M1/M2/M3 are physical syncs: both stop, pull, run the loop together, tag.
- If a rebase conflicts: the directory owner wins, the other reverts their stray edit. 30 seconds, no debate.

## GO/NO-GO at M1 (12:45, no sentiment)
- **GO:** Live audio+camera session runs on the phone over hotspot → build Ghar.
- **NO-GO:** Live session not working after 30 min of honest effort → **pivot to Reroom**
  (photo upload → NB2 variant rail → one Omni conversational-edit video, submit PS3/PS4).
  Abhishek's entire track (T8–T11) survives the pivot unchanged; Anupam rebuilds `web/` as a
  simple upload UI (~1h with the coding agent). Decision is made once, at 12:45, never revisited.

## Compliance checklist (disqualification tripwires)
- [ ] Repo public from minute 0 (verify in incognito).
- [ ] README has "Built during the event" vs "Starter code we adapted" section
      (we adapt Google's official Live API web console — disclose it, link it).
- [ ] No Streamlit. Brain feed stays a *side panel* (no dashboard-as-main-feature).
- [ ] Demo shows only today's work.
- [ ] Credits form filled at 12:00: https://forms.gle/7XRrpnJXQeXm4kk8A

## Model IDs (from the participant guide — do not let agents guess)
- Live session: `gemini-3.1-flash-live-preview`
- Live Translate (stretch T13): `gemini-3.5-live-translate-preview`
- Images: `gemini-3.1-flash-lite-image` (NB2 Lite)
- Video: `gemini-omni-flash-preview` (Interactions API, `previous_interaction_id`)
- Docs: https://ai.google.dev/gemini-api/docs/live · /docs/image-generation · /docs/omni

## Connectivity
- **Coding:** venue wifi (`cv x gdm` / `hackathon`).
- **Demoing + rehearsing:** Anupam's phone hotspot, ALWAYS. Never demo on venue wifi.
