// Vercel serverless function: POST /api/live-token
//
// Mints a short-lived, single-use Gemini Live API ephemeral token so the
// browser never sees GEMINI_API_KEY. The client fetches one per connect and
// opens the Live session with it (v1alpha, BidiGenerateContentConstrained).
//
// Env (Vercel project settings, server-side only — no REACT_APP_ prefix):
//   GEMINI_API_KEY   required
//   ALLOWED_ORIGINS  optional, comma-separated (e.g. https://ghar.vercel.app).
//                    If unset, only same-origin browser requests are accepted.
import { GoogleGenAI } from "@google/genai";

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length > 0) return allowed.includes(origin);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ error: "origin not allowed" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        // Live sessions are capped at 15 min (audio) in the app; give headroom.
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    return res.status(200).json({ token: token.name });
  } catch (err) {
    console.error("live-token: failed to create ephemeral token:", err?.message);
    return res.status(502).json({ error: "could not create live token" });
  }
}
