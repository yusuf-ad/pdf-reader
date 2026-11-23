/**
 * Sohbetin, okunan kitabı tanıması için: kitabın künyesi ve kısa bir profili (bir kez
 * çıkarılıp saklanır) ile her soruda açık olan bölüm ve sayfa. İstemci ve sunucu ortak kullanır.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import { aiHeaders, hasAiKey } from "./ai-settings";
import { clientAiErrorCode } from "./chat";

/** Her sohbet isteğiyle sunucuya giden kitap bilgisi. */
export type BookContext = {
  fileName: string | null;
  title: string | null;
  author: string | null;
  /** Modelin çıkardığı kitap profili (tür, konu, teknolojiler, bölümler) */
  profile: string | null;
  page: number;
  numPages: number;
  /** Açık sayfanın içinde bulunduğu bölüm, ör. "3. Functions › Closures" */
  chapter: string | null;
  /** Açık sayfanın metni; seçili metin yoksa "bu", "burada" gibi ifadeler buna göre yorumlanır */
  pageText: string | null;
  /** Kullanıcının kitaptaki işaretleri (vurgu, fosforlu kalem, sayfa notları) ve altlarındaki yazı */
  marks?: string | null;
};

/** Profil çıkarmak için sunucuya giden ham bilgi. */
export type ProfileRequest = {
  fileName: string | null;
  title: string | null;
  author: string | null;
  numPages: number;
  outline: string;
  sample: string;
};

export const PAGE_TEXT_CHARS = 5000;
export const MARKS_CHARS = 16000;
const SAMPLE_PAGES = 12;
const SAMPLE_PAGE_CHARS = 2000;
const OUTLINE_ITEMS = 200;

export type OutlineItem = { title: string; depth: number; page: number | null };

type Info = { title: string | null; author: string | null; outline: OutlineItem[] };
const infoCache = new WeakMap<PDFDocumentProxy, Promise<Info>>();

type RawOutline = { title: string; dest: string | unknown[] | null; items: RawOutline[] };

async function resolvePage(pdf: PDFDocumentProxy, dest: RawOutline["dest"]) {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const ref = explicit[0];
    if (typeof ref === "number") return ref + 1;
    return (await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
  } catch {
    return null;
  }
}

async function flatten(pdf: PDFDocumentProxy, items: RawOutline[], depth = 0): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  for (const it of items) {
    out.push({ title: it.title.trim(), depth, page: await resolvePage(pdf, it.dest) });
    // Üç seviyeden derini profil ve bölüm bulmak için gereksiz
    if (depth < 2) out.push(...(await flatten(pdf, it.items ?? [], depth + 1)));
  }
  return out;
}

/** PDF'in künyesi (başlık, yazar) ve içindekiler; belge başına bir kez okunur. */
export function getBookInfo(pdf: PDFDocumentProxy): Promise<Info> {
  let info = infoCache.get(pdf);
  if (!info) {
    info = (async () => {
      const [meta, outline] = await Promise.all([
        pdf.getMetadata().catch(() => null),
        pdf.getOutline().catch(() => null),
      ]);
      const raw = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown };
      const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      return {
        title: clean(raw.Title),
        author: clean(raw.Author),
        outline: outline ? await flatten(pdf, outline as RawOutline[]) : [],
      };
    })();
    infoCache.set(pdf, info);
  }
  return info;
}

/** Açık sayfanın bulunduğu bölüm yolu: her seviyede sayfadan önce başlayan son başlık. */
export function chapterAt(outline: OutlineItem[], page: number) {
  const path: string[] = [];
  for (const item of outline) {
    if (item.page === null || item.page > page) continue;
    path.length = item.depth;
    path[item.depth] = item.title;
  }
  return path.filter(Boolean).join(" › ") || null;
}

export const formatOutline = (outline: OutlineItem[]) =>
  outline
    .slice(0, OUTLINE_ITEMS)
    .map((o) => `${"  ".repeat(o.depth)}- ${o.title}${o.page ? ` (s. ${o.page})` : ""}`)
    .join("\n");

const profileRequests = new Map<string, Promise<string | null>>();

/**
 * Kitap profili: ilk istekte künye, içindekiler ve ilk sayfalardan çıkarılır, sonra
 * tarayıcıda saklanır. Çıkarılamazsa null (sohbet yine künyeyle çalışır).
 */
export function getBookProfile(
  pdf: PDFDocumentProxy,
  book: string,
  fileName: string | null,
  readPage: (page: number) => Promise<string>,
  /** Profilin tarayıcıda saklandığı yer */
  stored: { get: () => string | undefined; set: (profile: string) => void },
  onError?: (code: string) => void,
): Promise<string | null> {
  const saved = stored.get();
  if (saved) return Promise.resolve(saved);
  if (!hasAiKey()) return Promise.resolve(null);
  let req = profileRequests.get(book);
  if (!req) {
    req = (async () => {
      const info = await getBookInfo(pdf);
      const sample: string[] = [];
      for (let p = 1; p <= Math.min(SAMPLE_PAGES, pdf.numPages); p++) {
        const text = (await readPage(p)).trim();
        if (text) sample.push(`[s. ${p}]\n${text.slice(0, SAMPLE_PAGE_CHARS)}`);
      }
      const body: ProfileRequest = {
        fileName,
        title: info.title,
        author: info.author,
        numPages: pdf.numPages,
        outline: formatOutline(info.outline),
        sample: sample.join("\n\n"),
      };
      if (!hasAiKey()) return null;
      const res = await fetch("/api/book-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const { profile } = (await res.json()) as { profile: string };
      stored.set(profile);
      return profile;
    })().catch((error: unknown) => {
      const code = clientAiErrorCode(error);
      if (code) onError?.(code);
      return null;
    }).finally(() => profileRequests.delete(book)); // sonraki soruda yeniden denensin
    profileRequests.set(book, req);
  }
  return req;
}

/** Profilin ilk satırı: "Kitap: …" özeti (arayüzde gösterilir). */
export const profileHeadline = (profile: string) =>
  profile.split("\n")[0].replace(/^\**\s*kitap\s*:\s*\**\s*/i, "").trim();

/** Sistem talimatına eklenen kitap bloğu. */
export function formatBookContext(b: BookContext, includePage: boolean) {
  const lines = [
    b.title && `Başlık (PDF künyesi): ${b.title}`,
    b.author && `Yazar (PDF künyesi): ${b.author}`,
    b.fileName && `Dosya adı: ${b.fileName}`,
    b.profile && `Kitap profili:\n${b.profile}`,
    `Şu an açık sayfa: ${b.page} / ${b.numPages}`,
    b.chapter && `Açık bölüm: ${b.chapter}`,
  ].filter(Boolean);
  const page = includePage && b.pageText ? `\n<acik_sayfa sayfa="${b.page}">\n${b.pageText}\n</acik_sayfa>` : "";
  const marks = b.marks ? `\n<isaretler>\n${b.marks}\n</isaretler>` : "";
  return `<kitap>\n${lines.join("\n")}\n</kitap>${page}${marks}`;
}
