"use client";

import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fileKey,
  forgetFile,
  listRecentFiles,
  loadFile,
  rememberFile,
  type RecentFile,
} from "@/lib/file-store";
import { usePdfSearch } from "@/lib/pdf-search";
import { loadProgress, saveProgress, toggleBookmark, useBookmarks } from "@/lib/reading-state";
import { extractSelection } from "@/lib/selection";
import { makeTextRenderer } from "@/lib/text-highlight";
import type { Translation } from "@/lib/types";
import { useSavedWords } from "@/lib/use-saved-words";
import EmptyState from "./empty-state";
import LeftPanel, { type LeftTab } from "./left-panel";
import ShortcutsDialog from "./shortcuts-dialog";
import Toolbar from "./toolbar";
import TranslationPopover, { type PopoverState } from "./translation-popover";
import WordList from "./word-list";

// pdf.js tarayıcı API'lerine ihtiyaç duyar, sunucuda render edilmemeli
const PdfViewer = dynamic(() => import("./pdf-viewer"), { ssr: false });

const MAX_PAGE_WIDTH = 820;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const PAGE_TOP_GAP = 16;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +s.toFixed(2)));

export default function Reader() {
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [aspect, setAspect] = useState(1.414); // sayfa yüksekliği / genişliği
  const [rootWidth, setRootWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [recent, setRecent] = useState<RecentFile[]>([]);

  const [leftOpen, setLeftOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("contents");
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [dragging, setDragging] = useState(false);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef(0);
  // Yakınlaştırmada aynı yerde kalmak için: hangi sayfanın neresindeyiz
  const anchorRef = useRef<{ page: number; offset: number } | null>(null);
  // Dosya açılınca kaldığı sayfaya gitmek için
  const pendingPageRef = useRef<number | null>(null);

  const { words, add, remove, clear } = useSavedWords();
  const key = file ? fileKey(file) : null;
  const bookmarks = useBookmarks(key);
  const numPages = pdf?.numPages ?? 0;

  const baseWidth = Math.min(rootWidth, MAX_PAGE_WIDTH);
  const pageWidth = Math.round(baseWidth * scale);
  const pageHeight = Math.round(pageWidth * aspect);

  // --- Dosya açma ---------------------------------------------------------

  const closePopover = useCallback(() => {
    abortRef.current?.abort();
    setPopover(null);
  }, []);

  const refreshRecent = useCallback(() => {
    listRecentFiles().then(setRecent).catch(() => {});
  }, []);

  const openFile = useCallback(
    (f: File | undefined) => {
      if (!f || f.type !== "application/pdf") return;
      closePopover();
      setPdf(null);
      setScale(1);
      setCurrentPage(1);
      anchorRef.current = null;
      pendingPageRef.current = loadProgress(fileKey(f));
      scrollRef.current?.scrollTo({ top: 0 });
      setFile(f);
      rememberFile(f).then(refreshRecent).catch(() => {});
    },
    [closePopover, refreshRecent],
  );

  const openRecent = useCallback(
    async (k: string) => {
      const f = await loadFile(k);
      if (f) openFile(f);
      else refreshRecent();
    },
    [openFile, refreshRecent],
  );

  // Sayfa yenilenince son okunan dosyayı geri aç
  useEffect(() => {
    let active = true;
    listRecentFiles()
      .then((list) => {
        if (!active) return;
        setRecent(list);
        if (list[0]) openRecent(list[0].key);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [openRecent]);

  const handleLoad = useCallback(async (doc: PDFDocumentProxy) => {
    const first = await doc.getPage(1);
    const { width, height } = first.getViewport({ scale: 1 });
    setAspect(height / width);
    setPdf(doc);
  }, []);

  // --- Gezinme -----------------------------------------------------------

  const goTo = useCallback(
    (page: number) => {
      const root = scrollRef.current;
      if (!root || !numPages) return;
      const target = Math.min(numPages, Math.max(1, Math.round(page)));
      const fig = root.querySelector<HTMLElement>(`[data-page-number="${target}"]`);
      if (!fig) return;
      root.scrollTop = fig.offsetTop - PAGE_TOP_GAP;
      setCurrentPage(target);
    },
    [numPages],
  );

  const handleScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const root = scrollRef.current;
      const figs = root?.querySelectorAll<HTMLElement>("figure[data-page-number]");
      if (!root || !figs?.length) return;
      // Ekranın üst üçte birindeki sayfa "şu anki sayfa" sayılır
      const probe = root.scrollTop + root.clientHeight / 3;
      let lo = 0;
      let hi = figs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (figs[mid].offsetTop <= probe) lo = mid;
        else hi = mid - 1;
      }
      const fig = figs[lo];
      setCurrentPage(lo + 1);
      anchorRef.current = {
        page: lo + 1,
        offset: (root.scrollTop - fig.offsetTop) / fig.offsetHeight,
      };
    });
  };

  // Yakınlaştırınca okunan yer kaymasın
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const anchor = anchorRef.current;
    if (!root || !anchor) return;
    const fig = root.querySelector<HTMLElement>(`[data-page-number="${anchor.page}"]`);
    if (fig) root.scrollTop = fig.offsetTop + anchor.offset * fig.offsetHeight;
  }, [pageWidth, pageHeight]);

  // Dosya yüklenince kaldığın sayfaya git
  useEffect(() => {
    const page = pendingPageRef.current;
    if (!pdf || !pageWidth || !page) return;
    pendingPageRef.current = null;
    requestAnimationFrame(() => goTo(page));
  }, [pdf, pageWidth, goTo]);

  // Okunan sayfayı kaydet
  useEffect(() => {
    if (pdf && key) saveProgress(key, currentPage);
  }, [pdf, key, currentPage]);

  // Kaydırma alanının genişliğini ölç
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setRootWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Yakınlaştırma -----------------------------------------------------

  const zoomBy = useCallback((delta: number) => setScale((s) => clampScale(s + delta)), []);

  const fitWidth = useCallback(() => {
    if (baseWidth) setScale(clampScale(rootWidth / baseWidth));
  }, [rootWidth, baseWidth]);

  const fitPage = useCallback(() => {
    const root = scrollRef.current;
    if (!root || !baseWidth) return;
    const available = root.clientHeight - PAGE_TOP_GAP * 2 - 24; // 24: sayfa numarası
    setScale(clampScale(available / aspect / baseWidth));
  }, [baseWidth, aspect]);

  // Ctrl + fare tekerleği
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // --- Paneller, arama, odak modu ----------------------------------------

  const openSearch = useCallback(() => {
    setLeftOpen(true);
    setLeftTab("search");
    requestAnimationFrame(() => searchInputRef.current?.select());
  }, []);

  const toggleFocusMode = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => setFocusMode((f) => !f));
  }, []);

  useEffect(() => {
    const onChange = () => setFocusMode(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const searchActive = leftOpen && leftTab === "search";
  const search = usePdfSearch(pdf, searchActive ? searchQuery : "");

  // Kaydedilen kelimeler ve arama sonuçları sayfada işaretlenir
  const vocabulary = useMemo(
    () =>
      [...new Set(words.map((w) => w.word.toLowerCase()))]
        .filter((w) => w.length >= 2)
        .slice(0, 300),
    [words],
  );
  const highlightQuery = searchActive && searchQuery.trim().length >= 2 ? searchQuery.trim() : "";
  const textRenderer = useMemo(
    () => makeTextRenderer(highlightQuery, vocabulary),
    [highlightQuery, vocabulary],
  );

  // --- Klavye kısayolları ------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "f" && file) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomBy(0.1);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        zoomBy(-0.1);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        setScale(1);
        return;
      }
      if (typing || mod || e.altKey) return;

      if (e.key === "?") {
        setShowHelp((s) => !s);
        return;
      }
      if (!file) return;

      const actions: Record<string, () => void> = {
        ArrowRight: () => goTo(currentPage + 1),
        ArrowLeft: () => goTo(currentPage - 1),
        Home: () => goTo(1),
        End: () => goTo(numPages),
        g: () => pageInputRef.current?.focus(),
        b: () => key && toggleBookmark(key, currentPage),
        f: toggleFocusMode,
        w: fitWidth,
        p: fitPage,
        "[": () => setLeftOpen((o) => !o),
        "]": () => setRightOpen((o) => !o),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, key, currentPage, numPages, goTo, zoomBy, fitWidth, fitPage, openSearch, toggleFocusMode]);

  // --- Kelime seçimi ve çeviri -------------------------------------------

  const handleMouseUp = async (e: React.MouseEvent) => {
    const { clientX: x, clientY: y } = e;
    // Seçimin tamamlanmasını bekle
    await new Promise((r) => setTimeout(r, 0));

    const selection = window.getSelection();
    const picked = selection && extractSelection(selection);
    if (!picked) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPopover({ x, y, word: picked.word, sentence: picked.sentence, status: "loading" });

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: picked.word, sentence: picked.sentence }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Çeviri başarısız.");

      const result = data as Translation;
      setPopover((p) => p && { ...p, status: "done", result });
      add({
        ...result,
        word: picked.word,
        sentence: picked.sentence,
        page: picked.page,
        fileName: file?.name ?? null,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setPopover((p) => p && { ...p, status: "error", error: (err as Error).message });
    }
  };

  // --- Görünüm -----------------------------------------------------------

  const showPanels = !focusMode;

  return (
    <div className="flex h-screen">
      {file && leftOpen && showPanels && (
        <div className="w-72 shrink-0">
          <LeftPanel
            tab={leftTab}
            onTabChange={(tab) => {
              setLeftTab(tab);
              if (tab === "search") requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            pdf={pdf}
            currentPage={currentPage}
            onGoTo={goTo}
            bookmarks={bookmarks}
            onToggleBookmark={(page) => key && toggleBookmark(key, page)}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            search={search}
            searchInputRef={searchInputRef}
          />
        </div>
      )}

      <main
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          openFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {file && showPanels && (
          <Toolbar
            title={file.name.replace(/\.pdf$/i, "")}
            currentPage={currentPage}
            numPages={numPages}
            onGoTo={goTo}
            pageInputRef={pageInputRef}
            scale={scale}
            onZoom={zoomBy}
            onResetZoom={() => setScale(1)}
            onFitWidth={fitWidth}
            onFitPage={fitPage}
            bookmarked={bookmarks.includes(currentPage)}
            onToggleBookmark={() => key && toggleBookmark(key, currentPage)}
            onSearch={openSearch}
            onFocusMode={toggleFocusMode}
            onHelp={() => setShowHelp(true)}
            onOpenFile={() => fileInputRef.current?.click()}
            leftOpen={leftOpen}
            onToggleLeft={() => setLeftOpen((o) => !o)}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((o) => !o)}
          />
        )}

        <div
          ref={scrollRef}
          data-scroll-root
          onScroll={handleScroll}
          onMouseUp={handleMouseUp}
          className="relative flex-1 overflow-auto px-8 py-10"
        >
          {file ? (
            <PdfViewer
              file={file}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              textRenderer={textRenderer}
              onLoad={handleLoad}
            />
          ) : (
            <EmptyState
              recent={recent}
              onOpenPicker={() => fileInputRef.current?.click()}
              onOpenRecent={openRecent}
              onForget={(k) => forgetFile(k).then(refreshRecent)}
            />
          )}
        </div>

        {focusMode && numPages > 0 && (
          <div className="pointer-events-none absolute right-6 bottom-4 bg-sheet/90 px-3 py-1 text-xs tabular-nums text-muted">
            {currentPage} / {numPages}
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center border border-dashed border-ink/40 bg-paper/80 font-serif text-lg">
            Bırak, açalım
          </div>
        )}
      </main>

      {rightOpen && showPanels && (
        <div className="w-[360px] shrink-0">
          <WordList
            words={words}
            onRemove={remove}
            onClear={clear}
            currentFileName={file?.name ?? null}
            onGoTo={goTo}
          />
        </div>
      )}

      {popover && <TranslationPopover state={popover} onClose={closePopover} />}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
