/**
 * T4 — client-side session context injection (docs/PROMPTS.md §1b).
 *
 * Builds the "SESSION CONTEXT" block that App.tsx appends to the persona
 * system instruction before the Live session connects. Everything here runs
 * in the browser, with one optional network call (reverse geocode) — no
 * backend involvement, no live search, no runtime fetch of docs/KNOWLEDGE.md
 * (its Bengaluru/Mumbai/Delhi rules and the trend pack are hardcoded below).
 */

const DEFAULT_CITY = "Bengaluru";
const GEO_TIMEOUT_MS = 3000;
const CITY_CACHE_KEY = "ghar_session_city_v1";

interface CityCacheEntry {
  date: string; // YYYY-MM-DD — cache resets once a day
  city: string;
}

// ---- City material/climate knowledge (hardcoded from docs/KNOWLEDGE.md) ----

const CITY_BLOCKS: Record<string, string> = {
  bengaluru:
    "moderate climate, wide material latitude — fabric sofas, cane and rattan all work well. Still, BWR+ plywood in kitchens and anti-fungal paint on exterior walls are worth it. Monsoon rules (Jun–Sep) apply: matte over gloss, ventilation gaps in wardrobes, keep upholstery off exterior walls.",
  mumbai:
    "coastal humid climate — cabinetry should be BWP/marine-grade ply only, ordinary MR ply delaminates in a few years here. Avoid particle board, cheap MDF, leather outside AC rooms, iron or mild-steel hardware, and velvet, silk or jute rugs. Favor teak or sheesham and powder-coated aluminium fittings.",
  delhi:
    "extreme seasonal swing — high-40s summers, near-freezing winters, lots of dust. Design for a seasonal swap: light cotton and reflective colors in summer, wool throws in winter. Closed storage and washable covers beat open shelving or heavy-pile rugs here.",
  jaipur:
    "hot-dry climate — cotton breathes best and seating should stay clear of direct window heat. Ordinary MR ply is fine; no need to over-spec marine ply.",
  default:
    "a moderate Indian climate — breathable natural fabrics and BWR+ plywood are a safe default; worth confirming local monsoon timing before assuming exact months.",
};

function resolveCityKey(cityRaw: string): string {
  const c = cityRaw.toLowerCase();
  if (c.includes("bengaluru") || c.includes("bangalore") || c.includes("pune")) return "bengaluru";
  if (
    c.includes("mumbai") ||
    c.includes("chennai") ||
    c.includes("madras") ||
    c.includes("kolkata") ||
    c.includes("calcutta")
  )
    return "mumbai";
  if (
    c.includes("delhi") ||
    c.includes("ncr") ||
    c.includes("gurgaon") ||
    c.includes("gurugram") ||
    c.includes("noida")
  )
    return "delhi";
  if (c.includes("jaipur")) return "jaipur";
  return "default";
}

// ---- Static trend pack (hardcoded from docs/KNOWLEDGE.md — no live search call) ----

const TREND_PACK: string[] = [
  "Asian Paints Colour of the Year 2026 is Moonlit Silk, a soft green with yellow-white undertones",
  "palettes are shifting to sage, terracotta, mustard and indigo, away from all-grey",
  "Japandi and quiet luxury are the leading styles this year",
  "cane, rattan and lime plaster are the standout materials for 2026",
  "grandmillennial style — cane, brass, heritage prints — maps naturally to Indian ancestral furniture",
  "jaali screens and balconies-as-micro-rooms are a distinctly India-specific trend this year",
];

// ---- Time of day / season ----

type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
type Season = "winter" | "summer" | "monsoon" | "post-monsoon";

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function getSeason(month: number): Season {
  // month is 0-indexed (0 = January); India-wide approximation.
  if (month === 11 || month <= 1) return "winter"; // Dec-Feb
  if (month >= 2 && month <= 4) return "summer"; // Mar-May
  if (month >= 5 && month <= 8) return "monsoon"; // Jun-Sep
  return "post-monsoon"; // Oct-Nov
}

// ---- Geolocation → city (best-effort, silent fallback) ----

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCityCache(): string | null {
  try {
    const raw = localStorage.getItem(CITY_CACHE_KEY);
    if (!raw) return null;
    const entry: CityCacheEntry = JSON.parse(raw);
    if (entry && entry.date === todayKey() && entry.city) return entry.city;
    return null;
  } catch {
    return null;
  }
}

function writeCityCache(city: string): void {
  try {
    const entry: CityCacheEntry = { date: todayKey(), city };
    localStorage.setItem(CITY_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Cache is a nice-to-have, not required.
  }
}

function getCurrentPositionWithTimeout(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("no geolocation"));
      return;
    }
    const timer = setTimeout(() => reject(new Error("geolocation timeout")), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve(pos);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: 60 * 60 * 1000 }
    );
  });
}

async function reverseGeocodeCity(lat: number, lon: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = await res.json();
  const city: string | undefined = data.city || data.locality || data.principalSubdivision;
  if (!city) throw new Error("no city in reverse geocode response");
  return city;
}

async function resolveCity(): Promise<string> {
  const cached = readCityCache();
  if (cached) return cached;

  try {
    const pos = await getCurrentPositionWithTimeout();
    const city = await reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude);
    writeCityCache(city);
    return city;
  } catch {
    // Denied, timed out, offline, or geocode failed — fall back silently.
    writeCityCache(DEFAULT_CITY);
    return DEFAULT_CITY;
  }
}

// ---- Assemble the SESSION CONTEXT block (docs/PROMPTS.md §1b) ----

export async function buildSessionContext(): Promise<string> {
  const city = await resolveCity();
  const cityBlock = CITY_BLOCKS[resolveCityKey(city)];

  const now = new Date();
  const timeOfDay = getTimeOfDay(now.getHours());
  const season = getSeason(now.getMonth());
  const language = typeof navigator !== "undefined" ? navigator.language : "en-IN";

  const timingNotes: string[] = [];
  if (season === "monsoon") {
    timingNotes.push("Monsoon-proofing talk is timely right now.");
  }
  if (timeOfDay === "evening") {
    timingNotes.push("Point out how the room feels at night — lighting talk lands well now.");
  }

  const trendLines = TREND_PACK.map((t) => `- ${t}`).join("\n");

  return `SESSION CONTEXT (from the user's device, with their permission — acknowledge the city once, naturally, and never say the word "geolocation"):
- City: ${city}. ${cityBlock}
- Local time: ${timeOfDay}, ${season} season. ${timingNotes.join(" ")}
- Device language hint: ${language} — a soft prior only; mirror what they actually speak, never switch before they do.
- Trend pack (cite as "per <source>, 2026", max one per room, tied to something visible in their space):
${trendLines}
- Typical living-room budgets here: economy ₹1–2L, mid ₹3–5L, premium ₹7L+ — only quote if asked.`;
}
