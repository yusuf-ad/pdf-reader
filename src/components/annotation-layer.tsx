"use client";

import { useEffect, useRef, useState } from "react";
import {
  addAnnotation,
  newId,
  removeAnnotations,
  strokeHit,
  strokePath,
  updateNote,
  usePageAnnotations,
  type Note,
  type Tool,
} from "@/lib/annotations";

// Sayfa genişliğine oranla: 820px genişlikte ~2.3px kalem, ~16px yazı
const PEN_WIDTH = 0.0028;
const TEXT_SIZE = 0.02;
const ERASER_RADIUS = 8;
// Bu kadar px'ten yakın noktalar atlanır (kayıt küçük kalsın)
const MIN_POINT_GAP = 1.5;

const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7.5" fill="white" fill-opacity=".6" stroke="black"/></svg>`,
)}") 9 9, cell`;

const CURSORS: Record<Tool, string> = { pen: "crosshair", text: "text", eraser: ERASER_CURSOR };

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
  // Yazı aracından çıkınca düzenleme biter
  const editing = tool === "text" ? editingId : null;
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
      .filter((a) => a.type === "ink" && strokeHit(a, x, y, w, h, ERASER_RADIUS))
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
    if (active !== "pen") return;
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
      addAnnotation(book, page, { id: newId(), type: "ink", color, width: PEN_WIDTH, points: draft });
    }
    setDraft(null);
  };

  const notes = items.filter((a): a is Note => a.type === "text");

  return (
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
      <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden>
        {items.map(
          (a) =>
            a.type === "ink" && (
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
            strokeWidth={Math.max(1, PEN_WIDTH * w)}
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
          onEdit={() => setEditing(note.id)}
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
  );
}

function NoteView({
  note,
  w,
  h,
  tool,
  editing,
  onEdit,
  onMove,
  onCommit,
}: {
  note: Note;
  w: number;
  h: number;
  tool: Tool | null;
  editing: boolean;
  onEdit?: () => void;
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

  const interactive = tool === "text" || tool === "eraser";

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
        }
      }}
      onPointerDown={(e) => {
        if (tool !== "text" || editing || e.button !== 0) return;
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
        } else onEdit?.();
      }}
      title={tool === "text" && !editing ? "Düzenlemek için tıkla, taşımak için sürükle" : undefined}
      style={{
        left: note.x * w + (offset?.dx ?? 0),
        top: note.y * h + (offset?.dy ?? 0),
        maxWidth: Math.max(80, (1 - note.x) * w - 8),
        fontSize: note.size * w,
        color: note.color,
        pointerEvents: interactive || editing ? "auto" : "none",
        cursor: tool === "text" && !editing ? "move" : undefined,
      }}
      className={`absolute min-w-[2ch] font-sans leading-[1.3] break-words whitespace-pre-wrap outline-none ${
        editing ? "bg-white/70 ring-1 ring-current/40 select-text" : tool === "text" ? "hover:ring-1 hover:ring-current/30" : ""
      }`}
    >
      {note.text}
    </div>
  );
}
