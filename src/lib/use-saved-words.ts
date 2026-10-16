"use client";

import { get, set, useStored } from "./storage";
import type { SavedWord } from "./types";

const KEY = "words";
const EMPTY: SavedWord[] = [];

const read = () => get<SavedWord[]>(KEY) ?? EMPTY;

function add(entry: Omit<SavedWord, "id" | "createdAt">) {
  // Aynı kelime + aynı cümle tekrar seçilirse çoğaltma, en üste taşı
  const rest = read().filter(
    (w) => !(w.word.toLowerCase() === entry.word.toLowerCase() && w.sentence === entry.sentence),
  );
  set(KEY, [{ ...entry, id: crypto.randomUUID(), createdAt: Date.now() }, ...rest]);
}

function remove(id: string) {
  set(KEY, read().filter((w) => w.id !== id));
}

function clear() {
  set(KEY, undefined);
}

export function useSavedWords() {
  const words = useStored(KEY, EMPTY);
  return { words, add, remove, clear };
}
