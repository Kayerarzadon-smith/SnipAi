"use client";

import { useRef, useState } from "react";

/**
 * Hold to talk; the words land in the field.
 *
 * Recorded in the page, transcribed by the same local faster-whisper the rest
 * of the pipeline uses, and deleted. Nothing is uploaded anywhere -- doing the
 * whole pipeline on this machine counts for little if the microphone is the
 * exception.
 */
export default function VoiceInput({
  onText,
  label = "Describe it out loud",
}: {
  onText: (text: string) => void;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("working");
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, "note.webm");
        try {
          const res = await fetch("/api/voice", { method: "POST", body: fd });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) setError(body.error ?? "could not transcribe that");
          else if (body.text) onText(body.text);
          else setError("didn't catch anything");
        } catch {
          setError("could not reach the transcriber");
        }
        setState("idle");
      };
      mr.start();
      rec.current = mr;
      setState("recording");
    } catch {
      // the usual cause is the OS or the WebView refusing the mic
      setError("no microphone access — allow it for SnipAi in System Settings › Privacy");
      setState("idle");
    }
  }

  function stop() {
    rec.current?.stop();
    rec.current = null;
  }

  return (
    <div className="voice">
      <button
        type="button"
        className={`ui-btn ui-btn-sm voice-btn${state === "recording" ? " rec" : ""}`}
        disabled={state === "working"}
        onMouseDown={start}
        onMouseUp={stop}
        onMouseLeave={() => { if (state === "recording") stop(); }}
        onTouchStart={(e) => { e.preventDefault(); start(); }}
        onTouchEnd={stop}
      >
        <span className="voice-dot" />
        {state === "recording" ? "Listening — let go when done"
          : state === "working" ? "Writing it down…"
          : label}
      </button>
      {error && <div className="voice-err">{error}</div>}
    </div>
  );
}
