"use client";

import { useState } from "react";
import VoiceInput from "@/app/components/VoiceInput";

/**
 * Grant and prove the microphone, away from any edit.
 *
 * The voice box lives inside the graphic dialog, which is a bad place to
 * discover that permission was never granted. Here it can be turned on and
 * heard working before it matters.
 */
export default function MicCheck() {
  const [heard, setHeard] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "ok" | "denied">("idle");

  return (
    <>
      <VoiceInput
        label="Hold and say something to test it"
        onText={(t) => { setHeard(t); setState(t ? "ok" : "idle"); }}
      />
      {heard && (
        <div className="flag-note info" style={{ marginTop: 4 }}>
          <div>
            <b>Heard you:</b> “{heard}”
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
              Transcribed locally by faster-whisper. Nothing was uploaded.
            </div>
          </div>
        </div>
      )}
      {state === "idle" && !heard && (
        <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5 }}>
          If nothing happens, macOS is blocking it: System Settings › Privacy &amp; Security ›
          Microphone, and switch SnipAi on.
        </p>
      )}
    </>
  );
}
