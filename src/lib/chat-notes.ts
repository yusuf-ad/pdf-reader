"use client";

import { useSyncExternalStore } from "react";

// Sohbetten nota alınan cevaplar (kitap başına localStorage).

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
};

const PREFIX = "pdf-reader:chat-notes:";
const EMPTY: ChatNote[] = [];

const cache = new Map<string, ChatNote[]>();
const listeners = new Set<() => void>();

function load(book: string): ChatNote[] {
  let data = cache.get(book);
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem(PREFIX + book) ?? "[]") as ChatNote[];
    } catch {
      data = [];
    }
    cache.set(book, data);
  }
  return data;
}

function write(book: string, notes: ChatNote[]) {
  cache.set(book, notes);
  try {
    if (notes.length) localStorage.setItem(PREFIX + book, JSON.stringify(notes));
    else localStorage.removeItem(PREFIX + book);
  } catch {
    // Depolama dolu: bu oturumda bellekte kalır
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatNotes(book: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (book ? load(book) : EMPTY),
    () => EMPTY,
  );
}

export function addChatNote(book: string, note: Omit<ChatNote, "id" | "createdAt">) {
  const notes = load(book);
  if (notes.some((n) => n.messageId === note.messageId)) return;
  write(book, [...notes, { ...note, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() }]);
}

export function removeChatNote(book: string, id: string) {
  write(book, load(book).filter((n) => n.id !== id && n.messageId !== id));
}

export function deleteBookChatNotes(book: string) {
  cache.delete(book);
  localStorage.removeItem(PREFIX + book);
  listeners.forEach((l) => l());
}
