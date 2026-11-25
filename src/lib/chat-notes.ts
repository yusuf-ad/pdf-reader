"use client";

import { bookKey, get, set, useStored } from "./storage";

// Sohbetten nota alınan cevaplar (kitap başına).

export type ChatNote = {
  id: string;
  /** Cevabın sohbetteki mesaj kimliği; aynı cevap iki kez eklenmesin */
  messageId: string;
  /** Cevabın kendisi (markdown) */
  text: string;
  /** Sorulan soru ya da seçili metin */
  question: string;
  page: number | null;
  createdAt: number;
  /** "selection": sohbetten değil, sayfada seçilen metinden doğrudan alınan alıntı */
  source?: "selection";
};

const EMPTY: ChatNote[] = [];

const key = (book: string) => bookKey("chat-notes", book);
const load = (book: string) => get<ChatNote[]>(key(book)) ?? EMPTY;

function write(book: string, notes: ChatNote[]) {
  set(key(book), notes.length ? notes : undefined);
}

export function useChatNotes(book: string | null) {
  return useStored(book && key(book), EMPTY);
}

export function addChatNote(book: string, note: Omit<ChatNote, "id" | "createdAt">) {
  const notes = load(book);
  if (notes.some((n) => n.messageId === note.messageId)) return;
  write(book, [...notes, { ...note, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() }]);
}

/** Sayfada seçilen metni alıntı olarak notlara ekler; aynı sayfadaki aynı metin tekrar eklenmez. */
export function addSelectionNote(book: string, text: string, page: number | null) {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (!clean) return false;
  const notes = load(book);
  if (notes.some((n) => n.source === "selection" && n.page === page && n.text === clean)) return false;
  const id = Math.random().toString(36).slice(2, 10);
  write(book, [
    ...notes,
    { id, messageId: `sel-${id}`, text: clean, question: "", page, createdAt: Date.now(), source: "selection" },
  ]);
  return true;
}

export function removeChatNote(book: string, id: string) {
  write(book, load(book).filter((n) => n.id !== id && n.messageId !== id));
}
