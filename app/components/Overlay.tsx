"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Modal backdrop with the two dismissals people reach for without thinking:
 * Escape, and a click on the dark area outside the panel. Every dialog in the
 * app had neither, which left the ✕ as the only way out.
 */
export default function Overlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // a dialog over a scrollable page shouldn't let the page scroll behind it
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="overlay active"
      role="dialog"
      aria-modal="true"
      // only a click on the backdrop itself, not one that bubbled up from the panel
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}
