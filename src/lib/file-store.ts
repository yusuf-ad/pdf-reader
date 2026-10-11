// Kitaplık: açılan/eklenen PDF'ler IndexedDB'de tutulur. Sayfa yenilense de kaybolmaz,
// kitaplıktan tek tıkla açılır. Kapak ve sayfa sayısı ilk açılışta hesaplanıp saklanır.

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

type StoredFile = Book & { data: Blob };

export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
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

/** Tarayıcıdan, yer daralınca kitaplığı silmemesini iste. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

export async function listBooks(): Promise<Book[]> {
  const all = await run<StoredFile[]>("readonly", (s) => s.getAll());
  const recency = (b: Book) => b.openedAt ?? b.addedAt ?? 0;
  return all
    .map((stored) => {
      const { data, ...book } = stored;
      void data; // PDF'in kendisi listeye taşınmaz
      return book;
    })
    .sort((a, b) => recency(b) - recency(a));
}

/** Kitaplığa ekler (varsa dokunmaz). */
export async function addBook(file: File, opened = false) {
  const key = fileKey(file);
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
    data: existing?.data ?? file,
  });
  return { key, isNew: !existing, hasCover: !!existing?.cover };
}

export async function getBook(key: string): Promise<Book | null> {
  const stored = await get(key);
  if (!stored) return null;
  const { data, ...book } = stored;
  void data;
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

export async function removeBook(key: string) {
  await run("readwrite", (s) => s.delete(key));
}
