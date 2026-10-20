"use client";

import { useEffect, useRef, useState } from "react";
import {
  addAnnotation,
  getBookAnnotations,
  INK_COLORS,
  newId,
  removeAnnotations,
  updateNote,
  type Note,
} from "@/lib/annotations";
import { appendToNote, type NoteInput } from "@/lib/page-notes";
import { bookKey, get, set, useStored } from "@/lib/storage";

// Asistanın sayfadaki yazı notuna eklemesi. Not, kullanıcının kendi notlarıyla aynı türdendir
// (düzenleme, Ctrl Z, dışa aktarma aynen çalışır). Her araç çağrısının sonucu kaydedilir;
// böylece geçmişten yüklenen sohbette aynı ekleme ikinci kez yapılmaz ve geri alınabilir.

const NOTE_SIZE = 0.02; // annotation-layer'daki yazı boyutuyla aynı
const LINE = 1.3;
// Sayfa oranı bilinmediği için A4 varsayılır (yeni notun yerini kabaca bulmak için)
const ASPECT = 1.414;
const MARGIN = 0.07;

/** Bir ekleme sonucu: hangi not, eklemeden önceki metni (yeni açıldıysa null). */
type NoteRecord = { page: number; noteId: string; before: string | null; after: string; undone?: boolean };
type NoteRecords = Record<string, NoteRecord>;

const recordsKey = (book: string) => bookKey("ai-notes", book);
const EMPTY: NoteRecords = {};

function saveRecord(book: string, id: string, rec: NoteRecord) {
  set(recordsKey(book), { ...(get<NoteRecords>(recordsKey(book)) ?? {}), [id]: rec });
}

/** Notu kitabın herhangi bir sayfasında bulur (model sayfayı yanlış verebilir). */
function findNote(book: string, id: string | null, page: number) {
  if (!id) return null;
  const all = getBookAnnotations(book);
  const pages = [page, ...Object.keys(all).map(Number).filter((p) => p !== page)];
  for (const p of pages) {
    const note = all[p]?.find((a): a is Note => a.type === "text" && a.id === id);
    if (note) return { page: p, note };
  }
  return null;
}

const height = (n: Note) => (n.text.split("\n").length * n.size * LINE) / ASPECT;

export function writeNote(book: string, id: string, input: NoteInput): NoteRecord {
  const found = findNote(book, input.noteId, input.page);
  if (found) {
    const after = appendToNote(found.note.text, input.text);
    updateNote(book, found.page, found.note.id, { text: after });
    const rec = { page: found.page, noteId: found.note.id, before: found.note.text, after };
    saveRecord(book, id, rec);
    return rec;
  }
  // Yeni not: sayfadaki en alttaki notun altına, not yoksa sol üst köşeye
  const page = input.page;
  const notes = (getBookAnnotations(book)[page] ?? []).filter((a): a is Note => a.type === "text");
  const lowest = notes.reduce<Note | null>((low, n) => (!low || n.y + height(n) > low.y + height(low) ? n : low), null);
  const text = appendToNote("", input.text);
  const note: Note = {
    id: newId(),
    type: "text",
    color: lowest?.color ?? INK_COLORS[0],
    x: lowest?.x ?? MARGIN,
    y: Math.min(0.9, lowest ? lowest.y + height(lowest) + (lowest.size * LINE) / ASPECT : MARGIN),
    size: lowest?.size ?? NOTE_SIZE,
    text,
  };
  addAnnotation(book, page, note);
  const rec = { page, noteId: note.id, before: null, after: text };
  saveRecord(book, id, rec);
  return rec;
}

/** Eklemeyi geri alır: yeni açılan not silinir, mevcut nota eski metni geri yazılır. */
export function undoNote(book: string, id: string) {
  const rec = get<NoteRecords>(recordsKey(book))?.[id];
  if (!rec || rec.undone) return;
  if (rec.before === null) removeAnnotations(book, rec.page, [rec.noteId]);
  else updateNote(book, rec.page, rec.noteId, { text: rec.before });
  saveRecord(book, id, { ...rec, undone: true });
}

type PartialNote = Partial<NoteInput> | undefined;

/**
 * Sohbette writeNote aracının kartı: eklenen metin, Geri al / Tekrar ekle.
 * Cevap akarken gelen kart notu kendiliğinden yazar; geçmişten yüklenen kart yazmaz.
 */
export function NoteCard({
  id,
  input,
  ready,
  streaming,
  book,
  error,
  onGoTo,
}: {
  id: string;
  input: PartialNote;
  ready: boolean;
  streaming: boolean;
  book: string | null;
  error?: string;
  onGoTo?: (page: number) => void;
}) {
  const records = useStored(book && recordsKey(book), EMPTY);
  const rec = records[id] as NoteRecord | undefined;
  const [live] = useState(streaming);
  const startedRef = useRef(false);
  const complete = ready && input?.page && input.text?.trim() ? (input as NoteInput) : null;

  useEffect(() => {
    if (!live || !complete || !book || rec || startedRef.current) return;
    startedRef.current = true;
    writeNote(book, id, complete);
  }, [live, complete, book, rec, id]);

  if (error) return <p className="text-sm text-accent">Nota eklenemedi: {error}</p>;
  const page = rec?.page ?? input?.page;
  const title = !ready
    ? "Not yazılıyor…"
    : rec?.undone
      ? "Not geri alındı"
      : rec
        ? rec.before === null
          ? "Sayfaya yeni not yazıldı"
          : "Sayfadaki nota eklendi"
        : "Sayfaya not";
  return (
    <section className="border border-rule bg-sheet px-5 py-4 font-sans">
      <div className="flex items-baseline gap-3">
        <p className="flex-1 text-[11px] tracking-[0.12em] text-muted uppercase">
          {title}
          {page && (
            <>
              {" · "}
              {onGoTo ? (
                <button onClick={() => onGoTo(page)} className="tracking-normal normal-case hover:text-ink">
                  s. {page}
                </button>
              ) : (
                <span className="tracking-normal normal-case">s. {page}</span>
              )}
            </>
          )}
        </p>
        {complete && book && (
          <span className="flex gap-4 text-xs">
            {rec && !rec.undone ? (
              <button onClick={() => undoNote(book, id)} className="text-muted hover:text-accent">
                Geri al
              </button>
            ) : (
              <button onClick={() => writeNote(book, id, complete)} className="text-muted hover:text-ink">
                {rec ? "Tekrar ekle" : "Nota ekle"}
              </button>
            )}
          </span>
        )}
      </div>
      {input?.text && (
        <p
          className={`mt-3 font-sans text-sm leading-snug whitespace-pre-wrap ${rec?.undone ? "text-muted line-through" : "text-ink/85"}`}
        >
          {input.text.trim()}
        </p>
      )}
    </section>
  );
}
