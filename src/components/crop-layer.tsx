"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CropRegion = { x: number; y: number; w: number; h: number };
/** Seçimin bir sayfaya düşen parçası */
export type CropPart = { page: number; region: CropRegion };

// Bundan küçük seçimler yanlışlıkla tıklama sayılır
const MIN_SIZE = 12;
// İmleç kaydırma kutusunun kenarına bu kadar yaklaşınca sayfa kendiliğinden kayar
const EDGE = 48;
const MAX_SPEED = 24;

type Props = {
  page: number;
  /** Seçimin kesiştiği sayfalar, yukarıdan aşağı; bölgeler sayfaya oranla (0–1) */
  onCrop: (parts: CropPart[]) => void;
};

type Drag = {
  /** Başlangıç noktası, başladığı sayfanın çerçevesine göre (kaydırınca da yerinde kalsın) */
  frame: HTMLElement;
  ax: number;
  ay: number;
  /** İmlecin ekrandaki son konumu */
  cx: number;
  cy: number;
};

/**
 * Soru kırpma: sayfada dikdörtgen çizilir, bırakınca bölge bildirilir.
 * Seçim sayfa sınırını aşabilir; alt alta sayfalara taşan kısımlar da alınır.
 */
export default function CropLayer({ page, onCrop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Kaydırınca seçim kutusu yeniden hesaplansın
  const [, setTick] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  });

  const scrollRoot = () => ref.current?.closest<HTMLElement>("[data-scroll-root]") ?? null;

  // Sürüklerken kaydırma (tekerlek ya da kenara yaklaşma) seçimi bozmasın
  useEffect(() => {
    if (!drag) return;
    const root = scrollRoot();
    if (!root) return;
    const onScroll = () => setTick((t) => t + 1);
    root.addEventListener("scroll", onScroll, { passive: true });
    let raf = 0;
    const step = () => {
      const d = dragRef.current;
      if (d) {
        const r = root.getBoundingClientRect();
        let dy = 0;
        if (d.cy < r.top + EDGE) dy = -Math.min(MAX_SPEED, (r.top + EDGE - d.cy) / 2);
        else if (d.cy > r.bottom - EDGE) dy = Math.min(MAX_SPEED, (d.cy - (r.bottom - EDGE)) / 2);
        if (dy) root.scrollTop += dy;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
    // Yalnızca sürükleme başlayıp bitince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  /** Seçim kutusu, ekran koordinatlarında */
  const rectOf = (d: Drag) => {
    const f = d.frame.getBoundingClientRect();
    const ax = f.left + d.ax;
    const ay = f.top + d.ay;
    return {
      left: Math.min(ax, d.cx),
      top: Math.min(ay, d.cy),
      right: Math.max(ax, d.cx),
      bottom: Math.max(ay, d.cy),
    };
  };

  const finish = (d: Drag) => {
    const sel = rectOf(d);
    if (sel.right - sel.left < MIN_SIZE || sel.bottom - sel.top < MIN_SIZE) return;
    const root = scrollRoot() ?? document;
    const parts: CropPart[] = [];
    root.querySelectorAll<HTMLElement>("figure[data-page-number]").forEach((fig) => {
      const frame = fig.querySelector<HTMLElement>(".page-frame");
      if (!frame) return;
      const f = frame.getBoundingClientRect();
      const left = Math.max(sel.left, f.left);
      const right = Math.min(sel.right, f.right);
      const top = Math.max(sel.top, f.top);
      const bottom = Math.min(sel.bottom, f.bottom);
      // Sayfaya düşen ince şeritler (ör. kenara birkaç piksel taşma) atlanır
      if (right - left < 2 || bottom - top < 4) return;
      parts.push({
        page: Number(fig.dataset.pageNumber),
        region: {
          x: (left - f.left) / f.width,
          y: (top - f.top) / f.height,
          w: (right - left) / f.width,
          h: (bottom - top) / f.height,
        },
      });
    });
    parts.sort((a, b) => a.page - b.page);
    if (parts.length) onCrop(parts);
  };

  const box = drag && rectOf(drag);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const frame = e.currentTarget.parentElement!;
        const f = frame.getBoundingClientRect();
        setDrag({ frame, ax: e.clientX - f.left, ay: e.clientY - f.top, cx: e.clientX, cy: e.clientY });
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setDrag((d) => d && { ...d, cx: e.clientX, cy: e.clientY });
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDrag(null);
        if (drag) finish({ ...drag, cx: e.clientX, cy: e.clientY });
      }}
      onPointerCancel={() => setDrag(null)}
      data-crop-page={page}
      style={{ cursor: "crosshair", touchAction: "none" }}
      className="absolute inset-0 z-30 select-none"
    >
      {box &&
        // Sayfa çerçevesi taşanı kestiği için kutu sayfanın dışında, ekranın üstünde çizilir.
        // Seçilen alan dışı karartılır.
        createPortal(
          <div
            style={{
              position: "fixed",
              left: box.left,
              top: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
              cursor: "crosshair",
            }}
            className="pointer-events-none z-50 border border-dashed border-accent"
          />,
          document.body,
        )}
    </div>
  );
}
