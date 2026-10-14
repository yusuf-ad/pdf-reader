"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState, type RefObject } from "react";
import { removeAnnotations, useBookAnnotations, type Highlight } from "@/lib/annotations";
import { generateToc, useGeneratedToc } from "@/lib/generated-toc";
import { getPageText } from "@/lib/pdf-search";
import type { SearchHit } from "@/lib/pdf-search";
import { QuestionsTab } from "./questions";

export type LeftTab = "contents" | "bookmarks" | "highlights" | "questions" | "search";

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
  book: string | null;
  /** Vurgulanan metni sohbete sor */
  onAsk: (text: string, page: number) => void;
  /** Sayfadan soru kırpmayı başlat */
  onStartCrop: () => void;
  /** Soru klasöründen oluşturulan PDF'i aç */
  onOpenFile: (file: File) => void;
  /** Soru görselini sohbete sor */
  onAskImage: (image: Blob) => void;
};

const TABS: [LeftTab, string][] = [
  ["contents", "İçindekiler"],
  ["bookmarks", "Yer imleri"],
  ["highlights", "Vurgular"],
  ["questions", "Sorular"],
  ["search", "Ara"],
];

export default function LeftPanel(props: Props) {
  const { tab, onTabChange } = props;
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-rule bg-sheet">
      {/* Dar panelde sekmeler kaydırma çubuğu yerine alt satıra geçer */}
      <nav className="flex flex-wrap gap-x-2.5 border-b border-rule px-3 text-[13px] whitespace-nowrap">
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
        {tab === "contents" && <Contents pdf={props.pdf} book={props.book} onGoTo={props.onGoTo} />}
        {tab === "bookmarks" && <Bookmarks {...props} />}
        {tab === "highlights" && <Highlights {...props} />}
        {tab === "questions" && (
          <QuestionsTab
            book={props.book}
            onGoTo={props.onGoTo}
            onStartCrop={props.onStartCrop}
            onOpenFile={props.onOpenFile}
            onAskImage={props.onAskImage}
          />
        )}
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

function Contents({
  pdf,
  book,
  onGoTo,
}: {
  pdf: PDFDocumentProxy | null;
  book: string | null;
  onGoTo: (page: number) => void;
}) {
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
  if (!outline.items.length) return <GeneratedContents pdf={pdf} book={book} onGoTo={onGoTo} />;

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

/**
 * PDF'te gömülü içindekiler yoksa: basılı içindekiler sayfası yapay zekayla okunur.
 * İstek yalnızca düğmeye basınca gider; sonuç kitap başına saklanır.
 */
function GeneratedContents({
  pdf,
  book,
  onGoTo,
}: {
  pdf: PDFDocumentProxy;
  book: string | null;
  onGoTo: (page: number) => void;
}) {
  const items = useGeneratedToc(book);
  const [state, setState] = useState<{ status: "idle" | "loading" | "missing" | "error"; error?: string }>({
    status: "idle",
  });

  const generate = async () => {
    if (!book) return;
    setState({ status: "loading" });
    try {
      const result = await generateToc(pdf, book, (p) => getPageText(pdf, p, book));
      setState({ status: result ? "idle" : "missing" });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const loading = state.status === "loading";

  if (items && !loading) {
    return (
      <div className="text-sm">
        <ul className="py-2">
          {items.map((item, i) => (
            <li key={i}>
              <button
                onClick={() => item.page && onGoTo(item.page)}
                disabled={!item.page}
                style={{ paddingLeft: 20 + item.depth * 14 }}
                className={`flex w-full gap-2 py-1.5 pr-5 text-left leading-snug hover:bg-ink/5 disabled:hover:bg-transparent ${
                  item.depth === 0 ? "font-serif text-[15px]" : "text-muted hover:text-ink"
                }`}
              >
                <span className="flex-1">{item.title}</span>
                {item.page && <span className="text-xs tabular-nums text-muted">{item.page}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-muted">
          Kitabın basılı içindekiler sayfasından otomatik çıkarıldı; sayfalar birkaç sayfa kayabilir.{" "}
          <button onClick={generate} className="underline underline-offset-2 hover:text-ink">
            Yeniden oluştur
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 text-sm text-muted">
      <p>Bu PDF&apos;te içindekiler bilgisi yok.</p>
      <p className="mt-2 text-xs leading-relaxed">
        Kitabın basılı içindekiler sayfası varsa yapay zekayla okunup buraya tıklanabilir liste olarak
        eklenebilir. Kitap başına bir kez yapılır.
      </p>
      <button
        onClick={generate}
        disabled={loading || !book}
        className="mt-4 border border-rule px-3 py-1.5 text-ink transition-colors hover:border-ink disabled:animate-pulse disabled:hover:border-rule"
      >
        {loading ? "İçindekiler çıkarılıyor…" : "İçindekileri oluştur"}
      </button>
      {state.status === "missing" && (
        <p className="mt-3 text-xs text-accent">
          İlk sayfalarda basılı bir içindekiler listesi bulunamadı.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-xs text-accent">{state.error}</p>}
    </div>
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

function Highlights({ book, currentPage, onGoTo, onAsk }: Props) {
  const all = useBookAnnotations(book);
  const items = Object.entries(all)
    .flatMap(([page, list]) =>
      list.filter((a): a is Highlight => a.type === "highlight").map((hl) => ({ ...hl, page: +page })),
    )
    .sort((a, b) => a.page - b.page || a.rects[1] - b.rects[1]);

  if (!book || !items.length) {
    return (
      <Empty>
        Henüz vurgu yok. Metni seç, <span className="font-mono text-xs">H</span> tuşuna bas ya da
        çıkan renklerden birine tıkla.
      </Empty>
    );
  }
  return (
    <ul className="py-2">
      {items.map((hl) => (
        <li key={hl.id} className="group relative hover:bg-ink/5">
          <button onClick={() => onGoTo(hl.page)} className="block w-full px-5 py-2 text-left">
            <span className="text-xs tabular-nums text-muted">
              s. {hl.page}
              {hl.page === currentPage && " · buradasın"}
            </span>
            <p
              className="mt-0.5 line-clamp-4 border-l-[3px] pl-2 font-serif text-[15px] leading-snug"
              style={{ borderColor: hl.color }}
            >
              {hl.text}
            </p>
          </button>
          <div className="absolute top-2 right-4 flex gap-3 text-xs text-muted opacity-0 group-hover:opacity-100">
            <button onClick={() => onAsk(hl.text, hl.page)} className="hover:text-ink">
              Sor
            </button>
            <button onClick={() => removeAnnotations(book, hl.page, [hl.id])} className="hover:text-accent">
              Sil
            </button>
          </div>
        </li>
      ))}
    </ul>
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
