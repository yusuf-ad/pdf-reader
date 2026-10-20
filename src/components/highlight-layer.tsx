"use client";

import { useEffect, useRef, useState } from "react";
import {
  HIGHLIGHT_COLORS,
  highlightHit,
  removeAnnotations,
  strokePath,
  updateHighlight,
  usePageAnnotations,
  type Highlight,
  type Tool,
} from "@/lib/annotations";

type Props = {
  book: string;
  page: number;
  width: number;
  height: number;
  tool: Tool | null;
  /** Vurgulanan metni sohbete sor */
  onAsk: (text: string, page: number) => void;
};

/**
 * Metin vurguları. Tıklamaları geçirir (metin seçimi bozulmasın); bir vurgunun üstüne
 * tıklanınca renk değiştirme, sorma ve silme menüsü açılır.
 */
export default function HighlightLayer({ book, page, width: w, height: h, tool, onAsk }: Props) {
  const items = usePageAnnotations(book, page);
  const highlights = items.filter((a): a is Highlight => a.type === "highlight");
  const markers = items.filter((a) => a.type === "ink" && a.marker);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const active = menu && highlights.find((hl) => hl.id === menu.id);

  // Vurgunun üstüne tıklanınca menüyü aç (katman tıklamaları geçirdiği için sayfadan dinlenir)
  const hitsRef = useRef(highlights);
  useEffect(() => {
    hitsRef.current = highlights;
  });
  useEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame || tool) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      // Notun kendi menüsü var
      if ((e.target as HTMLElement).closest?.("[data-note-id]")) return setMenu(null);
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return setMenu(null);
      const rect = frame.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const hit = hitsRef.current.findLast((hl) => highlightHit(hl, x, y));
      setMenu(hit ? { id: hit.id, x, y } : null);
    };
    frame.addEventListener("click", onClick);
    return () => frame.removeEventListener("click", onClick);
  }, [tool]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu]);

  return (
    // z-index yok: kendi katman bağlamı oluşmasın, karışım (multiply) alttaki sayfayla yapılsın
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {markers.length > 0 && (
        // Fosforlu kalem izleri: vurgular gibi yarı saydam ve sayfayla karışır
        <svg width={w} height={h} className="highlight-rect absolute inset-0 overflow-visible" aria-hidden>
          {markers.map(
            (a) =>
              a.type === "ink" && (
                <path
                  key={a.id}
                  d={strokePath(a.points, w, h)}
                  stroke={a.color}
                  strokeWidth={a.width * w}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
          )}
        </svg>
      )}
      {highlights.map((hl) =>
        Array.from({ length: hl.rects.length / 4 }, (_, i) => {
          const [x, y, rw, rh] = hl.rects.slice(i * 4, i * 4 + 4);
          return (
            <div
              key={`${hl.id}:${i}`}
              className="highlight-rect absolute"
              style={{
                left: x * w,
                top: y * h,
                width: rw * w,
                height: rh * h,
                background: hl.color,
                // Yazı görünsün: yarı saydam fosforlu kalem (temaya göre globals.css'te ayarlanır)
                opacity: "var(--hl-opacity, 0.35)",
                mixBlendMode: "var(--hl-blend, multiply)" as React.CSSProperties["mixBlendMode"],
                outline: active?.id === hl.id ? `1.5px solid ${hl.color}` : undefined,
              }}
            />
          );
        }),
      )}

      {active && menu && (
        <div
          ref={menuRef}
          onMouseDown={(e) => e.preventDefault()}
          onMouseUp={(e) => e.stopPropagation()}
          style={{
            left: Math.min(menu.x * w, w - 230),
            // Sayfanın altında menü kesilmesin diye üste aç
            top: menu.y > 0.9 ? menu.y * h - 44 : menu.y * h + 14,
          }}
          className="pointer-events-auto absolute z-30 flex items-center gap-1.5 border border-rule bg-sheet px-2 py-1.5 text-xs shadow-[0_4px_16px_var(--shadow)]"
        >
          {HIGHLIGHT_COLORS.map(({ color, label }) => (
            <button
              key={color}
              onClick={() => updateHighlight(book, page, active.id, { color })}
              aria-label={label}
              title={label}
              style={{ background: color }}
              className={`h-4 w-4 rounded-full ${
                active.color === color ? "ring-1 ring-ink ring-offset-1 ring-offset-sheet" : "opacity-70 hover:opacity-100"
              }`}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-rule" />
          <button
            onClick={() => {
              setMenu(null);
              onAsk(active.text, page);
            }}
            className="px-1 text-muted hover:text-ink"
          >
            Sor
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(active.text).catch(() => {});
              setMenu(null);
            }}
            className="px-1 text-muted hover:text-ink"
          >
            Kopyala
          </button>
          <button
            onClick={() => {
              setMenu(null);
              removeAnnotations(book, page, [active.id]);
            }}
            className="px-1 text-muted hover:text-accent"
          >
            Sil
          </button>
        </div>
      )}
    </div>
  );
}
