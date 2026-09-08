"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LearningPreference } from "@/lib/types";
import References from "./References";
import MicCheck from "./MicCheck";

const CATEGORY_LABEL: Record<LearningPreference["category"], string> = {
  "take-selection": "Take selection",
  "cutting-rules": "Cutting rules",
  pacing: "Pacing",
  other: "Other",
};

type Tab = "preferences" | "references" | "products" | "profile" | "pipeline";

type Product = { id: string; name: string; brand?: string; links: Record<string, string> };

// the availability map is keyed by internal names; these are what they are
const TOOL_LABEL: Record<string, string> = {
  python3: "Python 3",
  ffmpeg: "ffmpeg (video encoding)",
  fasterWhisper: "faster-whisper (transcription)",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("preferences");
  const [prefs, setPrefs] = useState<LearningPreference[] | null>(null);
  const [text, setText] = useState("");
  const [avail, setAvail] = useState<Record<string, boolean> | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [amazonTag, setAmazonTag] = useState("");
  const [tagSaved, setTagSaved] = useState(false);

  async function loadPrefs() {
    const res = await fetch("/api/learnings");
    setPrefs((await res.json()).learnings);
  }
  useEffect(() => {
    loadPrefs();
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => { setProducts(d.products); setAmazonTag(d.amazonTag ?? ""); })
      .catch(() => {});
    fetch("/api/projects/_/pipeline")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAvail(d.availability))
      .catch(() => {});
  }, []);

  async function add() {
    if (!text.trim()) return;
    await fetch("/api/learnings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    setText("");
    loadPrefs();
  }

  async function toggle(id: string, active: boolean) {
    await fetch("/api/learnings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    loadPrefs();
  }

  async function saveTag() {
    await fetch("/api/products", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amazonTag }),
    });
    setTagSaved(true);
    setTimeout(() => setTagSaved(false), 2000);
  }

  async function saveLink(id: string, kind: string, value: string) {
    await fetch("/api/products", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: id, links: { [kind]: value } }),
    });
  }

  const groups: Record<string, LearningPreference[]> = {};
  for (const p of prefs ?? []) (groups[p.category] ??= []).push(p);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>What SnipAi has learned from your edits, and how it&apos;s set up.</p>
        </div>
      </div>

      <div className="tabs">
        {([
          ["preferences", "Editing preferences"],
          ["references", "Style references"],
          ["products", "Products & links"],
          ["profile", "Profile"],
          ["pipeline", "Pipeline"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "preferences" && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 9 }}>Add a rule</h3>
            <textarea
              className="textline"
              placeholder="e.g. never use a take where I look down at the product before the line finishes"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="action-bar"><button className="btn btn-primary" onClick={add}>Save</button></div>
          </div>

          {!prefs && <div className="empty-state">Loading…</div>}
          {(["take-selection", "cutting-rules", "pacing", "other"] as const).map((cat) =>
            groups[cat]?.length ? (
              <div className="pref-group" key={cat}>
                <h3>{CATEGORY_LABEL[cat]}</h3>
                {groups[cat].map((p) => (
                  <div className={`pref-item${p.active ? "" : " off"}`} key={p.id}>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10.5l4 4 8-9" /></svg>
                    <span>{p.text}{!p.active ? " (off)" : ""}</span>
                    <button onClick={() => toggle(p.id, p.active)}>{p.active ? "turn off" : "turn on"}</button>
                  </div>
                ))}
              </div>
            ) : null
          )}
        </>
      )}

      {tab === "references" && <References />}

      {tab === "products" && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 9 }}>Amazon affiliate tag</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 10 }}>
              Your Associates tracking ID. Appended to any Amazon link SnipAi puts in a caption.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="field"
                placeholder="yourname-20"
                value={amazonTag}
                onChange={(e) => setAmazonTag(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveTag}>
                {tagSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>

          <div className="pref-group">
            <h3>Products SnipAi listens for</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
              When a video mentions one of these, its link gets attached automatically —
              no need to tell SnipAi what the video is about.
            </p>
            {!products && <div className="pref-item off"><span>Loading…</span></div>}
            {products?.map((p) => (
              <div className="product-row" key={p.id}>
                <div className="product-name">{p.name}</div>
                <input
                  className="field product-link"
                  placeholder="TikTok Shop link"
                  defaultValue={p.links.tiktokShop ?? ""}
                  onBlur={(e) => saveLink(p.id, "tiktokShop", e.target.value.trim())}
                />
                <input
                  className="field product-link"
                  placeholder="Amazon link"
                  defaultValue={p.links.amazon ?? ""}
                  onBlur={(e) => saveLink(p.id, "amazon", e.target.value.trim())}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "profile" && (
        <div className="pref-group">
          <h3>Microphone</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>
            Used for describing an edit out loud instead of typing it. macOS asks once, the
            first time. Recording is transcribed on this Mac and never leaves it.
          </p>
          <MicCheck />

          <h3 style={{ marginTop: 22 }}>Profile</h3>
          <div className="pref-item"><span>Kayer · Arzacorp</span></div>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
            Single-user for now — there are no accounts, and nothing leaves this machine.
          </p>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="pref-group">
          <h3>Editing tools</h3>
          {avail ? (
            Object.entries(avail).map(([k, ok]) => (
              <div className={`pref-item${ok ? "" : " off"}`} key={k}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10.5l4 4 8-9" /></svg>
                <span>{TOOL_LABEL[k] ?? k}{ok ? "" : " — not installed"}</span>
              </div>
            ))
          ) : (
            <div className="pref-item off"><span>Checking…</span></div>
          )}
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
            Transcription and rendering run locally. Heavy jobs run one at a time and at low
            priority so the machine stays usable. <Link href="/connectors" style={{ color: "var(--accent)" }}>Connectors →</Link>
          </p>
        </div>
      )}
    </section>
  );
}
