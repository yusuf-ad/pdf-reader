"use client";

import { useSyncExternalStore } from "react";
import { bookKey, get, set, subscribe, useStored } from "./storage";

// Sayfalara eklenen kalem çizgileri, yazılar ve metin vurguları (kitap başına).
// Koordinatlar sayfa genişliği/yüksekliğine oranlanır (0–1); böylece her yakınlaştırmada
// aynı yere düşer. Kalınlık ve yazı boyutu sayfa genişliğine oranlıdır.

export type Tool = "pen" | "marker" | "text" | "eraser";

export const INK_COLORS = ["#1f1d1a", "#c0392b", "#2e5fa8", "#2f7d4f"] as const;

export type Stroke = {
  id: string;
  type: "ink";
  color: string;
  width: number;
  /** x0, y0, x1, y1, … */
  points: number[];
  /** Fosforlu kalem: geniş, yarı saydam, yazının altında kalır */
  marker?: boolean;
};

export type Note = {
  id: string;
  type: "text";
  color: string;
  x: number;
  y: number;
  size: number;
  text: string;
  /** En fazla genişlik (sayfaya oranla); yoksa sayfanın sağ kenarına kadar */
  width?: number;
};

/** Fosforlu kalemle vurgulanan metin; her satır bir dikdörtgen. */
export type Highlight = {
  id: string;
  type: "highlight";
  color: string;
  /** x, y, genişlik, yükseklik, … (sayfaya oranla) */
  rects: number[];
  text: string;
  createdAt: number;
};

export const HIGHLIGHT_COLORS = [
  { color: "#f5c518", label: "Sarı" },
  { color: "#7bc96f", label: "Yeşil" },
  { color: "#5aa9e6", label: "Mavi" },
  { color: "#f27aa6", label: "Pembe" },
] as const;

export type Annotation = Stroke | Note | Highlight;

type BookAnnotations = Record<number, Annotation[]>;

const HISTORY_LIMIT = 100;
const EMPTY: Annotation[] = [];
const EMPTY_BOOK: BookAnnotations = {};

// Geri alma: her değişiklikten önceki sayfa durumu
const history: { book: string; page: number; items: Annotation[] }[] = [];

const key = (book: string) => bookKey("annotations", book);
const load = (book: string) => get<BookAnnotations>(key(book)) ?? EMPTY_BOOK;

function write(book: string, page: number, items: Annotation[], record = true) {
  const data = load(book);
  if (record) {
    history.push({ book, page, items: data[page] ?? EMPTY });
    if (history.length > HISTORY_LIMIT) history.shift();
  }
  const next = { ...data };
  if (items.length) next[page] = items;
  else delete next[page];
  set(key(book), Object.keys(next).length ? next : undefined);
}

export function usePageAnnotations(book: string | null, page: number) {
  // Yalnızca bu sayfa değişince yeniden çizilsin
  return useSyncExternalStore(
    subscribe,
    () => (book && load(book)[page]) || EMPTY,
    () => EMPTY,
  );
}

/** Kitabın tüm sayfalarındaki notlar (vurgu listesi için). */
export function useBookAnnotations(book: string | null) {
  return useStored(book && key(book), EMPTY_BOOK);
}

/** Kitabın tüm notları (PDF'e yazarken). */
export const getBookAnnotations = (book: string) => load(book);

const current = (book: string, page: number) => load(book)[page] ?? EMPTY;

export const newId = () => Math.random().toString(36).slice(2, 10);

export function addAnnotation(book: string, page: number, item: Annotation) {
  write(book, page, [...current(book, page), item]);
}

export function updateHighlight(book: string, page: number, id: string, patch: Partial<Highlight>) {
  write(
    book,
    page,
    current(book, page).map((a) => (a.id === id && a.type === "highlight" ? { ...a, ...patch } : a)),
  );
}

/** Nokta (sayfaya oranla) vurgunun bir satırının içindeyse true. */
export function highlightHit(h: Highlight, x: number, y: number) {
  const r = h.rects;
  for (let i = 0; i < r.length; i += 4) {
    if (x >= r[i] && x <= r[i] + r[i + 2] && y >= r[i + 1] && y <= r[i + 1] + r[i + 3]) return true;
  }
  return false;
}

export function updateNote(book: string, page: number, id: string, patch: Partial<Note>) {
  write(
    book,
    page,
    current(book, page).map((a) => (a.id === id && a.type === "text" ? { ...a, ...patch } : a)),
  );
}

export function removeAnnotations(book: string, page: number, ids: string[]) {
  const items = current(book, page);
  const next = items.filter((a) => !ids.includes(a.id));
  if (next.length !== items.length) write(book, page, next);
}

/** Son değişikliği geri alır; geri alınacak bir şey yoksa false. */
export function undo(book: string) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].book !== book) continue;
    const [entry] = history.splice(i, 1);
    write(book, entry.page, entry.items, false);
    return true;
  }
  return false;
}

/** Noktanın (px) çizgiye uzaklığı `radius` px'ten azsa true. */
export function strokeHit(stroke: Stroke, x: number, y: number, w: number, h: number, radius: number) {
  const p = stroke.points;
  const r = radius + (stroke.width * w) / 2;
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i] * w;
    const ay = p[i + 1] * h;
    const bx = (p[i + 2] ?? p[i]) * w;
    const by = (p[i + 3] ?? p[i + 1]) * h;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r) return true;
  }
  return false;
}

/** Noktaları yumuşak bir SVG yoluna çevirir (orta noktalardan geçen eğriler). */
export function strokePath(points: number[], w: number, h: number) {
  const n = points.length / 2;
  if (!n) return "";
  const x = (i: number) => +(points[i * 2] * w).toFixed(1);
  const y = (i: number) => +(points[i * 2 + 1] * h).toFixed(1);
  // Tek nokta: yuvarlak uçlu kısa bir çizgi nokta gibi görünür
  if (n === 1) return `M${x(0)} ${y(0)}l0.01 0`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    d += `Q${x(i)} ${y(i)} ${((x(i) + x(i + 1)) / 2).toFixed(1)} ${((y(i) + y(i + 1)) / 2).toFixed(1)}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}
