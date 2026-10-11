"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState, type RefObject } from "react";
import type { SearchHit } from "@/lib/pdf-search";

export type LeftTab = "contents" | "bookmarks" | "search";

type Search = {
  hits: SearchHit[];
  scanned: number;
  total: number;
  searching: boolean;
  capped: boolean;
};

type Props = {
  tab: LeftTab;
  onTabChange: (tab: LeftTab) => void;
  pdf: PDFDocumentProxy | null;
  currentPage: number;
  onGoTo: (page: number) => void;
  bookmarks: number[];
  onToggleBookmark: (page: number) => void;
  query: string;
  onQueryChange: (query: string) => void;
  search: Search;
  searchInputRef: RefObject<HTMLInputElement | null>;
};

const TABS: [LeftTab, string][] = [
  ["contents", "İçindekiler"],
  ["bookmarks", "Yer imleri"],
  ["search", "Ara"],
];

export default function LeftPanel(props: Props) {
  const { tab, onTabChange } = props;
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-rule bg-sheet">
      <nav className="flex gap-4 border-b border-rule px-5 text-sm">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`-mb-px border-b py-3 transition-colors ${
              tab === id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "contents" && <Contents pdf={props.pdf} onGoTo={props.onGoTo} />}
        {tab === "bookmarks" && <Bookmarks {...props} />}
        {tab === "search" && <SearchTab {...props} />}
      </div>
    </aside>
  );
}

type OutlineEntry = { title: string; depth: number; dest: string | unknown[] | null };

function flatten(items: { title: string; dest: string | unknown[] | null; items: never[] }[], depth = 0): OutlineEntry[] {
  return items.flatMap((it) => [{ title: it.title, depth, dest: it.dest }, ...flatten(it.items, depth + 1)]);
}

async function resolvePage(pdf: PDFDocumentProxy, dest: OutlineEntry["dest"]) {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return null;
  const ref = explicit[0];
  if (typeof ref === "number") return ref + 1;
  return (await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
}

function Contents({ pdf, onGoTo }: { pdf: PDFDocumentProxy | null; onGoTo: (page: number) => void }) {
  const [outline, setOutline] = useState<{ pdf: PDFDocumentProxy; items: OutlineEntry[] } | null>(null);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    pdf.getOutline().then((items) => {
      if (active) setOutline({ pdf, items: flatten((items ?? []) as never) });
    });
    return () => {
      active = false;
    };
  }, [pdf]);

  if (!pdf || outline?.pdf !== pdf) return <Empty>Yükleniyor…</Empty>;
  if (!outline.items.length) return <Empty>Bu PDF&apos;te içindekiler bilgisi yok.</Empty>;

  return (
    <ul className="py-2 text-sm">
      {outline.items.map((item, i) => (
        <li key={i}>
          <button
            onClick={async () => {
              const page = await resolvePage(pdf, item.dest);
              if (page) onGoTo(page);
            }}
            style={{ paddingLeft: 20 + item.depth * 14 }}
            className={`block w-full py-1.5 pr-5 text-left leading-snug hover:bg-ink/5 ${
              item.depth === 0 ? "font-serif text-[15px]" : "text-muted hover:text-ink"
            }`}
          >
            {item.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Bookmarks({ bookmarks, currentPage, onGoTo, onToggleBookmark }: Props) {
  const marked = bookmarks.includes(currentPage);
  return (
    <div className="text-sm">
      <button
        onClick={() => onToggleBookmark(currentPage)}
        className="w-full border-b border-rule px-5 py-3 text-left text-muted hover:text-ink"
      >
        {marked ? "Bu sayfayı yer imlerinden çıkar" : "Bu sayfayı yer imlerine ekle"}
        <span className="ml-1 tabular-nums">(s. {currentPage})</span>
        <span className="ml-2 font-mono text-xs">B</span>
      </button>
      {bookmarks.length === 0 ? (
        <Empty>Henüz yer imi yok.</Empty>
      ) : (
        <ul className="py-2">
          {bookmarks.map((page) => (
            <li key={page} className="group flex items-center hover:bg-ink/5">
              <button onClick={() => onGoTo(page)} className="flex-1 px-5 py-2 text-left">
                <span className="font-serif text-[15px]">Sayfa {page}</span>
                {page === currentPage && <span className="ml-2 text-xs text-muted">buradasın</span>}
              </button>
              <button
                onClick={() => onToggleBookmark(page)}
                className="px-5 text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-accent"
              >
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchTab({ query, onQueryChange, search, currentPage, onGoTo, searchInputRef }: Props) {
  const goToHit = (dir: 1 | -1) => {
    const pages = search.hits.map((h) => h.page);
    if (!pages.length) return;
    const next =
      dir === 1
        ? (pages.find((p) => p > currentPage) ?? pages[0])
        : (pages.findLast((p) => p < currentPage) ?? pages[pages.length - 1]);
    onGoTo(next);
  };

  const pageCount = new Set(search.hits.map((h) => h.page)).size;

  return (
    <div className="text-sm">
      <div className="sticky top-0 border-b border-rule bg-sheet px-5 py-3">
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goToHit(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Belgede ara"
          className="w-full border-b border-rule bg-transparent py-1.5 outline-none placeholder:text-muted focus:border-ink"
        />
        {query.trim().length >= 2 && (
          <p className="mt-2 text-xs text-muted tabular-nums">
            {search.hits.length}
            {search.capped && "+"} sonuç, {pageCount} sayfada
            {search.searching && ` · taranıyor ${search.scanned}/${search.total}`}
          </p>
        )}
      </div>
      <ul className="py-1">
        {search.hits.map((hit, i) => (
          <li key={i}>
            <button
              onClick={() => onGoTo(hit.page)}
              className="block w-full px-5 py-2 text-left hover:bg-ink/5"
            >
              <span className="text-xs tabular-nums text-muted">s. {hit.page}</span>
              <p className="mt-0.5 font-serif leading-snug">
                {hit.snippet.slice(0, hit.start)}
                <mark className="bg-mark text-inherit">
                  {hit.snippet.slice(hit.start, hit.start + hit.length)}
                </mark>
                {hit.snippet.slice(hit.start + hit.length)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-sm text-muted">{children}</p>;
}
