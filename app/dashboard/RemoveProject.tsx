"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Overlay from "@/app/components/Overlay";

/**
 * The ⋯ menu on a project card.
 *
 * Delete means the project is off the queue the moment it's confirmed. It is
 * held for five days first -- deleting the wrong take of a shoot you can't
 * reshoot is a bad afternoon -- and then erased for good, automatically. The
 * dialog says the deadline out loud so "delete" doesn't quietly mean "keep".
 */
export default function RemoveProject({
  name,
  title,
  hasRawFootage,
  retainDays = 5,
}: {
  name: string;
  title: string;
  hasRawFootage: boolean;
  retainDays?: number;
}) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [menu]);

  async function del() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${name}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "could not delete it"); return; }
    setConfirm(false);
    router.refresh();
  }

  return (
    <div className="qcard-menu" ref={wrap}>
      <button
        type="button"
        className="qcard-dots"
        title={`More for ${title}`}
        aria-label={`More options for ${title}`}
        aria-expanded={menu}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu((v) => !v); }}
      >
        ⋯
      </button>

      {menu && (
        <div className="qmenu" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <button className="qmenu-item danger" onClick={() => { setMenu(false); setConfirm(true); }}>
            Delete project
          </button>
        </div>
      )}

      {confirm && (
        <Overlay onClose={() => setConfirm(false)}>
          <div className="modal" onClick={(e) => e.preventDefault()}>
            <div className="modal-head">
              <div>
                <h3>Delete {title}?</h3>
                <p>It comes off the queue straight away.</p>
              </div>
              <button className="modal-close" onClick={() => setConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, lineHeight: 1.55 }}>
                You have <b>{retainDays} days</b> to undo this. After that it is erased for
                good — beats, transcript, cuts{hasRawFootage ? " and the raw footage" : ""}.
              </p>
              {hasRawFootage && (
                <div className="flag-note info" style={{ marginTop: 12 }}>
                  <div>
                    This project still holds its original footage. If that&apos;s the only copy,
                    get it off this machine before the {retainDays} days are up.
                  </div>
                </div>
              )}
              {error && <div className="gfx-error" style={{ marginTop: 12 }}>{error}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-critical" disabled={busy} onClick={del}>
                {busy ? "Deleting…" : "Yes, delete it"}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
