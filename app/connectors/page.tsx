"use client";

import Overlay from "@/app/components/Overlay";

import { useEffect, useState } from "react";
import type { PlatformConnection } from "@/lib/types";
import type { ProjectSummary } from "@/lib/projectSummary";

// Voss / Jeff / Marcus / Sloane removed at Kayer's request -- placeholder
// agents that don't exist yet were just noise.

export default function AgentsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [openConnect, setOpenConnect] = useState<PlatformConnection | null>(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects));
    fetch("/api/connections").then((r) => r.json()).then((d) => setConnections(d.connections));
  }, []);


  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Connectors</h1>
          <p>Where approved cuts can go. Each one needs a developer app on your own account before it can post.</p>
        </div>
      </div>

      <div className="page-head" style={{ marginTop: 34 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Platforms</h1>
          <p>Nothing posts automatically. Approving a cut marks it ready — connecting a platform below needs a developer app + OAuth on your account, which isn&apos;t wired up yet.</p>
        </div>
      </div>
      <div className="connect-grid">
        {connections?.map((c) => (
          <div className="connect-tile" key={c.id}>
            <span className="label">{c.label}</span>
            <span className="pill faint"><span className="dot" />Not connected</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpenConnect(c)}>Connect</button>
          </div>
        ))}
      </div>

      {openConnect && (
        <Overlay onClose={() => setOpenConnect(null)}>
          <div className="modal">
            <div className="modal-head">
              <div><h3>Connect {openConnect.label}</h3><p>Not wired up yet</p></div>
              <button className="modal-close" onClick={() => setOpenConnect(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="flag-note info">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2.5l8 14.2H2z" /><path d="M10 8v4" /><circle cx="10" cy="14.3" r=".4" fill="currentColor" /></svg>
                <div>
                  Posting to {openConnect.label} needs a developer app registered on your own account
                  and an OAuth connection — that means your own developer credentials, and it
                  isn&apos;t something this app can set up for you. No credentials are collected here;
                  nothing is submitted anywhere by this dialog.
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setOpenConnect(null)} style={{ flex: "unset", width: "100%" }}>Close</button>
            </div>
          </div>
        </Overlay>
      )}
    </section>
  );
}
