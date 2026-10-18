"use client";

import { get, set, useStored } from "./storage";
import type { SavedWord } from "./types";

const KEY = "words";
const EMPTY: SavedWord[] = [];

const read = () => get<SavedWord[]>(KEY) ?? EMPTY;

type Entry = Omit<SavedWord, "id" | "createdAt">;

/** Aynı kelime + aynı cümle mi (listede tekrar sayılır). */
export const sameWord = (a: Pick<SavedWord, "word" | "sentence">, b: Pick<SavedWord, "word" | "sentence">) =>
  a.word.toLowerCase() === b.word.toLowerCase() && a.sentence === b.sentence;

function add(entry: Entry) {
  addMany([entry]);
}

/** Kelimeleri verilen sırayla en üste ekler; eklenenlerin id'lerini döner. */
function addMany(entries: Entry[]) {
  // Aynı kelime + aynı cümle tekrar seçilirse çoğaltma, en üste taşı
  const rest = read().filter((w) => !entries.some((e) => sameWord(w, e)));
  const now = Date.now();
  const added = entries.map((e) => ({ ...e, id: crypto.randomUUID(), createdAt: now }));
  set(KEY, [...added, ...rest]);
  return added.map((w) => w.id);
}

function remove(id: string) {
  removeMany([id]);
}

function removeMany(ids: string[]) {
  set(KEY, read().filter((w) => !ids.includes(w.id)));
}

function clear() {
  set(KEY, undefined);
}

export function useSavedWords() {
  const words = useStored(KEY, EMPTY);
  return { words, add, addMany, remove, removeMany, clear };
}
