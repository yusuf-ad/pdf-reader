"use client";

import { useEffect, useRef, useState } from "react";
import {
  addAnnotation,
  highlightHit,
  newId,
  removeAnnotations,
  strokeHit,
  strokePath,
  updateNote,
  updatePicture,
  usePageAnnotations,
  type Note,
  type Picture,
  type Tool,
} from "@/lib/annotations";

// Sayfa genişliğine oranla: 820px genişlikte ~2.3px kalem, ~16px yazı
const PEN_WIDTH = 0.0028;
const TEXT_SIZE = 0.02;
// Fosforlu kalem: bir satır yazıyı kaplayacak kadar (~13px)
const MARKER_WIDTH = 0.016;
const ERASER_RADIUS = 8;
// Bu kadar px'ten yakın noktalar atlanır (kayıt küçük kalsın)
const MIN_POINT_GAP = 1.5;
// Görsel bundan küçük boyutlandırılamaz (px)
const MIN_PICTURE_SIZE = 24;

const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7.5" fill="white" fill-opacity=".6" stroke="black"/></svg>`,
)}") 9 9, cell`;

const CURSORS: Record<Tool, string> = {
  pen: "crosshair",
  marker: "crosshair",
  text: "text",
  eraser: ERASER_CURSOR,
};

type Props = {
  book: string;
  page: number;
  width: number;
  height: number;
  tool: Tool | null;
  color: string;
};

/** Sayfanın üstünde kalem çizgileri ve yazılar. Araç seçili değilken tıklamaları geçirir. */
export default function AnnotationLayer({ book, page, width: w, height: h, tool, color }: Props) {
  const items = usePageAnnotations(book, page);
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [newNote, setNewNote] = useState<Note | null>(null);
  const [editingId, setEditing] = useState<string | null>(null);
  // Başka bir araca geçince düzenleme biter (araçsızken menüden düzenlenebilir)
  const editing = tool === "text" || !tool ? editingId : null;
  // Araç seçili değilken tıklanan notun ya da görselin menüsü
  const [menuId, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItem = !tool
    ? items.find((a): a is Note | Picture => (a.type === "text" || a.type === "image") && a.id === menuId)
    : undefined;

  useEffect(() => {
    if (!menuItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      if (e.key === "Delete" || e.key === "Backspace") {
        setMenu(null);
        removeAnnotations(book, page, [menuItem.id]);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menuItem, book, page]);
  // Sağ tık basılı tutulurken geçici silgi
  const [rightErase, setRightErase] = useState(false);
  const active = rightErase ? "eraser" : tool;

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const erase = (e: React.PointerEvent) => {
    const { x, y } = point(e);
    const ids = items
      .filter(
        (a) =>
          (a.type === "ink" && strokeHit(a, x, y, w, h, ERASER_RADIUS)) ||
          (a.type === "highlight" && highlightHit(a, x / w, y / h)),
      )
      .map((a) => a.id);
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const id = el.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (id && ref.current?.contains(el)) ids.push(id);
    }
    if (ids.length) removeAnnotations(book, page, ids);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!tool) return;
    if (e.button === 2) {
      // Düzenlenen notun içinde sağ tık, yazının kendi menüsü için kalsın
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft(null);
      setRightErase(true);
      erase(e);
      return;
    }
    if (e.button !== 0) return;
    if (tool === "text") {
      // Düzenleme sürerken boşluğa tıklamak yalnızca düzenlemeyi bitirir
      if (editing || newNote) return;
      if ((e.target as HTMLElement).closest("[data-note-id]")) return;
      e.preventDefault();
      const { x, y } = point(e);
      const size = TEXT_SIZE;
      // Tıklanan nokta ilk satırın ortasına gelsin
      setNewNote({
        id: newId(),
        type: "text",
        color,
        x: x / w,
        y: Math.max(0, (y - size * w * 0.65) / h),
        size,
        text: "",
      });
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") erase(e);
    else {
      const { x, y } = point(e);
      setDraft([x / w, y / h]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (active === "eraser") return erase(e);
    if (active !== "pen" && active !== "marker") return;
    // Shift basılıyken fosforlu kalem düz çizer (satırın altını çizmek gibi)
    if (active === "marker" && e.shiftKey) {
      const { x, y } = point(e);
      setDraft((pts) => pts && [pts[0], pts[1], +(x / w).toFixed(4), +(y / h).toFixed(4)]);
      return;
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    setDraft((pts) => {
      if (!pts) return pts;
      const next = [...pts];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const { x, y } = point(ev);
        const lx = next[next.length - 2] * w;
        const ly = next[next.length - 1] * h;
        if (Math.hypot(x - lx, y - ly) >= MIN_POINT_GAP) next.push(+(x / w).toFixed(4), +(y / h).toFixed(4));
      }
      return next;
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setRightErase(false);
    if (active === "pen" && draft) {
      addAnnotation(book, page, {
        id: newId(),
        type: "ink",
        color,
        width: PEN_WIDTH,
        points: draft,
      });
    }
    if (active === "marker" && draft) {
      addAnnotation(book, page, {
        id: newId(),
        type: "ink",
        color,
        width: MARKER_WIDTH,
        points: draft,
        marker: true,
      });
    }
    setDraft(null);
  };

  const notes = items.filter((a): a is Note => a.type === "text");
  const pictures = items.filter((a): a is Picture => a.type === "image");

  return (
    <>
      <div
        ref={ref}
        data-annotation-layer
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          if (tool && !(e.target as HTMLElement).isContentEditable) e.preventDefault();
        }}
        style={{
          cursor: active ? CURSORS[active] : undefined,
          pointerEvents: tool ? "auto" : "none",
          touchAction: tool ? "none" : undefined,
        }}
        // Yazı ve çizgiler de sayfa gibi temaya uyar (koyu temada siyah mürekkep açık görünür)
        className="absolute inset-0 z-10 select-none [filter:var(--page-filter)]"
      >
        {/* Görseller çizgilerin altında: ekran görüntüsünün üstüne kalemle yazılabilir */}
        {pictures.map((pic) => (
          <PictureView
            key={pic.id}
            picture={pic}
            w={w}
            h={h}
            tool={active}
            selected={menuItem?.id === pic.id}
            onClick={() => !tool && setMenu(pic.id)}
            onChange={(patch) => updatePicture(book, page, pic.id, patch)}
          />
        ))}

        <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden>
          {/* Fosforlu kalem izleri HighlightLayer'da, sayfayla karışarak çizilir */}
          {items.map(
            (a) =>
              a.type === "ink" &&
              !a.marker && (
                <path
                  key={a.id}
                  d={strokePath(a.points, w, h)}
                  stroke={a.color}
                  strokeWidth={Math.max(1, a.width * w)}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
          )}
          {draft && (
            <path
              d={strokePath(draft, w, h)}
              stroke={color}
              strokeOpacity={active === "marker" ? 0.35 : 1}
              strokeWidth={Math.max(1, (active === "marker" ? MARKER_WIDTH : PEN_WIDTH) * w)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {notes.map((note) => (
          <NoteView
            key={`${note.id}:${editing === note.id}`}
            note={note}
            w={w}
            h={h}
            tool={active}
            editing={editing === note.id}
            onClick={() => (tool === "text" ? setEditing(note.id) : !tool && setMenu(note.id))}
            onMove={(x, y) => updateNote(book, page, note.id, { x, y })}
            onCommit={(text) => {
              setEditing(null);
              if (!text.trim()) removeAnnotations(book, page, [note.id]);
              else if (text !== note.text) updateNote(book, page, note.id, { text });
            }}
          />
        ))}
        {newNote && (
          <NoteView
            note={newNote}
            w={w}
            h={h}
            tool={active}
            editing
            onCommit={(text) => {
              setNewNote(null);
              if (text.trim()) addAnnotation(book, page, { ...newNote, text });
            }}
          />
        )}
      </div>
      {menuItem && (
        // Katmanın dışında: sayfa filtresi (koyu tema) menünün renklerini bozmasın
        <div
          ref={menuRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            left: Math.max(0, Math.min(menuItem.x * w, w - 120)),
            top:
              menuItem.y >= 0.05
                ? menuItem.y * h - 34
                : menuItem.type === "text"
                  ? menuItem.y * h + menuItem.size * w * 1.6
                  : (menuItem.y + menuItem.height) * h + 6,
          }}
          className="absolute z-30 flex items-center gap-1.5 border border-rule bg-sheet px-2 py-1.5 text-xs shadow-[0_4px_16px_var(--shadow)]"
        >
          {menuItem.type === "text" && (
            <button
              onClick={() => {
                setMenu(null);
                setEditing(menuItem.id);
              }}
              className="px-1 text-muted hover:text-ink"
            >
              Düzenle
            </button>
          )}
          <button
            onClick={() => {
              setMenu(null);
              removeAnnotations(book, page, [menuItem.id]);
            }}
            className="px-1 text-muted hover:text-accent"
          >
            Sil
          </button>
        </div>
      )}
    </>
  );
}

/** Yapıştırılan görsel: sürükleyerek taşınır, sağ alt köşeden oranı korunarak boyutlandırılır. */
function PictureView({
  picture: p,
  w,
  h,
  tool,
  selected,
  onClick,
  onChange,
}: {
  picture: Picture;
  w: number;
  h: number;
  tool: Tool | null;
  selected: boolean;
  /** Sürüklemeden tıklanınca */
  onClick: () => void;
  onChange: (patch: Partial<Picture>) => void;
}) {
  // Sürüklenirken geçici kayma ya da genişlik farkı (px)
  const [offset, setOffset] = useState<{ dx: number; dy: number; dw: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; resize: boolean; moved: boolean } | null>(null);
  // Kalem ve yazıda tıklamalar geçer (görselin üstüne yazılır); silgide katman siler
  const interactive = !tool || tool === "eraser";
  const ratio = (p.height * h) / (p.width * w);
  const left = p.x * w + (offset?.dx ?? 0);
  const top = p.y * h + (offset?.dy ?? 0);
  const width = p.width * w + (offset?.dw ?? 0);

  const start = (e: React.PointerEvent, resize: boolean) => {
    if (tool || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, resize, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    if (drag.resize) {
      // Köşe hangi yöne daha çok çekildiyse ona göre; oran korunur
      const dw = Math.abs(dx) > Math.abs(dy) ? dx : dy / ratio;
      setOffset({ dx: 0, dy: 0, dw: Math.max(MIN_PICTURE_SIZE - p.width * w, dw) });
    } else setOffset({ dx, dy, dw: 0 });
  };
  const end = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved || !offset) {
      if (!drag.resize) onClick();
      return;
    }
    setOffset(null);
    if (drag.resize) onChange({ width: width / w, height: (width * ratio) / h });
    else {
      // Bir köşesi sayfada kalsın
      const x = Math.min(0.98, Math.max(0.02 - p.width, left / w));
      const y = Math.min(0.98, Math.max(0.02 - p.height, top / h));
      onChange({ x, y });
    }
  };

  return (
    <div
      // Silgi ve vurgu katmanı notlar gibi bulsun
      data-note-id={p.id}
      onPointerDown={(e) => start(e, false)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title={!tool ? "Taşımak için sürükle; boyutlandırmak ya da silmek için tıkla" : undefined}
      style={{
        left,
        top,
        width,
        height: width * ratio,
        pointerEvents: interactive ? "auto" : "none",
        cursor: !tool ? "move" : undefined,
      }}
      className={`absolute ${selected ? "ring-1 ring-accent" : !tool ? "hover:ring-1 hover:ring-ink/30" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.src} alt="" draggable={false} className="h-full w-full" />
      {selected && (
        <span
          onPointerDown={(e) => start(e, true)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          title="Boyutlandır"
          className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize border border-accent bg-sheet"
        />
      )}
    </div>
  );
}

function NoteView({
  note,
  w,
  h,
  tool,
  editing,
  onClick,
  onMove,
  onCommit,
}: {
  note: Note;
  w: number;
  h: number;
  tool: Tool | null;
  editing: boolean;
  /** Sürüklemeden tıklanınca */
  onClick?: () => void;
  onMove?: (x: number, y: number) => void;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Sürüklenirken notun geçici konumu (px kayması)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    // İmleci metnin sonuna koy
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  // Her araçta tutulup taşınabilir (kalemle cevap işaretledikten sonra asistanın notu da);
  // silgide tıklama katmana geçer, not silinir
  const draggable = tool !== "eraser" && !editing;

  return (
    <div
      ref={ref}
      data-note-id={note.id}
      contentEditable={editing ? "plaintext-only" : false}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => editing && onCommit(e.currentTarget.innerText.replace(/\n$/, ""))}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !e.shiftKey && continueList(e.currentTarget)) {
          e.preventDefault();
        }
      }}
      onInput={(e) => renumberLists(e.currentTarget)}
      onPointerDown={(e) => {
        if (!draggable || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        setOffset({ dx, dy });
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        if (drag.moved && offset) {
          const x = Math.min(0.98, Math.max(0, note.x + offset.dx / w));
          const y = Math.min(0.98, Math.max(0, note.y + offset.dy / h));
          setOffset(null);
          onMove?.(x, y);
        } else onClick?.();
      }}
      title={
        !draggable
          ? undefined
          : !tool || tool === "text"
            ? "Düzenlemek ya da silmek için tıkla, taşımak için sürükle"
            : "Taşımak için sürükle"
      }
      style={{
        left: note.x * w + (offset?.dx ?? 0),
        top: note.y * h + (offset?.dy ?? 0),
        maxWidth: note.width ? note.width * w : Math.max(80, (1 - note.x) * w - 8),
        fontSize: note.size * w,
        color: note.color,
        pointerEvents: "auto",
        cursor: draggable ? "move" : undefined,
      }}
      className={`absolute min-w-[2ch] font-sans leading-[1.3] break-words whitespace-pre-wrap outline-none ${
        editing
          ? "bg-white/70 ring-1 ring-current/40 select-text"
          : draggable
            ? "hover:ring-1 hover:ring-current/30"
            : ""
      }`}
    >
      {note.text}
    </div>
  );
}

// Numaralı ("1.", "2)", "3-", "4 ") ve madde işaretli ("-", "•") satırlar.
// Noktalamasız numara 3 haneyle sınırlı ki "2024 yılında" gibi satırlar liste sayılmasın
const LIST_ITEM = /^(\s*)(?:(\d+)([.)-])|(\d{1,3})()|([-*•]))(\s+)(.*)$/;

/**
 * Enter'da listeye devam: imlecin olduğu satır "2. …" ise yeni satır "3. " ile başlar.
 * Madde boşken Enter'a basılırsa işaret silinir, liste biter. Liste satırı değilse false.
 */
function continueList(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const caret = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(caret.startContainer, caret.startOffset);
  const line = before.toString().split("\n").pop() ?? "";
  const m = line.match(LIST_ITEM);
  if (!m) return false;
  const [, indent, numP, punctP, numBare, punctBare, bullet, space, rest] = m;
  const num = numP ?? numBare;
  const punct = punctP ?? punctBare ?? "";
  if (!rest.trim()) {
    // Boş madde: işareti sil (aynı metin düğümündeyse)
    const node = caret.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || caret.startOffset < line.length) return false;
    const marker = document.createRange();
    marker.setStart(node, caret.startOffset - line.length);
    marker.setEnd(node, caret.startOffset);
    sel.removeAllRanges();
    sel.addRange(marker);
    document.execCommand("delete");
    return true;
  }
  const next = num ? `${+num + 1}${punct}` : bullet;
  // execCommand geri alma (Ctrl Z) geçmişini korur
  document.execCommand("insertText", false, `\n${indent}${next}${space}`);
  return true;
}

let renumbering = false;

/**
 * Numaralı listeleri sıraya sokar: "1 2 3 4"ten 3 silinince 4 → 3 olur, araya madde
 * eklenince alttakiler kayar. Aynı girinti ve noktalamayla ardışık satırlar bir liste;
 * ilk maddenin numarası korunur, daha içerideki satırlar listeyi bölmez.
 */
function renumberLists(el: HTMLElement) {
  if (renumbering) return;
  const text = el.textContent ?? "";
  const fixes: { start: number; end: number; value: string }[] = [];
  const runs = new Map<number, { punct: string; next: number }>();
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.match(LIST_ITEM);
    const depth = line.length - line.trimStart().length;
    for (const d of runs.keys()) if (d > depth || (!m?.[2] && !m?.[4] && d === depth)) runs.delete(d);
    const num = m && (m[2] ?? m[4]);
    if (num) {
      const punct = m[3] ?? "";
      const run = runs.get(depth);
      if (run && run.punct === punct) {
        if (+num !== run.next) {
          fixes.push({ start: pos + depth, end: pos + depth + num.length, value: String(run.next) });
        }
        run.next++;
      } else runs.set(depth, { punct, next: +num + 1 });
    }
    pos += line.length + 1;
  }
  if (!fixes.length) return;

  const sel = window.getSelection();
  let caret = -1;
  if (sel?.rangeCount && el.contains(sel.anchorNode)) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    caret = r.toString().length;
  }
  renumbering = true;
  try {
    // Sondan başa: öndeki konumlar kaymasın
    for (const f of fixes.reverse()) {
      const r = document.createRange();
      r.setStart(...textPoint(el, f.start));
      r.setEnd(...textPoint(el, f.end));
      sel?.removeAllRanges();
      sel?.addRange(r);
      // execCommand geri alma geçmişini korur
      document.execCommand("insertText", false, f.value);
      if (caret >= f.end) caret += f.value.length - (f.end - f.start);
    }
  } finally {
    renumbering = false;
  }
  if (caret >= 0 && sel) {
    const r = document.createRange();
    r.setStart(...textPoint(el, caret));
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/** Metin içi karakter konumunu DOM noktasına çevirir */
function textPoint(el: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let last: Node | null = null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (offset <= len) return [node, offset];
    offset -= len;
    last = node;
  }
  return last ? [last, last.textContent?.length ?? 0] : [el, el.childNodes.length];
}
