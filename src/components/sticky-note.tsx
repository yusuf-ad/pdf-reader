"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  adoptLegacyNote,
  createNote,
  deleteNote,
  dropIfBlank,
  isBlank,
  noteTitle,
  sortNotes,
  updateCard,
  updateNote,
  useStickyCard,
  useStickyNotes,
  type StickyCard,
  type StickyNote,
} from "@/lib/sticky-notes";
import { ListIcon, NewNoteIcon, PinIcon, TrashIcon } from "./icons";

// Okuma alanının üstünde duran küçük not kâğıdı. Başlığından tutup sürüklenir, sağ alt
// köşesinden boyutlanır. Apple Notlar gibi birden çok not tutar: listeden eski notlar açılır,
// aranır, sabitlenir; ilk satır notun başlığıdır.

const MIN_W = 220;
const MIN_H = 160;
const MARGIN = 8;
/** Bu genişlikten sonra liste notun yanında durur */
const SIDE_BY_SIDE = 480;
const LIST_W = 190;

type Drag = { mode: "move" | "resize"; startX: number; startY: number; from: StickyCard };

export default function StickyNoteCard({
  book,
  bookTitle,
  currentPage,
  onGoTo,
  boundsRef,
  onClose,
}: {
  book: string;
  bookTitle: string;
  currentPage: number;
  onGoTo: (page: number) => void;
  /** Notun içinde kaldığı alan (bölme) */
  boundsRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const card = useStickyCard();
  const notes = useStickyNotes();
  // Sürüklerken her harekette depoya yazmamak için geçici konum/boyut
  const [live, setLive] = useState<StickyCard | null>(null);
  const drag = useRef<Drag | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [onlyBook, setOnlyBook] = useState(false);
  // Bölme küçülünce not dışarıda kalmasın
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = boundsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBounds({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [boundsRef]);

  useEffect(() => adoptLegacyNote(book, bookTitle), [book, bookTitle]);

  const geo = live ?? card;
  const w = Math.max(MIN_W, Math.min(geo.w, bounds ? bounds.width - 2 * MARGIN : Infinity));
  const h = Math.max(MIN_H, Math.min(geo.h, bounds ? bounds.height - 2 * MARGIN : Infinity));
  // x < 0: henüz taşınmadı, sağ üst köşede başlar
  const rawX = geo.x < 0 && bounds ? bounds.width - w - 24 : geo.x;
  const x = bounds ? Math.max(MARGIN, Math.min(rawX, bounds.width - w - MARGIN)) : rawX;
  const y = bounds ? Math.max(MARGIN, Math.min(geo.y, bounds.height - h - MARGIN)) : geo.y;

  const start = (mode: Drag["mode"], e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, from: { ...card, x, y, w, h } };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setLive(
      d.mode === "move"
        ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
        : { ...d.from, w: d.from.w + dx, h: d.from.h + dy },
    );
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (live) updateCard({ x, y, w, h });
    setLive(null);
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  // --- Notlar ------------------------------------------------------------------

  // Açık not; null iken boş bir taslak gösterilir, yazmaya başlayınca not oluşur
  const note = notes.find((n) => n.id === card.current) ?? null;
  const sideBySide = w >= SIDE_BY_SIDE;
  const showList = card.listOpen;
  const showEditor = !showList || sideBySide;

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return sortNotes(notes).filter(
      (n) =>
        (!onlyBook || n.book === book) &&
        (!q || n.text.toLocaleLowerCase("tr").includes(q) || n.bookTitle?.toLocaleLowerCase("tr").includes(q)),
    );
  }, [notes, query, onlyBook, book]);

  const open = (id: string | null) => {
    if (id !== card.current) dropIfBlank(card.current);
    updateCard({ current: id, listOpen: sideBySide && card.listOpen });
    requestAnimationFrame(() => (id ? bodyRef : titleRef).current?.focus());
  };

  const nl = note ? note.text.indexOf("\n") : -1;
  const title = !note ? "" : nl < 0 ? note.text : note.text.slice(0, nl);
  const body = !note || nl < 0 ? "" : note.text.slice(nl + 1);
  const write = (t: string, b: string) => {
    const text = b ? `${t}\n${b}` : t;
    if (note) return updateNote(note.id, { text });
    if (!text) return;
    const id = createNote({ book, bookTitle, page: currentPage });
    updateNote(id, { text });
    updateCard({ current: id });
  };

  const remove = () => {
    if (!note) return;
    if (!isBlank(note) && !confirm(`“${noteTitle(note) || "Başlıksız not"}” silinsin mi?`)) return;
    deleteNote(note.id);
    updateCard({ current: null });
  };

  return (
    <div
      role="dialog"
      aria-label="Notlar"
      style={{ left: x, top: y, width: w, height: h }}
      className="absolute z-20 flex flex-col border border-rule border-t-[3px] border-t-accent/70 bg-sheet shadow-[0_6px_24px_var(--shadow)]"
    >
      <div
        onPointerDown={(e) => start("move", e)}
        {...handlers}
        title="Tutup sürükle"
        className="flex h-8 shrink-0 cursor-grab touch-none items-center gap-0.5 border-b border-rule px-1 select-none active:cursor-grabbing"
      >
        <HeaderButton label="Tüm notlar" active={showList} onClick={() => updateCard({ listOpen: !card.listOpen })}>
          <ListIcon />
        </HeaderButton>
        <span className="min-w-0 flex-1 truncate px-1 text-[11px] tracking-wider text-muted uppercase">
          {showList && !sideBySide ? `Notlar · ${notes.length}` : note ? longDate(note.updatedAt) : "Yeni not"}
        </span>
        {showEditor && note && (
          <>
            <HeaderButton
              label={note.pinned ? "Sabitlemeyi kaldır" : "Listenin başına sabitle"}
              active={note.pinned}
              onClick={() => updateNote(note.id, { pinned: !note.pinned })}
            >
              <PinIcon filled={note.pinned} />
            </HeaderButton>
            <HeaderButton label="Notu sil" onClick={remove}>
              <TrashIcon />
            </HeaderButton>
          </>
        )}
        <HeaderButton label="Yeni not" onClick={() => open(null)}>
          <NewNoteIcon />
        </HeaderButton>
        <HeaderButton label="Kapat  N  (notlar kalır)" onClick={onClose}>
          <span className="text-base leading-none">×</span>
        </HeaderButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {showList && (
          <div
            style={sideBySide ? { width: LIST_W } : undefined}
            className={`flex min-h-0 flex-col ${sideBySide ? "shrink-0 border-r border-rule" : "flex-1"}`}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-rule px-2 py-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (query) setQuery("");
                  else e.currentTarget.blur();
                }}
                placeholder="Ara"
                spellCheck={false}
                className="min-w-0 flex-1 border-b border-rule bg-transparent py-0.5 text-xs outline-none focus:border-ink"
              />
              <button
                onClick={() => setOnlyBook((o) => !o)}
                title={onlyBook ? "Tüm kitapların notlarını göster" : "Yalnızca bu kitabın notlarını göster"}
                className={`shrink-0 text-[11px] ${onlyBook ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {onlyBook ? "Bu kitap" : "Tümü"}
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((n, i) => (
                <li key={n.id}>
                  {!!n.pinned !== !!shown[i - 1]?.pinned && shown.some((s) => s.pinned) && (
                    <p className="px-3 pt-2.5 pb-1 text-[10px] tracking-wider text-muted uppercase">
                      {n.pinned ? "Sabitlenenler" : "Notlar"}
                    </p>
                  )}
                  <NoteRow note={n} active={n.id === card.current} onClick={() => open(n.id)} />
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted">
                  {query || onlyBook ? "Eşleşen not yok" : "Henüz not yok"}
                </li>
              )}
            </ul>
          </div>
        )}

        {showEditor && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pt-2 pb-3">
            <input
              ref={titleRef}
              autoFocus={!note}
              value={title}
              onChange={(e) => write(e.target.value, body)}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
                if (e.key === "Enter") {
                  e.preventDefault();
                  const at = e.currentTarget.selectionStart ?? title.length;
                  // İmleçten sonrası gövdenin başına geçer
                  write(title.slice(0, at), title.slice(at) + (body ? "\n" + body : ""));
                  bodyRef.current?.focus();
                  requestAnimationFrame(() => bodyRef.current?.setSelectionRange(0, 0));
                }
              }}
              placeholder="Başlık"
              spellCheck={false}
              className="w-full shrink-0 bg-transparent font-serif text-lg font-semibold text-ink outline-none placeholder:text-muted/60"
            />
            {note?.bookTitle && (
              <button
                onClick={() => note.book === book && note.page && onGoTo(note.page)}
                disabled={note.book !== book || !note.page}
                title={note.book === book && note.page ? `${note.page}. sayfaya git` : undefined}
                className="w-fit max-w-full shrink-0 truncate text-left text-[11px] text-muted enabled:hover:text-ink"
              >
                {note.bookTitle}
                {note.page ? ` · s. ${note.page}` : ""}
              </button>
            )}
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => write(title, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
                // Gövdenin başında silince başlığa dön
                const el = e.currentTarget;
                if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
                  e.preventDefault();
                  const at = title.length;
                  const [first, ...rest] = body.split("\n");
                  write(title + first, rest.join("\n"));
                  titleRef.current?.focus();
                  requestAnimationFrame(() => titleRef.current?.setSelectionRange(at, at));
                }
              }}
              placeholder="Not al…"
              spellCheck={false}
              className="mt-1.5 min-h-0 w-full flex-1 resize-none bg-transparent font-serif text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted/60"
            />
          </div>
        )}
      </div>

      <div
        onPointerDown={(e) => start("resize", e)}
        {...handlers}
        title="Boyutlandır"
        className="absolute right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize touch-none"
      >
        <svg viewBox="0 0 10 10" className="h-full w-full text-muted/60" aria-hidden>
          <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}

function NoteRow({ note, active, onClick }: { note: StickyNote; active: boolean; onClick: () => void }) {
  const preview = note.text.split("\n").slice(1).find((l) => l.trim())?.trim();
  return (
    <button
      onClick={onClick}
      className={`block w-full border-b border-rule/60 px-3 py-2 text-left ${active ? "bg-ink/8" : "hover:bg-ink/4"}`}
    >
      <span className="block truncate font-serif text-sm font-semibold text-ink">
        {noteTitle(note) || "Yeni not"}
      </span>
      <span className="block truncate text-[11px] text-muted">
        <span className="tabular-nums">{shortDate(note.updatedAt)}</span>
        {"  "}
        {preview ?? "Ek metin yok"}
      </span>
      {note.bookTitle && <span className="block truncate text-[10px] text-muted/80">{note.bookTitle}</span>}
    </button>
  );
}

function HeaderButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-6 w-6 shrink-0 items-center justify-center hover:text-ink ${active ? "text-ink" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Notlar'daki gibi: bugün saat, dün "Dün", bu hafta gün adı, daha eskisi tarih */
function shortDate(t: number) {
  const d = new Date(t);
  const today = new Date().setHours(0, 0, 0, 0);
  if (t >= today) return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (t >= today - DAY) return "Dün";
  if (t >= today - 6 * DAY) return d.toLocaleDateString("tr-TR", { weekday: "long" });
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function longDate(t: number) {
  return new Date(t).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
