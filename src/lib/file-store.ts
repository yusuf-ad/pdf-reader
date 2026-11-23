// Kitaplık: açılan/eklenen PDF'ler IndexedDB'de tutulur. Sayfa yenilense de kaybolmaz,
// kitaplıktan tek tıkla açılır. Kapak ve sayfa sayısı ilk açılışta hesaplanıp saklanır.

import { renameBookOcr } from "./ocr";
import { renameBookQuestions } from "./questions";
import { renameBook, storedBooks } from "./storage";

const DB_NAME = "pdf-reader";
const STORE = "files";

export type Book = {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  /** Kitaplığa eklenme zamanı */
  addedAt: number;
  /** Son açılma zamanı; hiç açılmadıysa yok */
  openedAt?: number;
  numPages?: number;
  /** İlk sayfanın küçük JPEG'i (data URL) */
  cover?: string;
};

type StoredFile = Book & {
  data: Blob;
  /** Notlu PDF'in en son kaydedildiği dosya (Ctrl S yeniden sormadan buraya yazar) */
  saveHandle?: FileSystemFileHandle;
};

/**
 * Kitabın anahtarı PDF'in içeriğinden üretilir: dosya kopyalansa, yeniden indirilse ya da
 * OneDrive eşitlerken tarihini değiştirse de aynı kalır. Notlar kitaba bu anahtarla bağlıdır.
 */
export async function contentKey(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (crypto.subtle) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return "pdf:" + [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Güvenli olmayan bağlantıda (http://192.168…) crypto.subtle yok: FNV-1a, iki tohumla
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = Math.imul(b ^ bytes[i], 0x5bd1e995);
  }
  return `pdfx:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${bytes.length}`;
}

const isContentKey = (key: string) => /^pdfx?:/.test(key);

/** Eski sürümün anahtarı (ad:boyut:değiştirilme tarihi) bu dosyaya mı ait? */
function isLegacyKeyOf(key: string, name: string, size: number) {
  const m = !isContentKey(key) && key.match(/^(.*):(\d+):(\d+)$/);
  return !!m && m[1] === name && +m[2] === size;
}

/**
 * Eski sürümde dosyanın tarihi değişince (yeniden indirme, OneDrive eşitlemesi) aynı kitap
 * yeni bir anahtar alıyor, notları eski anahtarda "kayboluyordu". Aynı ad ve boyuttaki
 * eski anahtarlarda kalan her şey bu kitaba taşınır.
 */
export async function adoptLegacyData(name: string, size: number, key: string, extra: string[] = []) {
  const olds = new Set([...extra, ...storedBooks().filter((b) => isLegacyKeyOf(b, name, size))]);
  for (const old of olds) {
    renameBook(old, key);
    await renameBookOcr(old, key).catch(() => {});
    await renameBookQuestions(old, key).catch(() => {});
  }
}

/** Kitaplıktaki eski anahtarlı kayıtları içerik anahtarına çevirir (bir kez, açılışta). */
export async function migrateLibrary(onStart?: () => void) {
  const all = await run<StoredFile[]>("readonly", (s) => s.getAll());
  const legacy = all.filter((b) => !isContentKey(b.key));
  if (legacy.length) onStart?.();
  for (const old of legacy) {
    const key = await contentKey(old.data);
    // Aynı PDF kitaplıkta iki kez olabilir (tarihi farklı kopyalar): tek kayıtta birleşir
    const existing = await get(key);
    const opened = [existing?.openedAt, old.openedAt].filter((t): t is number => !!t);
    await put({
      ...old,
      ...existing,
      key,
      addedAt: Math.min(old.addedAt, existing?.addedAt ?? Infinity),
      openedAt: opened.length ? Math.max(...opened) : undefined,
      numPages: existing?.numPages ?? old.numPages,
      cover: existing?.cover ?? old.cover,
      saveHandle: existing?.saveHandle ?? old.saveHandle,
      data: existing?.data ?? old.data,
    });
    await run("readwrite", (s) => s.delete(old.key));
    await adoptLegacyData(old.name, old.size, key, [old.key]);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
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

const get = (key: string) => run<StoredFile | undefined>("readonly", (s) => s.get(key));
const put = (file: StoredFile) => run("readwrite", (s) => s.put(file));

export async function listBooks(): Promise<Book[]> {
  const all = await run<StoredFile[]>("readonly", (s) => s.getAll());
  const recency = (b: Book) => b.openedAt ?? b.addedAt ?? 0;
  return all
    .map((stored) => {
      const { data, saveHandle, ...book } = stored;
      void data; // PDF'in kendisi listeye taşınmaz
      void saveHandle;
      return book;
    })
    .sort((a, b) => recency(b) - recency(a));
}

/** Kitaplığa ekler (varsa dokunmaz). */
export async function addBook(file: File, opened = false, knownKey?: string) {
  const key = knownKey ?? (await contentKey(file));
  if (!knownKey) await adoptLegacyData(file.name, file.size, key);
  const existing = await get(key);
  const now = Date.now();
  await put({
    key,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    addedAt: existing?.addedAt ?? existing?.openedAt ?? now,
    openedAt: opened ? now : existing?.openedAt,
    numPages: existing?.numPages,
    cover: existing?.cover,
    saveHandle: existing?.saveHandle,
    data: existing?.data ?? file,
  });
  return { key, isNew: !existing, hasCover: !!existing?.cover };
}

const ONBOARDED_KEY = "pdf-reader:onboarded";
let onboardedThisSession = false;
let welcomePending: Promise<string | null> | null = null;

/** The sample uses the same content-keyed import as uploaded PDFs. */
export function addWelcomeBook(onlyFirstVisit = false): Promise<string | null> {
  if (welcomePending) return welcomePending;
  welcomePending = (async () => {
    if (onlyFirstVisit) {
      if (onboardedThisSession) return null;
      try {
        if (localStorage.getItem(ONBOARDED_KEY)) return null;
      } catch {
        // IndexedDB may still be available when localStorage is blocked.
      }
      // Library first renders before Reader finishes loading its book list.
      if ((await listBooks()).length) return null;
    }
    const response = await fetch("/samples/welcome.pdf");
    if (!response.ok) throw new Error("welcome_pdf_unavailable");
    const file = new File([await response.blob()], "Welcome.pdf", {
      type: "application/pdf",
      lastModified: 0,
    });
    // A user may have imported their own file while the sample was loading.
    if (onlyFirstVisit && (await listBooks()).length) return null;
    const { key } = await addBook(file);
    onboardedThisSession = true;
    try {
      localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {
      // Remember it for this session if persistent storage is unavailable.
    }
    return key;
  })().finally(() => { welcomePending = null; });
  return welcomePending;
}

export async function getBook(key: string): Promise<Book | null> {
  const stored = await get(key);
  if (!stored) return null;
  const { data, saveHandle, ...book } = stored;
  void data;
  void saveHandle;
  return book;
}

export async function updateBook(key: string, patch: Pick<Book, "numPages" | "cover">) {
  const existing = await get(key);
  if (existing) await put({ ...existing, ...patch });
}

export async function loadFile(key: string): Promise<File | null> {
  const stored = await get(key);
  if (!stored) return null;
  return new File([stored.data], stored.name, {
    type: "application/pdf",
    lastModified: stored.lastModified,
  });
}

/**
 * Kitabın PDF'i değişti (araya sayfa eklendi): kayıt yeni içerik anahtarına taşınır;
 * adı, kapağı, kaydedildiği dosya ve tarihleri aynı kalır.
 */
export async function replaceBookFile(from: string, to: string, file: File, numPages: number) {
  const existing = await get(from);
  const now = Date.now();
  await put({
    ...existing,
    key: to,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    addedAt: existing?.addedAt ?? now,
    openedAt: now,
    numPages,
    data: file,
  });
  if (from !== to) await run("readwrite", (s) => s.delete(from));
}

export async function getSaveHandle(key: string) {
  return (await get(key))?.saveHandle ?? null;
}

export async function setSaveHandle(key: string, saveHandle: FileSystemFileHandle | null) {
  const existing = await get(key);
  if (existing) await put({ ...existing, saveHandle: saveHandle ?? undefined });
}

export async function removeBook(key: string) {
  await run("readwrite", (s) => s.delete(key));
}
