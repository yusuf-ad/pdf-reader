// Açılan PDF'leri IndexedDB'de tutar: sayfa yenilense de dosya kaybolmaz,
// son açılanlar listesinden tek tıkla geri açılır.

const DB_NAME = "pdf-reader";
const STORE = "files";
const MAX_FILES = 5;

export type RecentFile = {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  openedAt: number;
};

type StoredFile = RecentFile & { data: Blob };

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

async function getAll() {
  const all = await run<StoredFile[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

export async function listRecentFiles(): Promise<RecentFile[]> {
  return (await getAll()).map(({ key, name, size, lastModified, openedAt }) => ({
    key,
    name,
    size,
    lastModified,
    openedAt,
  }));
}

export async function rememberFile(file: File) {
  const key = fileKey(file);
  const existing = await run<StoredFile | undefined>("readonly", (s) => s.get(key));
  await run("readwrite", (s) =>
    s.put({
      key,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      openedAt: Date.now(),
      data: existing?.data ?? file,
    } satisfies StoredFile),
  );
  for (const old of (await getAll()).slice(MAX_FILES)) await forgetFile(old.key);
}

export async function loadFile(key: string): Promise<File | null> {
  const stored = await run<StoredFile | undefined>("readonly", (s) => s.get(key));
  if (!stored) return null;
  return new File([stored.data], stored.name, {
    type: "application/pdf",
    lastModified: stored.lastModified,
  });
}

export async function forgetFile(key: string) {
  await run("readwrite", (s) => s.delete(key));
}
