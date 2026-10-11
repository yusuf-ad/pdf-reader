"use client";

import { useSyncExternalStore } from "react";
import type { SavedWord } from "./types";

const STORAGE_KEY = "pdf-reader:saved-words";
const EMPTY: SavedWord[] = [];

let cache: SavedWord[] | null = null;
const listeners = new Set<() => void>();

function read(): SavedWord[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as SavedWord[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: SavedWord[]) {
  cache = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Başka sekmede yapılan değişiklikleri de yakala
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function add(entry: Omit<SavedWord, "id" | "createdAt">) {
  // Aynı kelime + aynı cümle tekrar seçilirse çoğaltma, en üste taşı
  const rest = read().filter(
    (w) => !(w.word.toLowerCase() === entry.word.toLowerCase() && w.sentence === entry.sentence),
  );
  write([{ ...entry, id: crypto.randomUUID(), createdAt: Date.now() }, ...rest]);
}

function remove(id: string) {
  write(read().filter((w) => w.id !== id));
}

function clear() {
  write([]);
}

export function useSavedWords() {
  const words = useSyncExternalStore(subscribe, read, () => EMPTY);
  return { words, add, remove, clear };
}
