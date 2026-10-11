"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { loadOcrText } from "./ocr";

export type SearchHit = { page: number; snippet: string; start: number; length: number };

const MAX_HITS = 500;
const textCache = new WeakMap<PDFDocumentProxy, Map<number, string>>();

/** Sayfanın metni; taranmış sayfalarda (book verilirse) OCR ile tanınmış metin. */
export async function getPageText(pdf: PDFDocumentProxy, pageNumber: number, book?: string | null) {
  let pages = textCache.get(pdf);
  if (!pages) textCache.set(pdf, (pages = new Map()));
  const cached = pages.get(pageNumber);
  if (cached !== undefined) return cached;

  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : ""))
    .join("")
    .replace(/\s+/g, " ");
  if (book && text.trim().length < 20) {
    const ocr = await loadOcrText(book, pageNumber);
    // Henüz tanınmadıysa önbelleğe alma; sonra tanınınca bulunabilsin
    if (!ocr) return text;
    pages.set(pageNumber, ocr);
    return ocr;
  }
  pages.set(pageNumber, text);
  return text;
}

type State = { key: string; hits: SearchHit[]; scanned: number };

/** Belgedeki tüm sayfalarda arar; sonuçlar sayfa sayfa gelir. */
export function usePdfSearch(pdf: PDFDocumentProxy | null, query: string, book?: string | null) {
  const [state, setState] = useState<State>({ key: "", hits: [], scanned: 0 });
  const q = query.trim();
  const key = pdf && q.length >= 2 ? `${pdf.fingerprints[0]}:${q.toLowerCase()}` : "";

  useEffect(() => {
    if (!pdf || !key) return;
    let cancelled = false;
    const needle = q.toLowerCase();

    const timer = setTimeout(async () => {
      const hits: SearchHit[] = [];
      for (let p = 1; p <= pdf.numPages && !cancelled; p++) {
        const text = await getPageText(pdf, p, book);
        const haystack = text.toLowerCase();
        for (let i = haystack.indexOf(needle); i >= 0 && hits.length < MAX_HITS; ) {
          const from = Math.max(0, i - 40);
          hits.push({
            page: p,
            snippet: (from > 0 ? "…" : "") + text.slice(from, i + needle.length + 60),
            start: i - from + (from > 0 ? 1 : 0),
            length: needle.length,
          });
          i = haystack.indexOf(needle, i + needle.length);
        }
        if (!cancelled && (p % 25 === 0 || p === pdf.numPages || hits.length >= MAX_HITS)) {
          setState({ key, hits: [...hits], scanned: p });
        }
        if (hits.length >= MAX_HITS) break;
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, key, q, book]);

  const active = key !== "" && state.key === key;
  const hits = active ? state.hits : [];
  const total = pdf?.numPages ?? 0;
  return {
    hits,
    scanned: active ? state.scanned : 0,
    total,
    searching: key !== "" && (!active || (state.scanned < total && hits.length < MAX_HITS)),
    capped: hits.length >= MAX_HITS,
  };
}
