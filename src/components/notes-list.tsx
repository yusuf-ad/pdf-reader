"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { removeAnnotations, useBookAnnotations, type Note } from "@/lib/annotations";
import { removeChatNote, useChatNotes, type ChatNote } from "@/lib/chat-notes";

type Filter = "all" | "text" | "chat";

const FILTERS: [Filter, string][] = [
  ["all", "Tümü"],
  ["text", "Yazılar"],
  ["chat", "Sohbetten"],
];

// Kalem çizgileri ve vurgular not sayılmaz; yalnızca sayfaya yazılanlar ve sohbetten alınanlar
type Item =
  | { kind: "text"; id: string; page: number; order: number; note: Note }
  | { kind: "chat"; id: string; page: number | null; order: number; note: ChatNote };

/** Kitabın notları: sayfa sırasıyla, sayfasızlar en sonda. */
export function useNotes(book: string | null): Item[] {
  const annotations = useBookAnnotations(book);
  const chatNotes = useChatNotes(book);
  return useMemo(() => {
    const items: Item[] = [];
    for (const [page, list] of Object.entries(annotations)) {
      for (const a of list) {
        if (a.type === "text") items.push({ kind: "text", id: a.id, page: +page, order: a.y, note: a });
      }
    }
    for (const n of chatNotes) {
      // Sayfadaki yazılardan sonra, eklenme sırasıyla
      items.push({ kind: "chat", id: n.id, page: n.page, order: 1 + n.createdAt, note: n });
    }
    const pageOf = (i: Item) => i.page ?? Infinity;
    return items.sort((a, b) => pageOf(a) - pageOf(b) || a.order - b.order);
  }, [annotations, chatNotes]);
}

type Props = {
  book: string | null;
  items: Item[];
  currentPage: number;
  onGoTo: (page: number) => void;
  query: string;
};

export default function NotesList({ book, items, currentPage, onGoTo, query }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return items.filter((item) => {
      if (filter !== "all" && item.kind !== filter) return false;
      if (!q) return true;
      const text = item.kind === "text" ? item.note.text : `${item.note.question}\n${item.note.text}`;
      return text.toLocaleLowerCase("tr").includes(q);
    });
  }, [items, filter, query]);

  if (!book || !items.length) {
    return (
      <p className="px-6 py-6 text-sm leading-relaxed text-muted">
        Sayfaya yazdığın notlar (<span className="font-mono text-xs">T</span>) ve sohbette
        &ldquo;Nota ekle&rdquo; dediğin cevaplar burada sayfa sırasıyla görünür.
      </p>
    );
  }

  const remove = (item: Item) => {
    if (item.kind === "text") removeAnnotations(book, item.page, [item.id]);
    else removeChatNote(book, item.id);
  };

  return (
    <>
      <div className="flex gap-1 px-6 pb-2 text-xs">
        {FILTERS.map(([id, label]) => {
          const count = id === "all" ? items.length : items.filter((i) => i.kind === id).length;
          return (
            <button
              key={id}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`px-2 py-1 transition-colors ${
                filter === id ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
              <span className="ml-1 tabular-nums opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      <ul className="flex-1 overflow-y-auto px-6 pb-4">
        {filtered.length === 0 && <li className="py-6 text-sm text-muted">Eşleşen not yok.</li>}
        {filtered.map((item, i) => (
          <li key={item.id}>
            {item.page !== filtered[i - 1]?.page &&
              (item.page ? (
                <button
                  onClick={() => onGoTo(item.page!)}
                  className="mt-3 mb-1 block text-xs tabular-nums text-muted hover:text-ink"
                >
                  s. {item.page}
                  {item.page === currentPage && " · buradasın"}
                </button>
              ) : (
                <p className="mt-3 mb-1 text-xs text-muted">Sayfasız</p>
              ))}
            <div className="group relative -mx-2 px-2 py-1.5 hover:bg-ink/5">
              {item.kind === "text" ? (
                <button onClick={() => onGoTo(item.page)} className="block w-full text-left">
                  <p
                    className="line-clamp-6 font-sans text-sm leading-snug whitespace-pre-wrap [filter:var(--page-filter)]"
                    style={{ color: item.note.color }}
                  >
                    {item.note.text}
                  </p>
                </button>
              ) : (
                <ChatNoteView note={item.note} />
              )}
              <button
                onClick={() => remove(item)}
                className="absolute top-1.5 right-2 bg-sheet px-1 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
              >
                Sil
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Sohbetten alınan cevap; uzunsa kısaltılır, tıklayınca açılır. */
function ChatNoteView({ note }: { note: ChatNote }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {note.question && (
        <p className="line-clamp-2 border-l-2 border-accent/60 pl-2 text-xs text-muted">{note.question}</p>
      )}
      {/* Markdown blokları (paragraf, liste) düğmenin içine konamaz */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((o) => !o))}
        title={open ? "Kısalt" : "Tamamını göster"}
        className={`chat-md mt-1 cursor-pointer font-serif text-[15px] leading-snug ${open ? "" : "line-clamp-6"}`}
      >
        <ReactMarkdown>{note.text}</ReactMarkdown>
      </div>
    </div>
  );
}
