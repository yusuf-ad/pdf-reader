"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// Panel genişlikleri localStorage'da tutulur (pdf-reader:panel-width:<id>)
const listeners = new Set<() => void>();
const storageKey = (id: string) => `pdf-reader:panel-width:${id}`;

function readWidth(id: string): number | null {
  const v = Number(localStorage.getItem(storageKey(id)));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function writeWidth(id: string, width: number | null) {
  if (width === null) localStorage.removeItem(storageKey(id));
  else localStorage.setItem(storageKey(id), String(Math.round(width)));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Props = {
  id: string;
  /** Tutamacın bulunduğu kenar: sağdaki panel için "left" */
  edge: "left" | "right";
  defaultWidth: number;
  minWidth: number;
  /** Okuma alanına en az bu kadar yer kalsın */
  minRemaining?: number;
  children: ReactNode;
};

export default function ResizablePanel({
  id,
  edge,
  defaultWidth,
  minWidth,
  minRemaining = 360,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const saved = useSyncExternalStore(subscribe, () => readWidth(id), () => null);
  // Sürüklerken her harekette localStorage'a yazmamak için geçici genişlik
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const clamp = (w: number) =>
    Math.round(Math.min(Math.max(w, minWidth), Math.max(minWidth, window.innerWidth - minRemaining)));
  const width = dragWidth ?? (saved ? clamp(saved) : defaultWidth);

  const widthAt = (clientX: number) => {
    const rect = panelRef.current!.getBoundingClientRect();
    return clamp(edge === "left" ? rect.right - clientX : clientX - rect.left);
  };

  return (
    <div ref={panelRef} style={{ width }} className="relative h-full shrink-0">
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Panel genişliği"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        tabIndex={0}
        title="Sürükleyerek genişliği ayarla · çift tıkla: varsayılan"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          setDragWidth(widthAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragWidth !== null) setDragWidth(widthAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (dragWidth === null) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          writeWidth(id, dragWidth);
          setDragWidth(null);
        }}
        onDoubleClick={() => writeWidth(id, null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          const grow = edge === "left" ? "ArrowLeft" : "ArrowRight";
          const shrink = edge === "left" ? "ArrowRight" : "ArrowLeft";
          if (e.key !== grow && e.key !== shrink) return;
          e.preventDefault();
          e.stopPropagation(); // okuyucunun sayfa değiştirme kısayolu çalışmasın
          writeWidth(id, clamp(width + (e.key === grow ? step : -step)));
        }}
        className={`group absolute inset-y-0 z-10 w-2 cursor-col-resize outline-none ${
          edge === "left" ? "-left-1" : "-right-1"
        }`}
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-ink/30 group-focus-visible:bg-ink/40 ${
            dragWidth !== null ? "bg-ink/40" : ""
          }`}
        />
      </div>
    </div>
  );
}
