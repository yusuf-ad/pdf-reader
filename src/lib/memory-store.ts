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
import { translate } from "./i18n";
import { get, set, useStored } from "./storage";

// Hafızanın yerel kaydı (tüm kitaplarda ortak). Yedeğe kendiliğinden girer.

const KEY = "memory";
// Kapalıyken hafıza modele gönderilmez, model de kaydedemez
const OFF_KEY = "memory-off";

// Hiç kaydedilmemişse başlangıç hafızası. Kullanıcı hepsini silerse boş liste saklanır,
// varsayılanlar geri gelmez.
const DEFAULT_MEMORY: MemoryItem[] = [
  { id: "def-kisa", text: "Kısa cevap istiyor; uzun açıklamayı ancak isterse" },
  { id: "def-ozet", text: "Önce bir cümlelik özet, sonra detay görmek istiyor" },
  { id: "def-kod", text: "Kod örneklerinde TypeScript tercih ediyor" },
  { id: "def-kelime", text: "Kelime sorularında Türkçe anlam, eş anlamlı ve bir örnek cümle istiyor" },
  { id: "def-quiz", text: "Quizlerde şıkların neden yanlış olduğunu da görmek istiyor" },
];


/** Localize untouched defaults for display while preserving the model's memory text. */
export function memoryDisplayText(item: MemoryItem) {
  const original = DEFAULT_MEMORY.find((entry) => entry.id === item.id);
  if (!original || original.text !== item.text) return item.text;
  const keys: Record<string, "memoryDefaultShort" | "memoryDefaultSummary" | "memoryDefaultCode" | "memoryDefaultWords" | "memoryDefaultQuiz"> = {
    "def-kisa": "memoryDefaultShort",
    "def-ozet": "memoryDefaultSummary",
    "def-kod": "memoryDefaultCode",
    "def-kelime": "memoryDefaultWords",
    "def-quiz": "memoryDefaultQuiz",
  };
  return translate("ai", keys[item.id]);
}

const load = () => get<MemoryItem[]>(KEY) ?? DEFAULT_MEMORY;

function write(items: MemoryItem[]) {
  set(KEY, items);
}

export function useMemory() {
  return useStored(KEY, DEFAULT_MEMORY);
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
