"use client";

import { useSyncExternalStore } from "react";

// Dosya başına okuma durumu: kalınan sayfa ve yer imleri (localStorage).

const PROGRESS_KEY = "pdf-reader:progress";
const BOOKMARKS_KEY = "pdf-reader:bookmarks";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadProgress(fileKey: string): number | null {
  return readJson<Record<string, number>>(PROGRESS_KEY, {})[fileKey] ?? null;
}

export function saveProgress(fileKey: string, page: number) {
  const all = readJson<Record<string, number>>(PROGRESS_KEY, {});
  all[fileKey] = page;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

type Bookmarks = Record<string, number[]>;
const EMPTY: number[] = [];
let bookmarksCache: Bookmarks | null = null;
const listeners = new Set<() => void>();

function bookmarks(): Bookmarks {
  bookmarksCache ??= readJson<Bookmarks>(BOOKMARKS_KEY, {});
  return bookmarksCache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleBookmark(fileKey: string, page: number) {
  const pages = bookmarks()[fileKey] ?? [];
  const next = pages.includes(page)
    ? pages.filter((p) => p !== page)
    : [...pages, page].sort((a, b) => a - b);
  bookmarksCache = { ...bookmarks(), [fileKey]: next };
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarksCache));
  listeners.forEach((l) => l());
}

export function useBookmarks(fileKey: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (fileKey && bookmarks()[fileKey]) || EMPTY,
    () => EMPTY,
  );
}
