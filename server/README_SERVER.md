# Ghar server — run: `cd server && pip install fastapi uvicorn google-genai && uvicorn app:app --host 0.0.0.0 --port 8000`
- Env vars (`.env` at repo root works): `GEMINI_API_KEY` (required), `IMAGE_MODEL` (default `gemini-3.1-flash-image`), `BRIEF_MODEL` (default `gemini-3.5-flash`).
- `curl -X POST localhost:8000/variants -H 'Content-Type: application/json' -d "{\"description\":\"replace the chair with a rattan armchair\",\"keyframe_b64\":\"$(base64 -i ../demo/fixtures/corner.jpg)\"}"` → `{"batch_id":"b_xxx","count":4}` instantly.
- `curl localhost:8000/variants/b_xxx` → per-slot `done/pending/failed` + `/static/` URLs (rail polls this every 1s).
- `curl -X POST localhost:8000/brief -H 'Content-Type: application/json' -d '{"description":"warm minimal corner with rattan armchair","objects":["armchair","rug","floor lamp"]}'` → budget+legal JSON. Demo cache: `cp static/brief_cache_example.json static/brief_cache.json` to make it instant.
