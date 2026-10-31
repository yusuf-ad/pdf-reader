"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Reader from "./reader";

// Chrome'daki bölünmüş görünüm gibi: iki kitap yan yana, her biri kendi araç çubuğu ve
// panelleriyle. Kısayollar ve yapıştırma yalnızca son tıklanan (etkin) bölmede çalışır.
// Düzen localStorage'da tutulur; sayfa yenilenince iki kitap da yeniden açılır.
// Bölmelerin yeri sekmeler gibi değiştirilebilir: başlıktan tutup yana sürükle ya da ⇄ düğmesi.
// Yer değişimi CSS `order` ile yapılır; DOM yerinden oynamaz, kaydırma ve çizimler korunur.

const LAYOUT_KEY = "pdf-reader:split";
// Her bölme en az bu kadar geniş kalsın (px)
const MIN_PANE = 360;
const DEFAULT_RATIO = 0.5;
// Başlık bu kadar sürüklenmeden sürükleme başlamaz (tıklama sayılır)
const DRAG_THRESHOLD = 6;

type Pane = {
  id: number;
  /** undefined: son okunan kitap, null: kitaplık, aksi halde bu kitap */
  initialBook?: string | null;
};

type Layout = { books?: (string | null)[]; ratio?: number };

function readLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Layout;
  } catch {
    return {};
  }
}

let nextId = 0;

function initialPanes(): Pane[] {
  const { books } = readLayout();
  return books?.length === 2
    ? books.map((b) => ({ id: nextId++, initialBook: b }))
    : [{ id: nextId++ }];
}

export default function SplitView() {
  const [panes, setPanes] = useState(initialPanes);
  const [active, setActive] = useState(0);
  const [ratio, setRatio] = useState(() => readLayout().ratio ?? DEFAULT_RATIO);
  const [dragging, setDragging] = useState(false);
  // Sağdaki bölme solda mı (görsel sıra; DOM sırası değişmez)
  const [swapped, setSwapped] = useState(false);
  // Başlığından sürüklenen bölme; `over`: öbür bölmenin üstünde, bırakılınca yer değişir
  const [paneDrag, setPaneDrag] = useState<{ id: number; over: boolean } | null>(null);
  // Her bölmede açık olan kitap (düzeni kaydetmek için)
  const [books, setBooks] = useState<Record<number, string | null>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const split = panes.length === 2;
  // Ekranda soldan sağa sıra
  const ordered = swapped ? [...panes].reverse() : panes;

  useEffect(() => {
    try {
      const layout: Layout = {
        ratio,
        ...(split && { books: (swapped ? [...panes].reverse() : panes).map((p) => books[p.id] ?? null) }),
      };
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // yalnızca bu oturumda geçerli
    }
  }, [panes, swapped, books, ratio, split]);

  const openSplit = () => {
    setPanes((ps) => (ps.length === 2 ? ps : [...ps, { id: nextId++, initialBook: null }]));
    setActive(1);
  };

  const closePane = (id: number) => {
    setPanes((ps) => ps.filter((p) => p.id !== id));
    setActive(0);
    setSwapped(false);
  };

  const swapPanes = () => setSwapped((s) => !s);

  // Chrome'daki sekme gibi: başlıktan tutup öbür yarıya sürükleyip bırakınca yer değişir
  const startPaneDrag = (id: number, e: PointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const fromLeft = ordered[0].id === id;
    let started = false;
    let over = false;

    const onMove = (ev: globalThis.PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
        started = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const rect = rootRef.current!.getBoundingClientRect();
      const divider = rect.left + rect.width * ratio;
      over = fromLeft ? ev.clientX > divider : ev.clientX < divider;
      setPaneDrag({ id, over });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!started) return;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPaneDrag(null);
      if (over) swapPanes();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const ratioAt = (clientX: number) => {
    const rect = rootRef.current!.getBoundingClientRect();
    const min = Math.min(0.5, MIN_PANE / rect.width);
    return Math.min(1 - min, Math.max(min, (clientX - rect.left) / rect.width));
  };

  return (
    <div ref={rootRef} className="flex h-screen">
      {split && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Bölme genişliği"
          title="Sürükleyerek genişliği ayarla · çift tıkla: eşit"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            setDragging(true);
          }}
          onPointerMove={(e) => dragging && setRatio(ratioAt(e.clientX))}
          onPointerUp={(e) => {
            if (!dragging) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setDragging(false);
          }}
          onDoubleClick={() => setRatio(DEFAULT_RATIO)}
          style={{ order: 1 }}
          className="group relative z-20 w-1.5 shrink-0 cursor-col-resize bg-rule/60"
        >
          <span
            className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-ink/40 ${
              dragging ? "bg-ink/50" : "bg-rule"
            }`}
          />
        </div>
      )}
      {panes.map((pane, i) => {
        // Ekrandaki yeri: 0 sol, 1 sağ
        const pos = ordered.indexOf(pane);
        const dragged = paneDrag?.id === pane.id;
        const target = paneDrag !== null && !dragged && paneDrag.over;
        return (
          <div
            key={pane.id}
            onPointerDownCapture={() => setActive(i)}
            onFocusCapture={() => setActive(i)}
            style={
              split ? { order: pos * 2, flexBasis: `${(pos === 0 ? ratio : 1 - ratio) * 100}%` } : undefined
            }
            // Dar bölmede taşan araç çubuğu yandakinin üstüne binmesin
            className="relative min-w-0 flex-1 overflow-hidden"
          >
            <Reader
              pane={{
                split,
                active: active === i,
                primary: i === 0,
                initialBook: pane.initialBook,
                onBookChange: (key) => setBooks((b) => (b[pane.id] === key ? b : { ...b, [pane.id]: key })),
                onSplit: split ? undefined : openSplit,
                onClosePane: split ? () => closePane(pane.id) : undefined,
                onSwapPanes: split ? swapPanes : undefined,
                onPaneDragStart: split ? (e) => startPaneDrag(pane.id, e) : undefined,
              }}
            />
            {split && active === i && (
              // Etkin bölme: kısayollar ve yapıştırma buraya gider
              <span className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 bg-accent/70" />
            )}
            {dragged && (
              // Sürüklenen bölme: yerinden kalkıyor
              <span className="pointer-events-none absolute inset-0 z-50 bg-paper/50" />
            )}
            {target && (
              <span className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-accent/70 bg-accent/5">
                <span className="border border-rule bg-paper px-3 py-1.5 font-serif text-sm">
                  Bırak: yer değiştir
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
