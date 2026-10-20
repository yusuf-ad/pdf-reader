"use client";

import { useSyncExternalStore } from "react";
import { get as getStored, set as setStored, useStored } from "./storage";

// Yapamadığım sorular: PDF'ten kırpılan (ya da yapıştırılan) soru görüntüleri.
// Görüntüler localStorage'a sığmayacağı için ayrı bir IndexedDB veritabanında tutulur.
// Kitap kitaplıktan silinse de sorular kalır (görüntü kendi içinde saklı).
// Sorular klasörlere ayrılır (ör. "Adverbial Clauses testi"); klasör listesi diğer
// kullanıcı verileriyle birlikte ortak depoda (storage.ts) tutulur.

const DB_NAME = "pdf-reader-questions";
const STORE = "questions";

export type QuestionStatus = "open" | "solved";

export type Question = {
  id: string;
  image: Blob;
  /** Kırpıldığı kitabın anahtarı; dışarıdan yapıştırıldıysa ve kitap açık değilse yok */
  book: string | null;
  /** Kitap adı (kitap silinse de listede gösterilsin) */
  bookName: string | null;
  page: number | null;
  /** PDF'ten kırpıldıysa bölgenin kaynak sayfadaki genişliği (pt); birleşik PDF'te aynı boyutta basılır */
  sourceWidth?: number;
  folderId: string | null;
  /** Eski sürümde klasör yerine konu yazılıyordu; ilk yüklemede klasöre çevrilir */
  topic?: string;
  note: string;
  status: QuestionStatus;
  createdAt: number;
};

export type NewQuestion = Omit<Question, "id" | "status" | "createdAt" | "topic">;

export type Folder = { id: string; name: string; createdAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

// Hepsi bellekte tutulur (yüzlerce soru bile birkaç MB); ilk kullanımda yüklenir.
const EMPTY: Question[] = [];
let cache: Question[] | null = null;
let loading = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());
const byNewest = (a: Question, b: Question) => b.createdAt - a.createdAt;

function read() {
  if (!cache && !loading && typeof indexedDB !== "undefined") {
    loading = true;
    run<Question[]>("readonly", (s) => s.getAll())
      .then((all) => {
        cache = all.sort(byNewest);
        notify();
        migrateTopics();
      })
      .catch(() => {
        cache = [];
      })
      .finally(() => {
        loading = false;
      });
  }
  return cache ?? EMPTY;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuestions() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

function set(next: Question[]) {
  cache = next;
  notify();
}

export async function addQuestion(entry: NewQuestion) {
  const question: Question = { ...entry, id: crypto.randomUUID(), status: "open", createdAt: Date.now() };
  await run("readwrite", (s) => s.put(question));
  set([question, ...read()]);
  return question;
}

export async function updateQuestion(id: string, patch: Partial<Pick<Question, "folderId" | "note" | "status">>) {
  const existing = read().find((q) => q.id === id);
  if (!existing) return;
  const next = { ...existing, ...patch };
  await run("readwrite", (s) => s.put(next));
  set(read().map((q) => (q.id === id ? next : q)));
}

export async function removeQuestion(id: string) {
  await run("readwrite", (s) => s.delete(id));
  const removed = read().find((q) => q.id === id);
  set(read().filter((q) => q.id !== id));
  const url = removed && urls.get(removed.image);
  if (url) URL.revokeObjectURL(url);
}

// Görüntülerin <img> adresi; her görüntü için bir kez oluşturulur
const urls = new WeakMap<Blob, string>();

export function imageUrl(blob: Blob) {
  let url = urls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(blob, url);
  }
  return url;
}

// --- Klasörler -----------------------------------------------------------

const FOLDERS_KEY = "question-folders";
const LAST_FOLDER_KEY = "question-last-folder";
const NO_FOLDERS: Folder[] = [];

const readFolders = () => getStored<Folder[]>(FOLDERS_KEY) ?? NO_FOLDERS;
const writeFolders = (next: Folder[]) => setStored(FOLDERS_KEY, next);

/** Klasörler, ada göre sıralı. */
export function useFolders() {
  return useStored(FOLDERS_KEY, NO_FOLDERS);
}

export function createFolder(name: string): Folder {
  const trimmed = name.trim();
  const existing = readFolders().find((f) => f.name.toLocaleLowerCase("tr") === trimmed.toLocaleLowerCase("tr"));
  if (existing) return existing;
  const folder = { id: crypto.randomUUID(), name: trimmed, createdAt: Date.now() };
  writeFolders([...readFolders(), folder].sort((a, b) => a.name.localeCompare(b.name, "tr")));
  return folder;
}

export function renameFolder(id: string, name: string) {
  if (!name.trim()) return;
  writeFolders(
    readFolders()
      .map((f) => (f.id === id ? { ...f, name: name.trim() } : f))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
  );
}

/** Klasörü siler; içindeki sorular silinmez, klasörsüz kalır. */
export async function deleteFolder(id: string) {
  writeFolders(readFolders().filter((f) => f.id !== id));
  if (getLastFolder() === id) setLastFolder(null);
  for (const q of read().filter((q) => q.folderId === id)) await updateQuestion(q.id, { folderId: null });
}

/** Yeni soru için önerilen klasör: en son kullanılan (bir testin sorularını art arda eklerken) */
export function getLastFolder(): string | null {
  const id = getStored<string>(LAST_FOLDER_KEY);
  return id && readFolders().some((f) => f.id === id) ? id : null;
}

export function setLastFolder(id: string | null) {
  setStored(LAST_FOLDER_KEY, id ?? undefined);
}

/** Kitabın anahtarı değişince ondan kırpılan sorular yeni anahtara bağlanır. */
export async function renameBookQuestions(from: string, to: string, movePage = (page: number) => page) {
  const all = await run<Question[]>("readonly", (s) => s.getAll());
  for (const q of all.filter((q) => q.book === from)) {
    const next = { ...q, book: to, page: q.page == null ? q.page : movePage(q.page) };
    await run("readwrite", (s) => s.put(next));
    if (cache) set(read().map((x) => (x.id === q.id ? next : x)));
  }
}

// --- Yedek -----------------------------------------------------------------

type QuestionBackup = Omit<Question, "image"> & { image: string };

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Sorular, görüntüleri data URL olarak (yedek dosyasına yazmak için). */
export async function exportQuestions(): Promise<QuestionBackup[]> {
  const all = await run<Question[]>("readonly", (s) => s.getAll());
  return Promise.all(all.map(async (q) => ({ ...q, image: await toDataUrl(q.image) })));
}

/** Yedekteki soruları ekler; aynı kimlikli soru zaten varsa dokunmaz. */
export async function importQuestions(items: QuestionBackup[]) {
  const existing = new Set((await run<Question[]>("readonly", (s) => s.getAll())).map((q) => q.id));
  const added: Question[] = [];
  for (const item of items) {
    if (existing.has(item.id)) continue;
    const image = await (await fetch(item.image)).blob();
    const q: Question = { ...item, image };
    await run("readwrite", (s) => s.put(q));
    added.push(q);
  }
  if (added.length && cache) set([...added, ...read()].sort(byNewest));
  return added.length;
}

/** Eski "konu" alanı olan sorular aynı adlı klasöre taşınır. */
async function migrateTopics() {
  for (const q of read()) {
    if (!q.topic || q.folderId) continue;
    const { topic, ...rest } = q;
    const next = { ...rest, folderId: createFolder(topic).id };
    await run("readwrite", (s) => s.put(next));
    set(read().map((x) => (x.id === q.id ? next : x)));
  }
}

/**
 * Sayfanın bir bölgesini yüksek çözünürlükte PNG olarak çizer.
 * Bölge sayfaya oranla verilir (0–1); ekrandaki canvas yerine sayfa yeniden çizildiği için
 * yakınlaştırma düzeyinden bağımsız olarak net çıkar.
 */
export async function cropPage(
  pdf: import("pdfjs-dist").PDFDocumentProxy,
  pageNumber: number,
  region: { x: number; y: number; w: number; h: number },
): Promise<{ image: Blob; sourceWidth: number }> {
  const page = await pdf.getPage(pageNumber);
  const natural = page.getViewport({ scale: 1 });
  // Kırpılan parça en az ~1400px genişlikte olsun; çok büyük canvas'tan kaçın
  const scale = Math.min(5, Math.max(2, 1400 / (region.w * natural.width)));
  const viewport = page.getViewport({ scale });
  const full = document.createElement("canvas");
  full.width = Math.round(viewport.width);
  full.height = Math.round(viewport.height);
  await page.render({ canvas: full, viewport }).promise;

  const sx = Math.round(region.x * full.width);
  const sy = Math.round(region.y * full.height);
  const sw = Math.max(1, Math.round(region.w * full.width));
  const sh = Math.max(1, Math.round(region.h * full.height));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  full.width = full.height = 0; // belleği hemen bırak

  const image = await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Görüntü oluşturulamadı."))), "image/png"),
  );
  return { image, sourceWidth: +(region.w * natural.width).toFixed(1) };
}
