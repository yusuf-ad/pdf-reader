"use client";

import { bookKey, get, set, useStored } from "./storage";

// Kitap başına okuma durumu: kalınan sayfa ve yer imleri.

export function loadProgress(book: string): number | null {
  return get<number>(bookKey("progress", book)) ?? null;
}

export function saveProgress(book: string, page: number) {
  if (loadProgress(book) !== page) set(bookKey("progress", book), page);
}

const EMPTY: number[] = [];

export function toggleBookmark(book: string, page: number) {
  const pages = get<number[]>(bookKey("bookmarks", book)) ?? EMPTY;
  const next = pages.includes(page)
    ? pages.filter((p) => p !== page)
    : [...pages, page].sort((a, b) => a - b);
  set(bookKey("bookmarks", book), next.length ? next : undefined);
}

export function useBookmarks(book: string | null) {
  return useStored(book && bookKey("bookmarks", book), EMPTY);
}
