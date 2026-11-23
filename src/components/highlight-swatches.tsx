"use client";

import { useT } from "@/lib/i18n";
import { HIGHLIGHT_COLORS } from "@/lib/annotations";

/** Seçili metni vurgulamak için renk düğmeleri (seçim kaybolmasın diye mousedown engellenir). */
export default function HighlightSwatches({
  current,
  onPick,
}: {
  current: string;
  onPick: (color: string) => void;
}) {
  const t = useT("reader");
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5" onMouseDown={(e) => e.preventDefault()}>
      <span className="mr-0.5 text-xs text-muted">{t("swatchesHighlight")}</span>
      {HIGHLIGHT_COLORS.map(({ color, label }) => (
        <button
          key={color}
          onClick={() => onPick(color)}
          aria-label={t("swatchesHighlightColor", { color: t(label) })}
          title={`${t("swatchesHighlightColor", { color: t(label) })}${color === current ? t("swatchesShortcut") : ""}`}
          style={{ background: color }}
          className={`h-3.5 w-3.5 rounded-full transition-opacity ${
            color === current ? "ring-1 ring-ink ring-offset-1 ring-offset-sheet" : "opacity-60 hover:opacity-100"
          }`}
        />
      ))}
    </div>
  );
}
