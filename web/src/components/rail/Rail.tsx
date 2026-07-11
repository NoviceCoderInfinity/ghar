/**
 * Rail.tsx — variant selection UI (T9, restyled per live-test feedback).
 *
 * Layout:
 *   - LEFT sidebar "YOUR HOME SO FAR": small history tiles of every chosen design
 *     (caption + check). Tap one to bring it back fullscreen and make it the edit base.
 *   - CENTER 2x2 grid of the CURRENT batch, headed "NOW DESIGNING: <description>",
 *     shown over the camera view while a batch is active. Tap a tile → fullscreen.
 *   - Fullscreen overlay: tap anywhere to close (back to the grid).
 *
 * Exported API surface (unchanged contract, description added):
 *   <Rail serverUrl={SERVER_URL} />
 *   startBatch(batchId, description?)   — from the tool dispatcher after POST /variants
 *   setOnVariantChosen((url, slot) => {})
 *
 * Polling per docs/CONTRACT.md: GET {serverUrl}/variants/{batchId} every 1s,
 * fill slots as they go "done", hide "failed", stop when none "pending".
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VariantSlot, VariantsPollResponse } from "./types";
import { USE_MOCK, mockPollVariants } from "./mockServer";
import "./rail.css";

/* ------------------------------------------------------------------ */
/* Module-level wiring so non-React code (the tool dispatcher) can talk
   to the mounted Rail without prop drilling.                          */
/* ------------------------------------------------------------------ */

type BatchListener = (batchId: string, description: string) => void;
const batchListeners = new Set<BatchListener>();
/** Batches announced before Rail mounted (kickoff race) — replayed on mount. */
const preMountQueue: { batchId: string; description: string }[] = [];

/**
 * Tell the rail a new variant batch exists. Call from web/src/tools.ts right
 * after POST /variants returns { batch_id }. Safe to call before mount.
 */
export function startBatch(batchId: string, description: string = ""): void {
  if (batchListeners.size === 0) {
    preMountQueue.push({ batchId, description });
    return;
  }
  batchListeners.forEach((l) => l(batchId, description));
}

export type VariantChosenHandler = (url: string, slot: number) => void;
let variantChosenHandler: VariantChosenHandler | null = null;

export function setOnVariantChosen(cb: VariantChosenHandler | null): void {
  variantChosenHandler = cb;
}

/* ------------------------------------------------------------------ */

interface Batch {
  batchId: string;
  description: string;
  slots: VariantSlot[]; // always 4 entries
  settled: boolean;
}

interface HistoryItem {
  url: string;
  slot: number;
  label: string;
}

const EMPTY_SLOTS: VariantSlot[] = [0, 1, 2, 3].map((slot) => ({
  slot,
  status: "pending",
  url: null,
}));

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;

export interface RailProps {
  serverUrl: string;
}

export default function Rail({ serverUrl }: RailProps) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [gridOpen, setGridOpen] = useState(true);
  const [enlarged, setEnlarged] = useState<{ url: string; slot: number } | null>(
    null
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  /** "/static/x.jpg" → serverUrl + path; absolute URLs (mock) pass through. */
  const fullUrl = useCallback((u: string) => {
    if (/^https?:\/\//.test(u)) return u;
    const base = serverUrlRef.current.replace(/\/$/, "");
    return base + (u.startsWith("/") ? u : "/" + u);
  }, []);

  const stopPolling = useCallback((batchId: string) => {
    const t = timersRef.current.get(batchId);
    if (t !== undefined) {
      window.clearInterval(t);
      timersRef.current.delete(batchId);
    }
  }, []);

  const pollOnce = useCallback(
    async (batchId: string) => {
      let res: VariantsPollResponse;
      try {
        if (USE_MOCK) {
          res = await mockPollVariants(batchId);
        } else {
          const base = serverUrlRef.current.replace(/\/$/, "");
          const r = await fetch(`${base}/variants/${batchId}`);
          if (!r.ok) return; // transient — keep polling
          res = (await r.json()) as VariantsPollResponse;
        }
      } catch {
        return; // network blip — next tick retries
      }

      const settled = res.images.every((s) => s.status !== "pending");
      setBatch((prev) =>
        prev && prev.batchId === batchId
          ? { ...prev, slots: res.images, settled }
          : prev
      );
      if (settled) stopPolling(batchId);
    },
    [stopPolling]
  );

  const beginBatch = useCallback(
    (batchId: string, description: string) => {
      // One live batch at a time: previous tiles are replaced (the picked one
      // lives on in history), stale pollers die, and the grid opens over any
      // zoomed view so the new reveal is never hidden.
      timersRef.current.forEach((t, id) => {
        if (id !== batchId) {
          window.clearInterval(t);
          timersRef.current.delete(id);
        }
      });
      setEnlarged(null);
      setGridOpen(true);
      setBatch((prev) =>
        prev && prev.batchId === batchId
          ? prev
          : { batchId, description, slots: EMPTY_SLOTS, settled: false }
      );
      if (!timersRef.current.has(batchId)) {
        pollOnce(batchId);
        const t = window.setInterval(() => pollOnce(batchId), 1000);
        timersRef.current.set(batchId, t);
      }
    },
    [pollOnce]
  );

  // Subscribe to startBatch() announcements; replay any pre-mount batches.
  useEffect(() => {
    batchListeners.add(beginBatch);
    while (preMountQueue.length > 0) {
      const q = preMountQueue.shift()!;
      beginBatch(q.batchId, q.description);
    }
    const timers = timersRef.current;
    return () => {
      batchListeners.delete(beginBatch);
      timers.forEach((t) => window.clearInterval(t));
      timers.clear();
    };
  }, [beginBatch]);

  const handleGridTap = (slot: VariantSlot) => {
    if (slot.status !== "done" || !slot.url) return;
    const url = fullUrl(slot.url);
    setEnlarged({ url, slot: slot.slot });
    setHistory((h) =>
      h.length > 0 && h[h.length - 1].url === url
        ? h
        : [...h, { url, slot: slot.slot, label: truncate(batch?.description || "Design", 26) }]
    );
    if (variantChosenHandler) variantChosenHandler(url, slot.slot);
  };

  // Revert: tapping a history tile makes that design current again (edit base +
  // model notice via the same chosen handler).
  const handleHistoryTap = (item: HistoryItem) => {
    setEnlarged({ url: item.url, slot: item.slot });
    if (variantChosenHandler) variantChosenHandler(item.url, item.slot);
  };

  const showGrid = batch !== null && gridOpen && !enlarged;

  if (!batch && history.length === 0 && !enlarged) return null;

  return (
    <>
      {history.length > 0 ? (
        <aside className="ghar-history" aria-label="Your home so far">
          <div className="ghar-history-title">Your home so far</div>
          {history.map((item, i) => (
            <div
              key={`hist_${i}`}
              className="ghar-history-tile"
              onClick={() => handleHistoryTap(item)}
              role="button"
              title="Tap to bring this design back"
            >
              <img src={item.url} alt={`Chosen design ${i + 1}`} />
              <div className="ghar-history-caption">
                <span className="ghar-history-label">{item.label}</span>
                <span className="ghar-history-check">✓</span>
              </div>
            </div>
          ))}
        </aside>
      ) : null}

      {showGrid ? (
        <div className="ghar-grid-wrap" aria-label="Design options">
          <div className="ghar-grid-header">
            <span className="ghar-grid-header-now">Now designing:</span>{" "}
            <span className="ghar-grid-header-desc">
              {truncate(batch!.description || "your space", 64)}
            </span>
            <button
              className="ghar-grid-min"
              onClick={() => setGridOpen(false)}
              aria-label="Minimize options"
              title="Show camera"
            >
              —
            </button>
          </div>
          <div className="ghar-grid">
            {batch!.slots.map((s) => (
              <div
                key={`${batch!.batchId}_${s.slot}`}
                className={
                  "ghar-grid-tile" +
                  (s.status === "pending" ? " ghar-grid-tile--skeleton" : "") +
                  (s.status === "failed" ? " ghar-grid-tile--failed" : "")
                }
                onClick={() => handleGridTap(s)}
                role={s.status === "done" ? "button" : undefined}
              >
                {s.status === "done" && s.url ? (
                  <img src={fullUrl(s.url)} alt={`Variant ${s.slot + 1}`} />
                ) : null}
              </div>
            ))}
          </div>
          <div className="ghar-grid-hint">tap the one that feels like home</div>
        </div>
      ) : null}

      {batch && !gridOpen && !enlarged ? (
        <button className="ghar-grid-reopen" onClick={() => setGridOpen(true)}>
          ▦ Show options
        </button>
      ) : null}

      {enlarged ? (
        <div
          className="ghar-rail-overlay"
          onClick={() => setEnlarged(null)}
          role="button"
          aria-label="Dismiss enlarged variant"
        >
          <img src={enlarged.url} alt={`Variant ${enlarged.slot + 1} enlarged`} />
          <div className="ghar-rail-overlay-hint">tap anywhere to close</div>
        </div>
      ) : null}
    </>
  );
}
