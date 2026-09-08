"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Item = {
  id: string; project: string; deletedAt: string;
  daysLeft: number; bytes: number; hasRawFootage: boolean;
};

const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/** Deleted projects, and how long is left to change your mind. */
export default function RecentlyDeleted() {
  const [items, setItems] = useState<Item[]>([]);
  const [retain, setRetain] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const res = await fetch("/api/trash");
    if (!res.ok) return;
    const d = await res.json();
    setItems(d.items ?? []);
    setRetain(d.retainDays ?? 5);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "restore" | "purge") {
    setBusy(id);
    await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    setBusy(null);
    await load();
    router.refresh();
  }

  if (!items.length) return null;

  return (
    <div className="recently">
      <div className="section-head">
        <h2>Recently deleted</h2>
        <span className="mono count">erased after {retain} days</span>
      </div>
      {items.map((it) => (
        <div className="recently-row" key={it.id}>
          <div>
            <b>{it.project}</b>
            <span className="recently-meta mono">
              {mb(it.bytes)}{it.hasRawFootage ? " · includes the original footage" : ""}
            </span>
          </div>
          <span className={`recently-left${it.daysLeft <= 1 ? " soon" : ""}`}>
            {it.daysLeft <= 0 ? "erasing now" : `${it.daysLeft} day${it.daysLeft === 1 ? "" : "s"} left`}
          </span>
          <button className="ui-btn ui-btn-sm" disabled={busy === it.id}
                  onClick={() => act(it.id, "restore")}>
            Put it back
          </button>
          <button className="ui-btn ui-btn-sm ui-btn-danger" disabled={busy === it.id}
                  onClick={() => act(it.id, "purge")}>
            Erase now
          </button>
        </div>
      ))}
    </div>
  );
}
