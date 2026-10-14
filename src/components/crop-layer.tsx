"use client";

import { useRef, useState } from "react";

export type CropRegion = { x: number; y: number; w: number; h: number };

// Bundan küçük seçimler yanlışlıkla tıklama sayılır
const MIN_SIZE = 12;

type Props = {
  page: number;
  width: number;
  height: number;
  /** Bölge sayfaya oranla (0–1) */
  onCrop: (page: number, region: CropRegion) => void;
};

/** Soru kırpma: sayfada dikdörtgen çizilir, bırakınca bölge bildirilir. */
export default function CropLayer({ page, width: w, height: h, onCrop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const point = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(w, Math.max(0, e.clientX - rect.left)),
      y: Math.min(h, Math.max(0, e.clientY - rect.top)),
    };
  };

  const box = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const { x, y } = point(e);
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const { x, y } = point(e);
        setDrag((d) => d && { ...d, x1: x, y1: y });
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDrag(null);
        if (box && box.width >= MIN_SIZE && box.height >= MIN_SIZE) {
          onCrop(page, { x: box.left / w, y: box.top / h, w: box.width / w, h: box.height / h });
        }
      }}
      onPointerCancel={() => setDrag(null)}
      style={{ cursor: "crosshair", touchAction: "none" }}
      className="absolute inset-0 z-30 select-none"
    >
      {box && (
        // Seçilen alan dışı karartılır
        <div
          style={{ ...box, boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)" }}
          className="absolute border border-dashed border-accent"
        />
      )}
    </div>
  );
}
