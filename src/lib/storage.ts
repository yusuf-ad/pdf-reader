"use client";

import { useSyncExternalStore } from "react";

// Kullanıcının ürettiği her şey (kelimeler, notlar, vurgular, okuma durumu…) burada durur:
// IndexedDB'de tek bir anahtar–değer deposu. Açılışta hepsi belleğe yüklenir; okumalar
// eşzamanlı (bellekten), yazmalar hemen arkasından IndexedDB'ye gider.
//
// Önceden localStorage kullanılıyordu; ~5 MB sınırı dolunca yazılanlar sessizce kayboluyordu.
// Eski veriler ilk açılışta buraya taşınır (localStorage'daki kopyaya dokunulmaz).

const DB_NAME = "pdf-reader-data";
const STORE = "kv";
const MIGRATED = "meta:migrated-from-local-storage";

/** Kitap başına tutulan veriler; anahtar `${tür}:${kitap}` */
const BOOK_KINDS = ["annotations", "chat-notes", "chat", "progress", "bookmarks", "toc", "profile", "ocr-off"] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export const bookKey = (kind: BookKind, book: string) => `${kind}:${book}`;

const data = new Map<string, unknown>();
const listeners = new Set<() => void>();
// IndexedDB'ye yazılmayı bekleyenler (undefined: silinecek)
const pending = new Map<string, unknown>();
let flushScheduled = false;
let readyPromise: Promise<void> | null = null;
let isReady = false;
let channel: BroadcastChannel | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

const notify = () => listeners.forEach((l) => l());

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

async function readAll() {
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const keys = store.getAllKeys();
  const values = store.getAll();
  await done(tx);
  return (keys.result as string[]).map((k, i) => [k, values.result[i]] as const);
}

async function flush() {
  flushScheduled = false;
  if (!pending.size) return;
  const batch = new Map(pending);
  pending.clear();
  try {
    const tx = (await db()).transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [k, v] of batch) {
      if (v === undefined) store.delete(k);
      else store.put(v, k);
    }
    await done(tx);
    channel?.postMessage([...batch.keys()]);
  } catch (err) {
    console.error("Kayıt yazılamadı, tekrar denenecek:", err);
    // Bu arada daha yenisi yazılmadıysa sıraya geri koy
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
    setTimeout(schedule, 2000);
  }
}

function schedule() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

/** Başka sekmede yazılan anahtarları yeniden oku. */
async function reload(keys: string[]) {
  try {
    const tx = (await db()).transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const reqs = keys.map((k) => [k, store.get(k)] as const);
    await done(tx);
    for (const [k, req] of reqs) {
      if (req.result === undefined) data.delete(k);
      else data.set(k, req.result);
    }
    notify();
  } catch {
    // okunamadıysa bu sekmede eski hali kalır
  }
}

/** Depo hazır olunca (ilk açılışta localStorage taşındıktan sonra) çözülür. */
export function whenReady() {
  readyPromise ??= (async () => {
    for (const [k, v] of await readAll()) data.set(k, v);
    if (!data.has(MIGRATED)) {
      for (const [k, v] of legacyEntries()) if (!data.has(k)) set(k, v);
      set(MIGRATED, Date.now());
      await flush();
    }
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(DB_NAME);
      channel.onmessage = (e: MessageEvent<string[]>) => reload(e.data);
    }
    isReady = true;
    notify();
  })();
  return readyPromise;
}

export function useStorageReady() {
  return useSyncExternalStore(subscribe, () => isReady, () => false);
}

/** Tarayıcıdan, yer daralınca verileri silmemesini iste. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function get<T>(key: string): T | undefined {
  return data.get(key) as T | undefined;
}

/** undefined verilirse siler. */
export function set(key: string, value: unknown) {
  if (value === undefined) data.delete(key);
  else data.set(key, value);
  pending.set(key, value);
  schedule();
  notify();
}

/** Değer değişene kadar aynı nesneyi döndürür; `fallback` sabit olmalı. */
export function useStored<T>(key: string | null, fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => (key ? (get<T>(key) ?? fallback) : fallback),
    () => fallback,
  );
}

// --- Kitap anahtarı değişince / kitap silinince ---------------------------------

/** İki kayıt birleştirilir: listeler birleşir (aynı kimlik bir kez), diğerlerinde `into` kalır. */
function merge(into: unknown, from: unknown): unknown {
  if (into === undefined) return from;
  if (from === undefined) return into;
  if (Array.isArray(into) && Array.isArray(from)) {
    const id = (x: unknown) =>
      typeof x === "object" && x !== null ? ((x as { id?: string }).id ?? JSON.stringify(x)) : x;
    const seen = new Set(into.map(id));
    const out = [...into, ...from.filter((x) => !seen.has(id(x)))];
    return out.every((x) => typeof x === "number") ? out.sort((a, b) => a - b) : out;
  }
  if (isRecord(into) && isRecord(from)) {
    const out: Record<string, unknown> = { ...into };
    for (const [k, v] of Object.entries(from)) out[k] = merge(into[k], v);
    return out;
  }
  return into;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Bir kitabın tüm verilerini başka anahtara taşır; orada veri varsa birleştirir. */
export function renameBook(from: string, to: string) {
  if (from === to) return;
  for (const kind of BOOK_KINDS) {
    const old = get(bookKey(kind, from));
    if (old === undefined) continue;
    set(bookKey(kind, to), merge(get(bookKey(kind, to)), old));
    set(bookKey(kind, from), undefined);
  }
}

export function deleteBook(book: string) {
  for (const kind of BOOK_KINDS) if (data.has(bookKey(kind, book))) set(bookKey(kind, book), undefined);
}

/** Verisi olan tüm kitap anahtarları. */
export function storedBooks() {
  const books = new Set<string>();
  for (const k of data.keys()) {
    const kind = BOOK_KINDS.find((kind) => k.startsWith(kind + ":"));
    if (kind) books.add(k.slice(kind.length + 1));
  }
  return [...books];
}

// --- Yedek -----------------------------------------------------------------------

export type Backup = { app: "pdf-reader"; version: 1; exportedAt: number; data: Record<string, unknown> };

export function exportData(): Backup {
  const out: Record<string, unknown> = {};
  for (const [k, v] of data) if (!k.startsWith("meta:")) out[k] = v;
  return { app: "pdf-reader", version: 1, exportedAt: Date.now(), data: out };
}

/** Yedeği mevcut verilerle birleştirir (hiçbir şey silinmez). */
export function importData(backup: Backup) {
  if (backup?.app !== "pdf-reader" || !isRecord(backup.data)) throw new Error("Bu dosya bir yedek değil.");
  for (const [k, v] of Object.entries(backup.data)) {
    if (!k.startsWith("meta:")) set(k, merge(get(k), v));
  }
}

// --- localStorage'dan taşıma -------------------------------------------------------

function legacyEntries(): [string, unknown][] {
  const out: [string, unknown][] = [];
  const json = (k: string) => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "null");
    } catch {
      return null;
    }
  };
  let keys: string[];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return out;
  }
  const prefixes: [string, BookKind][] = [
    ["pdf-reader:annotations:", "annotations"],
    ["pdf-reader:chat-notes:", "chat-notes"],
    ["pdf-reader:toc:v1:", "toc"],
  ];
  for (const k of keys) {
    for (const [prefix, kind] of prefixes) {
      if (k.startsWith(prefix)) {
        const v = json(k);
        if (v != null) out.push([bookKey(kind, k.slice(prefix.length)), v]);
      }
    }
    if (k.startsWith("pdf-reader:profile:v1:")) {
      const v = localStorage.getItem(k);
      if (v) out.push([bookKey("profile", k.slice("pdf-reader:profile:v1:".length)), v]);
    }
  }
  const words = json("pdf-reader:saved-words");
  if (Array.isArray(words)) out.push(["words", words]);
  for (const [book, page] of Object.entries(json("pdf-reader:progress") ?? {})) {
    out.push([bookKey("progress", book), page]);
  }
  for (const [book, pages] of Object.entries(json("pdf-reader:bookmarks") ?? {})) {
    if (Array.isArray(pages) && pages.length) out.push([bookKey("bookmarks", book), pages]);
  }
  for (const book of json("pdf-reader:ocr-disabled") ?? []) out.push([bookKey("ocr-off", book), true]);
  const folders = json("pdf-reader:question-folders");
  if (Array.isArray(folders)) out.push(["question-folders", folders]);
  const lastFolder = localStorage.getItem("pdf-reader:question-last-folder");
  if (lastFolder) out.push(["question-last-folder", lastFolder]);
  return out;
}
