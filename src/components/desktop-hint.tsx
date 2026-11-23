"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "pdf-reader:desktop-hint-dismissed";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DesktopHint() {
  const [dismissed, setDismissed] = useState(false);
  const saved = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed || saved) return null;

  return (
    <aside className="desktop-hint" aria-label="Mobil okuma bilgisi">
      <p>En iyi masaüstünde çalışır — telefonda temel okuma desteklenir.</p>
      <button
        type="button"
        aria-label="Masaüstü önerisini kapat"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(STORAGE_KEY, "1");
          } catch {
            // Depolama kapalıysa bu oturumda yine de gizle.
          }
        }}
      >
        ×
      </button>
    </aside>
  );
}
