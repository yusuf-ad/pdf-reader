"use client";

import { useT } from "@/lib/i18n";

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
  const t = useT("library");
  const [dismissed, setDismissed] = useState(false);
  const saved = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed || saved) return null;

  return (
    <aside className="desktop-hint" aria-label={t("desktopInfo")}>
      <p>{t("desktopMessage")}</p>
      <button
        type="button"
        aria-label={t("desktopDismiss")}
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
