"use client";

import { newId } from "./annotations";
import { bookKey, get, set, useStored } from "./storage";

// Not kâğıdındaki notlar (Apple Notlar gibi): tüm kitaplar için tek liste. Her not yazıldığı
// kitabı ve sayfayı hatırlar; ilk satırı başlığıdır. Kâğıdın konumu/boyutu da tektir,
// açık/kapalı olması ise kitap başına.

export type StickyNote = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Yazıldığı kitap (anahtar ve ad) ve sayfa */
  book?: string;
  bookTitle?: string;
  page?: number;
};

export type StickyCard = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Açık not; null: liste */
  current: string | null;
  listOpen: boolean;
};

const NOTES = "sticky-notes";
const CARD = "sticky-card";
const EMPTY: StickyNote[] = [];
export const DEFAULT_CARD: StickyCard = { x: -1, y: 64, w: 300, h: 320, current: null, listOpen: false };

export const useStickyNotes = () => useStored(NOTES, EMPTY);
export const useStickyCard = () => useStored(CARD, DEFAULT_CARD);

export const noteTitle = (n: StickyNote) => n.text.split("\n")[0].trim();
export const isBlank = (n: StickyNote) => !n.text.trim();

const notes = () => get<StickyNote[]>(NOTES) ?? EMPTY;
const save = (list: StickyNote[]) => set(NOTES, list.length ? list : undefined);

export function updateCard(patch: Partial<StickyCard>) {
  set(CARD, { ...DEFAULT_CARD, ...get<StickyCard>(CARD), ...patch });
}

export function createNote(where: { book?: string; bookTitle?: string; page?: number }): string {
  const now = Date.now();
  const note: StickyNote = { id: newId(), text: "", createdAt: now, updatedAt: now, ...where };
  save([note, ...notes()]);
  return note.id;
}

export function updateNote(id: string, patch: Partial<StickyNote>) {
  save(notes().map((n) => (n.id === id ? { ...n, ...patch, updatedAt: patch.text !== undefined ? Date.now() : n.updatedAt } : n)));
}

export function deleteNote(id: string) {
  save(notes().filter((n) => n.id !== id));
}

/** Yazılmadan bırakılan not listede kalmasın */
export function dropIfBlank(id: string | null) {
  const n = id && notes().find((n) => n.id === id);
  if (n && isBlank(n)) deleteNote(n.id);
}

/** Sabitlenenler önce, sonra en son düzenlenen */
export function sortNotes(list: StickyNote[]) {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}

export function useStickyOpen(book: string | null) {
  return useStored(book && bookKey("sticky-open", book), false);
}

export function setStickyOpen(book: string, open: boolean) {
  set(bookKey("sticky-open", book), open || undefined);
}

/** Önceki sürümde kitap başına tek not vardı: listeye taşı */
export function adoptLegacyNote(book: string, bookTitle?: string) {
  const old = get<{ text?: string; updatedAt?: number }>(bookKey("sticky", book));
  if (old === undefined) return;
  set(bookKey("sticky", book), undefined);
  if (!old.text?.trim()) return;
  const t = old.updatedAt ?? Date.now();
  save([{ id: newId(), text: old.text, createdAt: t, updatedAt: t, book, bookTitle }, ...notes()]);
}
