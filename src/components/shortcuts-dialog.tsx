"use client";

import { useT } from "@/lib/i18n";

import { useEffect } from "react";
import { LanguageSwitcher } from "./library";
import { openOnboarding } from "./onboarding";

const SHORTCUTS = [
  ["Ctrl + K", "shortcutsAsk"],
  ["L", "shortcutsLibrary"],
  ["→  /  ←", "shortcutsPages"],
  ["Home  /  End", "shortcutsEnds"],
  ["G", "shortcutsGoTo"],
  ["Ctrl + F", "shortcutsSearch"],
  ["Enter  /  Shift + Enter", "shortcutsSearchNext"],
  ["Ctrl + +  /  Ctrl + −", "shortcutsZoom"],
  ["Ctrl + 0", "shortcutsZoomReset"],
  ["shortcutsKeyWheel", "shortcutsMouseZoom"],
  ["W  /  P", "shortcutsFit"],
  ["B", "shortcutsBookmark"],
  ["F", "shortcutsFocus"],
  ["[  /  ]", "shortcutsPanels"],
  ["shortcutsKeyDoubleClick", "shortcutsTranslate"],
  ["H", "shortcutsHighlight"],
  ["D  /  M  /  T  /  E", "shortcutsTools"],
  ["shortcutsKeyDrag", "shortcutsStraightLine"],
  ["shortcutsKeyRightClick", "shortcutsEraser"],
  ["N", "shortcutsNotes"],
  ["Q", "shortcutsCrop"],
  ["Ctrl + V", "shortcutsPaste"],
  ["Ctrl + Z", "shortcutsUndo"],
  ["Ctrl + S", "shortcutsSave"],
  ["Ctrl + Shift + S", "shortcutsSaveAs"],
  ["Esc", "shortcutsClose"],
  ["?", "shortcutsShow"],
] as const;

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT("library");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label={t("shortcutsTitle")} className="max-h-[calc(100dvh-2rem)] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto border border-rule bg-sheet p-6 shadow-[0_8px_30px_var(--shadow)]">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-serif text-xl">{t("shortcutsTitle")}</h2>
          <LanguageSwitcher />
        </div>
        <section className="mt-4 border-y border-rule py-4">
          <h3 className="font-serif text-lg">{t("shortcutsGettingStarted")}</h3>
          <p className="mt-1 text-sm text-muted">{t("shortcutsDescription")}</p>
          <button onClick={() => { onClose(); openOnboarding(); }} className="mt-2 text-sm underline underline-offset-4 hover:text-accent">{t("shortcutsRestart")}</button>
        </section>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs leading-5 whitespace-nowrap text-muted">{keys === "shortcutsKeyWheel" || keys === "shortcutsKeyDoubleClick" || keys === "shortcutsKeyDrag" || keys === "shortcutsKeyRightClick" ? t(keys) : keys}</dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
