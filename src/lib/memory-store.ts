"use client";

import {
  applyMemoryChanges,
  MEMORY_MAX_CHARS,
  MEMORY_MAX_ITEMS,
  newMemoryId,
  revertMemoryChanges,
  type MemoryChange,
  type MemoryItem,
} from "./memory";
import { get, set, useStored } from "./storage";

// Hafızanın yerel kaydı (tüm kitaplarda ortak). Yedeğe kendiliğinden girer.

const KEY = "memory";
// Kapalıyken hafıza modele gönderilmez, model de kaydedemez
const OFF_KEY = "memory-off";

const EMPTY: MemoryItem[] = [];

const load = () => get<MemoryItem[]>(KEY) ?? EMPTY;

function write(items: MemoryItem[]) {
  set(KEY, items.length ? items : undefined);
}

export function useMemory() {
  return useStored(KEY, EMPTY);
}

export function useMemoryEnabled() {
  return !useStored(OFF_KEY, false);
}

export function setMemoryEnabled(enabled: boolean) {
  set(OFF_KEY, enabled ? undefined : true);
}

/** İsteğe eklenecek hafıza; kapalıysa yok. */
export function memoryBody(): { memory?: MemoryItem[] } {
  return get(OFF_KEY) ? {} : { memory: load() };
}

export function addMemory(text: string) {
  const items = load();
  const clean = text.trim().slice(0, MEMORY_MAX_CHARS);
  if (!clean || items.length >= MEMORY_MAX_ITEMS) return;
  write([...items, { id: newMemoryId(), text: clean }]);
}

export function editMemory(id: string, text: string) {
  const clean = text.trim().slice(0, MEMORY_MAX_CHARS);
  if (!clean) return removeMemory(id);
  write(load().map((m) => (m.id === id ? { ...m, text: clean } : m)));
}

export function removeMemory(id: string) {
  write(load().filter((m) => m.id !== id));
}

export function applyChanges(changes: MemoryChange[]) {
  if (changes.length) write(applyMemoryChanges(load(), changes));
}

export function revertChanges(changes: MemoryChange[]) {
  write(revertMemoryChanges(load(), changes));
}
