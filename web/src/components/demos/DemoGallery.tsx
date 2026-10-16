/**
 * DemoGallery.tsx — "Demo examples": real outputs saved from the demo session,
 * served as static files from /demos (manifest.json + media). Needs no backend
 * and no key, so it works on the public deploy where the generation server
 * isn't running.
 */

import React, { useEffect, useRef, useState } from "react";
import "../buildpack/buildpack.css";
import "./demos.css";

const DEMOS_BASE = `${process.env.PUBLIC_URL || ""}/demos`;

interface DemoTake {
  src: string;
  poster?: string;
}

interface DemoTour {
  room: string;
  caption?: string;
  takes: DemoTake[];
}

interface DemoImage {
  src: string;
  caption?: string;
}

export interface DemoExample {
  slug: string;
  title: string;
  flow: string;
  summary: string;
  cover: string;
  input?: DemoImage;
  edits?: DemoImage[];
  tours: DemoTour[];
  plans: DemoImage[];
  brief: string | null;
  briefCaption: string | null;
}

interface DemoManifest {
  note: string;
  examples: DemoExample[];
}

export interface DemoGalleryProps {
  visible: boolean;
  slug: string | null;
  onSelect: (slug: string | null) => void;
  onClose: () => void;
}

const inr = (n: number | null | undefined) =>
  typeof n === "number" ? "₹" + n.toLocaleString("en-IN") : "—";

const asset = (slug: string, file: string) => `${DEMOS_BASE}/${slug}/${file}`;

function TourCard({ slug, tour }: { slug: string; tour: DemoTour }) {
  const [take, setTake] = useState(0);
  const current = tour.takes[take] ?? tour.takes[0];
  return (
    <div className="ghar-demo-tour">
      <video
        key={current.src}
        className="ghar-demo-video"
        src={asset(slug, current.src)}
        poster={current.poster ? asset(slug, current.poster) : undefined}
        controls
        muted
        playsInline
        preload="metadata"
      />
      <div className="ghar-demo-tour-meta">
        <div className="ghar-demo-tour-room">{tour.room}</div>
        {tour.takes.length > 1 && (
          <div className="ghar-demo-takes" role="group" aria-label={`${tour.room} takes`}>
            {tour.takes.map((_, i) => (
              <button
                key={i}
                className={i === take ? "active" : undefined}
                onClick={() => setTake(i)}
                aria-pressed={i === take}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      {tour.caption && <p className="ghar-demo-caption">{tour.caption}</p>}
    </div>
  );
}

function BriefView({ brief }: { brief: any }) {
  const rooms: any[] = Array.isArray(brief?.rooms) ? brief.rooms : [];
  const budget: any[] = Array.isArray(brief?.budget) ? brief.budget : [];
  const materials: any[] = Array.isArray(brief?.materials_and_equipment)
    ? brief.materials_and_equipment
    : [];
  const legal: any[] = Array.isArray(brief?.legal) ? brief.legal : [];
  return (
    <>
      {rooms.length > 0 && (
        <div className="ghar-buildpack-section">
          <h3>Room specs</h3>
          <table className="ghar-buildpack-table">
            <tbody>
              {rooms.map((r, i) => (
                <tr key={i}>
                  <td className="ghar-buildpack-key">{r.room}</td>
                  <td className="ghar-demo-pre">{r.spec}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {budget.length > 0 && (
        <div className="ghar-buildpack-section">
          <h3>
            Budget <span className="ghar-buildpack-tag">all estimates</span>
          </h3>
          <table className="ghar-buildpack-table">
            <tbody>
              {budget.map((b, i) => (
                <tr key={i}>
                  <td className="ghar-buildpack-key">
                    {b.item}
                    {b.source_url ? (
                      <a
                        href={b.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ghar-buildpack-link"
                      >
                        vendor
                      </a>
                    ) : null}
                  </td>
                  <td className="ghar-buildpack-amount">
                    {inr(b.estimate_inr)} <span className="ghar-buildpack-tag">est.</span>
                  </td>
                </tr>
              ))}
              <tr className="ghar-buildpack-total">
                <td>Total</td>
                <td className="ghar-buildpack-amount">
                  {inr(brief?.total_estimate_inr)}{" "}
                  <span className="ghar-buildpack-tag">est.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {materials.length > 0 && (
        <div className="ghar-buildpack-section">
          <h3>Materials &amp; equipment</h3>
          <table className="ghar-buildpack-table">
            <tbody>
              {materials.map((m, i) => (
                <tr key={i}>
                  <td className="ghar-buildpack-key">
                    {m.item}
                    <em className="ghar-buildpack-purpose">{m.purpose}</em>
                  </td>
                  <td className="ghar-buildpack-amount">
                    {inr(m.estimate_inr)} <span className="ghar-buildpack-tag">est.</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {legal.length > 0 && (
        <div className="ghar-buildpack-section">
          <h3>Approvals &amp; legal</h3>
          <ul className="ghar-buildpack-legal">
            {legal.map((l, i) => (
              <li key={i} className={l.required ? "is-required" : "is-optional"}>
                <span className="ghar-buildpack-mark">{l.required ? "✓" : "–"}</span>
                <span>
                  <strong>{l.step}</strong>
                  <em>{l.detail}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DemoDetail({ example }: { example: DemoExample }) {
  const [brief, setBrief] = useState<any | null>(null);
  const [briefError, setBriefError] = useState(false);

  useEffect(() => {
    setBrief(null);
    setBriefError(false);
    if (!example.brief) return;
    let cancelled = false;
    fetch(asset(example.slug, example.brief))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((b) => !cancelled && setBrief(b))
      .catch(() => !cancelled && setBriefError(true));
    return () => {
      cancelled = true;
    };
  }, [example]);

  const { slug } = example;
  return (
    <div className="ghar-demo-detail">
      <div className="ghar-demo-flow">{example.flow}</div>
      <h3 className="ghar-demo-detail-title">{example.title}</h3>
      <p className="ghar-demo-summary">{example.summary}</p>

      {(example.input || (example.edits && example.edits.length > 0)) && (
        <section className="ghar-buildpack-section">
          <h3>Room edit</h3>
          <div className="ghar-demo-images">
            {[...(example.input ? [example.input] : []), ...(example.edits || [])].map((img) => (
              <figure key={img.src} className="ghar-demo-figure">
                <img src={asset(slug, img.src)} alt={img.caption || ""} loading="lazy" />
                {img.caption && <figcaption>{img.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      {example.tours.length > 0 && (
        <section className="ghar-buildpack-section">
          <h3>Tours</h3>
          <div className="ghar-demo-tours">
            {example.tours.map((t) => (
              <TourCard key={t.room} slug={slug} tour={t} />
            ))}
          </div>
        </section>
      )}

      {example.plans.length > 0 && (
        <section className="ghar-buildpack-section">
          <h3>Floor plan{example.plans.length > 1 ? "s" : ""}</h3>
          {example.plans.map((p) => (
            <figure key={p.src} className="ghar-demo-figure ghar-demo-plan">
              <a href={asset(slug, p.src)} target="_blank" rel="noopener noreferrer">
                <img
                  className="ghar-buildpack-plan"
                  src={asset(slug, p.src)}
                  alt={p.caption || "Concept floor plan"}
                  loading="lazy"
                />
              </a>
              {p.caption && <figcaption>{p.caption}</figcaption>}
            </figure>
          ))}
          <p className="ghar-buildpack-disclaimer">
            ILLUSTRATIVE concept only — not to scale, not a construction drawing.
          </p>
        </section>
      )}

      {example.brief && (
        <section className="ghar-buildpack-section">
          <h3>Build pack</h3>
          {example.briefCaption && <p className="ghar-demo-caption">{example.briefCaption}</p>}
          {briefError ? (
            <div className="ghar-buildpack-loading">Couldn't load this brief.</div>
          ) : brief === null ? (
            <div className="ghar-buildpack-loading">Loading brief…</div>
          ) : (
            <BriefView brief={brief} />
          )}
        </section>
      )}
    </div>
  );
}

export default function DemoGallery({ visible, slug, onSelect, onClose }: DemoGalleryProps) {
  const [manifest, setManifest] = useState<DemoManifest | null>(null);
  const [error, setError] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Start each view (gallery or an example) at the top.
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [slug, visible]);

  useEffect(() => {
    if (!visible || manifest) return;
    fetch(`${DEMOS_BASE}/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((m: DemoManifest) => setManifest(m))
      .catch((err) => {
        console.warn("[demos] could not load manifest:", err);
        setError(true);
      });
  }, [visible, manifest]);

  if (!visible) return null;

  const selected = manifest?.examples.find((e) => e.slug === slug) || null;

  return (
    <div className="ghar-buildpack ghar-demos" role="dialog" aria-label="Demo examples">
      <div className="ghar-buildpack-header">
        {selected ? (
          <button className="ghar-demo-back" onClick={() => onSelect(null)}>
            ← All examples
          </button>
        ) : (
          <h2>Demo examples</h2>
        )}
        <button className="ghar-buildpack-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>

      <div className="ghar-buildpack-body ghar-demos-body" ref={bodyRef}>
        {error ? (
          <div className="ghar-buildpack-loading">Couldn't load the demo examples.</div>
        ) : !manifest ? (
          <div className="ghar-buildpack-loading">Loading examples…</div>
        ) : selected ? (
          <DemoDetail example={selected} />
        ) : (
          <>
            <p className="ghar-demo-intro">
              Real outputs saved from our demo session: Omni Flash room tours, concept
              floor plans and the architect build pack. You don't need a server or a key
              to browse them.
            </p>
            <div className="ghar-demo-grid">
              {manifest.examples.map((ex) => {
                const takes = ex.tours.reduce((n, t) => n + t.takes.length, 0);
                const bits = [
                  takes ? `${takes} video${takes > 1 ? "s" : ""}` : null,
                  ex.plans.length ? `${ex.plans.length} plan${ex.plans.length > 1 ? "s" : ""}` : null,
                  ex.brief ? "build pack" : null,
                ].filter(Boolean);
                return (
                  <button
                    key={ex.slug}
                    className="ghar-demo-card"
                    onClick={() => onSelect(ex.slug)}
                  >
                    <img src={asset(ex.slug, ex.cover)} alt="" loading="lazy" />
                    <span className="ghar-demo-card-body">
                      <span className="ghar-demo-flow">{ex.flow}</span>
                      <span className="ghar-demo-card-title">{ex.title}</span>
                      <span className="ghar-demo-card-meta">{bits.join(" · ")}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="ghar-buildpack-disclaimer">{manifest.note}</p>
          </>
        )}
      </div>
    </div>
  );
}
