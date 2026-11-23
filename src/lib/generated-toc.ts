"use client";

// PDF'e gömülü içindekiler (outline) olmayan kitaplar için: kitabın basılı içindekiler
// sayfası yapay zekayla okunur, basılı sayfa numaraları PDF sayfalarına eşlenir.
// Yalnızca kullanıcı isteyince çalışır; sonuç kitap başına saklanır.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OutlineItem } from "./book-context";
import { bookKey, get, set, useStored } from "./storage";
import { aiHeaders, hasAiKey } from "./ai-settings";

/** Basılı içindekiler genelde ilk sayfalarda */
const SCAN_PAGES = 30;
const SCAN_PAGE_CHARS = 3000;
/** Basılı sayfa ile PDF sayfası arasındaki fark (kapak, önsöz vb.) en fazla bu kadar aranır */
const MAX_OFFSET = 80;
/** Ofset bulmak için denenecek bölüm sayısı */
const VOTE_ENTRIES = 12;

/** Sunucunun döndürdüğü ham giriş: kitapta yazan sayfa numarasıyla. */
export type TocEntry = { title: string; depth: number; page: number | null };
export type TocResponse = { found: boolean; tocPages: number[]; entries: TocEntry[] };

export function loadGeneratedToc(book: string): OutlineItem[] | null {
  return get<OutlineItem[]>(bookKey("toc", book)) ?? null;
}

function save(book: string, items: OutlineItem[] | null) {
  set(bookKey("toc", book), items ?? undefined);
}

export function useGeneratedToc(book: string | null) {
  return useStored<OutlineItem[] | null>(book && bookKey("toc", book), null);
}

// Dilden bağımsız karşılaştırma: aksanlar atılır, ı/i ayrımı yok sayılır
// (Türkçe küçültme büyük harfli İngilizce başlıklardaki "I"yı "ı" yapıyordu)
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Başlığın sayfada aranacak çekirdeği: "Chapter 3. Functions" → "functions" */
const titleKey = (title: string) =>
  normalize(title)
    .replace(/^(chapter|bölüm|part|kısım|section|ünite|unit)\s+[\p{N}ivxlc]+\s*/u, "")
    .replace(/^[\p{N}]+(\s[\p{N}]+)*\s/u, "")
    .slice(0, 40)
    .trim();

/**
 * Kitabın basılı içindekiler sayfasından içindekileri çıkarır ve saklar.
 * Basılı içindekiler bulunamazsa null döner.
 */
export async function generateToc(
  pdf: PDFDocumentProxy,
  book: string,
  readPage: (page: number) => Promise<string>,
  signal?: AbortSignal,
): Promise<OutlineItem[] | null> {
  if (!hasAiKey()) return null;
  const pageText = new Map<number, string>();
  const read = async (p: number) => {
    if (!pageText.has(p)) pageText.set(p, normalize(await readPage(p).catch(() => "")));
    return pageText.get(p)!;
  };

  const sample: string[] = [];
  for (let p = 1; p <= Math.min(SCAN_PAGES, pdf.numPages); p++) {
    const text = (await readPage(p).catch(() => "")).trim();
    if (text) sample.push(`[s. ${p}]\n${text.slice(0, SCAN_PAGE_CHARS)}`);
  }
  if (!sample.length) throw new Error("İlk sayfalarda okunabilir metin yok (taranmışsa önce metin tanımayı aç).");

  if (!hasAiKey()) return null;
  const res = await fetch("/api/toc", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...aiHeaders() },
    body: JSON.stringify({ numPages: pdf.numPages, sample: sample.join("\n\n") }),
    signal,
  });
  const data = (await res.json()) as TocResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "İçindekiler çıkarılamadı.");
  if (!data.found || !data.entries.length) return null;

  // İçindekiler sayfalarında bütün başlıklar geçtiği için aramada atlanır
  const skip = new Set(data.tocPages);
  const findFrom = async (key: string, from: number, to: number) => {
    for (let p = Math.max(1, from); p <= Math.min(pdf.numPages, to); p++) {
      if (!skip.has(p) && (await read(p)).includes(key)) return p;
    }
    return null;
  };

  // Ofset: birkaç bölüm başlığının ilk geçtiği sayfaya göre oylanır
  const numbered = data.entries.filter((e) => e.page !== null && titleKey(e.title).length >= 4);
  const step = Math.max(1, Math.floor(numbered.length / VOTE_ENTRIES));
  const votes = new Map<number, number>();
  for (let i = 0; i < numbered.length; i += step) {
    signal?.throwIfAborted();
    const e = numbered[i];
    const found = await findFrom(titleKey(e.title), e.page!, e.page! + MAX_OFFSET);
    if (found !== null) votes.set(found - e.page!, (votes.get(found - e.page!) ?? 0) + 1);
  }
  const offset = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  // Her başlık beklenen sayfanın çevresinde aranır; bulunamazsa ofsetle hesaplanan sayfa
  const items: OutlineItem[] = [];
  for (const e of data.entries) {
    signal?.throwIfAborted();
    let page: number | null = null;
    if (e.page !== null) {
      const expected = e.page + offset;
      const key = titleKey(e.title);
      page = (key.length >= 4 && (await findFrom(key, expected - 1, expected + 2))) || expected;
      page = Math.min(pdf.numPages, Math.max(1, page));
    }
    items.push({ title: e.title, depth: Math.min(2, Math.max(0, e.depth)), page });
  }
  save(book, items);
  return items;
}
