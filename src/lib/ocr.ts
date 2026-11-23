"use client";

import type { PDFPageProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import type { Worker } from "tesseract.js";
import { bookKey, set, useStored } from "./storage";

// Taranmış (yalnızca resimden oluşan) sayfalar için metin tanıma.
// Sayfa ekrana gelince arka planda tesseract.js ile okunur; kelimeler sayfadaki
// konumlarıyla görünmez bir metin katmanı olarak yerleştirilir ve seçilebilir olur.
// Sonuçlar IndexedDB'de saklanır, aynı sayfa bir daha okunmaz.

/** Tanınacak dil(ler); örn. "eng+tur" */
const LANGS = "eng";
// Bundan az harf içeren sayfa "taranmış" sayılır
const MIN_TEXT_CHARS = 20;
// Bundan çok harf varsa görüntü olsa da metinli sayfa sayılır
const FULL_TEXT_CHARS = 200;
// Tesseract ~300 DPI sever; sayfa bu genişlikte çizilip okunur
const OCR_WIDTH = 1800;
const MIN_CONFIDENCE = 30;

/** Kelime ve sınırları (sayfaya oranla 0–1): [x0, y0, x1, y1] */
export type OcrWord = { t: string; b: [number, number, number, number] };
export type OcrPage = { lines: OcrWord[][] };

export type OcrState =
  | { status: "idle" | "has-text" | "loading" | "error" }
  | { status: "done"; data: OcrPage };

// --- Sonuç önbelleği (IndexedDB) -------------------------------------------

const DB_NAME = "pdf-reader-ocr";
const STORE = "pages";
let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const pageKey = (book: string, page: number) => `${book}#${page}`;

export async function loadOcr(book: string, page: number): Promise<OcrPage | undefined> {
  try {
    return await idb<OcrPage | undefined>("readonly", (s) => s.get(pageKey(book, page)));
  } catch {
    return undefined;
  }
}

/** OCR ile tanınmış sayfanın düz metni (arama, sohbet bağlamı için). */
export async function loadOcrText(book: string, page: number) {
  const data = await loadOcr(book, page);
  return data?.lines.map((line) => line.map((w) => w.t).join(" ")).join(" ");
}

const bookRange = (book: string) => IDBKeyRange.bound(`${book}#`, `${book}#￿`);

export async function deleteBookOcr(book: string) {
  await idb("readwrite", (s) => s.delete(bookRange(book))).catch(() => {});
}

/**
 * Kitabın anahtarı değişince tanınmış sayfaları yeni anahtara taşır. Araya sayfa eklendiyse
 * `movePage` sayfa numaralarını kaydırır.
 */
export async function renameBookOcr(from: string, to: string, movePage = (page: number) => page) {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const req = store.openCursor(bookRange(from));
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    const page = Number(String(cursor.key).slice(from.length + 1));
    store.put(cursor.value, pageKey(to, movePage(page)));
    cursor.delete();
    cursor.continue();
  };
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// --- Tanıma kuyruğu -----------------------------------------------------------

let workerPromise: Promise<Worker> | null = null;

function worker() {
  workerPromise ??= import("tesseract.js").then(({ createWorker }) => createWorker(LANGS));
  workerPromise.catch(() => (workerPromise = null)); // ağ hatası: sonra tekrar denensin
  return workerPromise;
}

type Job = { run: () => Promise<void>; signal: AbortSignal };
const queue: Job[] = [];
let running = false;

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    // En son istenen önce: kullanıcının şu an baktığı sayfa
    const job = queue.pop()!;
    if (!job.signal.aborted) await job.run();
  }
  running = false;
}

async function recognize(page: PDFPageProxy): Promise<OcrPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: OCR_WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;

  const w = await worker();
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
  const r = (n: number) => +n.toFixed(4);
  const lines: OcrWord[][] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const words = line.words
          .filter((word) => word.text.trim() && word.confidence >= MIN_CONFIDENCE)
          .map((word) => ({
            t: word.text,
            b: [
              r(word.bbox.x0 / canvas.width),
              r(word.bbox.y0 / canvas.height),
              r(word.bbox.x1 / canvas.width),
              r(word.bbox.y1 / canvas.height),
            ] as OcrWord["b"],
          }));
        if (words.length) lines.push(words);
      }
  return { lines };
}

function enqueue(page: PDFPageProxy, key: string, signal: AbortSignal) {
  return new Promise<OcrPage>((resolve, reject) => {
    queue.push({
      signal,
      // Başlamış iş, sayfadan çıkılsa da bitirilip saklanır
      run: () =>
        recognize(page)
          .then(async (data) => {
            await idb("readwrite", (s) => s.put(data, key)).catch(() => {});
            resolve(data);
          })
          .catch(reject),
    });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    drain();
  });
}

// pdf.js OPS: paintImageMaskXObject, paintImageXObject, paintInlineImageXObject(Group), paintImageXObjectRepeat
const IMAGE_OPS = new Set([83, 85, 86, 87, 88]);

async function hasText(page: PDFPageProxy) {
  const content = await page.getTextContent();
  let chars = 0;
  for (const item of content.items) {
    if ("str" in item) chars += item.str.replace(/\s/g, "").length;
    if (chars >= FULL_TEXT_CHARS) return true;
  }
  if (chars < MIN_TEXT_CHARS) return false;
  // Az metin + sayfa görüntüsü: tarayıcı uygulamalarının filigranı ("Scanned with …") ya da
  // yalnızca başlık/sayfa numarası metin olarak eklenmiş taranmış sayfa
  const ops = await page.getOperatorList();
  return !ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
}

/** Sayfa taranmışsa (metni yoksa) OCR ile tanır; sonucu önbellekten de getirebilir. */
export function useOcr(book: string, page: PDFPageProxy | null, enabled: boolean) {
  const [state, setState] = useState<{ key: string; value: OcrState }>({
    key: "",
    value: { status: "idle" },
  });
  const pageNumber = page?.pageNumber ?? 0;
  const key = page && enabled ? pageKey(book, pageNumber) : "";

  useEffect(() => {
    if (!page || !key) return;
    const controller = new AbortController();
    const set = (value: OcrState) => !controller.signal.aborted && setState({ key, value });

    (async () => {
      try {
        const cached = await loadOcr(book, pageNumber);
        if (cached) return set({ status: "done", data: cached });
        // Beklerken belge kapatıldıysa sayfa yok edilmiş olur; ona dokunma
        if (controller.signal.aborted) return;
        if (await hasText(page)) return set({ status: "has-text" });
        set({ status: "loading" });
        const data = await enqueue(page, key, controller.signal);
        set({ status: "done", data });
      } catch {
        set({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [book, page, pageNumber, key]);

  return state.key === key ? state.value : { status: "idle" as const };
}

// --- Kitap başına açma/kapama ----------------------------------------------------

export function setOcrEnabled(book: string, enabled: boolean) {
  set(bookKey("ocr-off", book), enabled ? undefined : true);
}

export function useOcrEnabled(book: string | null) {
  const off = useStored(book && bookKey("ocr-off", book), false);
  return !!book && !off;
}
