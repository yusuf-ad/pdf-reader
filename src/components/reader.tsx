"use client";

import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fileKey,
  addBook,
  getBook,
  listBooks,
  loadFile,
  removeBook,
  requestPersistence,
  updateBook,
  type Book,
} from "@/lib/file-store";
import {
  addAnnotation,
  deleteBookAnnotations,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  newId,
  undo,
  type Tool,
} from "@/lib/annotations";
import type { Reference } from "@/lib/chat";
import { deleteGeneratedToc } from "@/lib/generated-toc";
import { deleteBookOcr, setOcrEnabled, useOcrEnabled } from "@/lib/ocr";
import { getPageText, usePdfSearch } from "@/lib/pdf-search";
import { loadProgress, saveProgress, toggleBookmark, useBookmarks } from "@/lib/reading-state";
import { extractSelection, selectedPdfText, selectionHighlights } from "@/lib/selection";
import { makeTextRenderer } from "@/lib/text-highlight";
import type { Translation } from "@/lib/types";
import { useSavedWords } from "@/lib/use-saved-words";
import ChatModal from "./chat-modal";
import LeftPanel, { type LeftTab } from "./left-panel";
import Library from "./library";
import ResizablePanel from "./resizable-panel";
import ShortcutsDialog from "./shortcuts-dialog";
import Toolbar from "./toolbar";
import HighlightSwatches from "./highlight-swatches";
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
  const [books, setBooks] = useState<Book[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [adding, setAdding] = useState(0);

  const [leftOpen, setLeftOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("contents");
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [dragging, setDragging] = useState(false);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatReference, setChatReference] = useState<Reference | null>(null);
  // Uzun seçimlerde (paragraf) çeviri yerine çıkan "Sor" düğmesinin konumu
  const [askChip, setAskChip] = useState<{ x: number; y: number } | null>(null);
  // Not alma aracı (kalem, yazı, silgi); null iken normal okuma/seçim
  const [tool, setTool] = useState<Tool | null>(null);
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[1]);
  // Son kullanılan vurgu rengi (H kısayolu bununla vurgular)
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].color);

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
  // Açılan kitabın kitaplığa yazılması (kapak üretmeden önce beklenir)
  const savingBookRef = useRef<Promise<unknown>>(Promise.resolve());
  const loadedKeyRef = useRef<string | null>(null);
  // Son seçilen metin; Ctrl K ile sohbete referans olarak eklenir
  const lastSelectionRef = useRef<Omit<Reference, "fileName" | "pageText"> | null>(null);

  const { words, add, remove, clear } = useSavedWords();
  const key = file ? fileKey(file) : null;
  const bookmarks = useBookmarks(key);
  const ocrEnabled = useOcrEnabled(key);
  const numPages = pdf?.numPages ?? 0;

  const baseWidth = Math.min(rootWidth, MAX_PAGE_WIDTH);
  const pageWidth = Math.round(baseWidth * scale);
  const pageHeight = Math.round(pageWidth * aspect);

  // --- Dosya açma ---------------------------------------------------------

  const closePopover = useCallback(() => {
    abortRef.current?.abort();
    setPopover(null);
  }, []);

  const refreshBooks = useCallback(() => {
    listBooks().then(setBooks).catch(() => {});
  }, []);

  const openFile = useCallback(
    (f: File | undefined) => {
      if (!f || f.type !== "application/pdf") return;
      closePopover();
      setLibraryOpen(false);
      setPdf(null);
      setScale(1);
      setCurrentPage(1);
      anchorRef.current = null;
      pendingPageRef.current = loadProgress(fileKey(f));
      scrollRef.current?.scrollTo({ top: 0 });
      setFile(f);
      requestPersistence();
      loadedKeyRef.current = fileKey(f);
      savingBookRef.current = addBook(f, true).then(refreshBooks).catch(() => {});
    },
    [closePopover, refreshBooks],
  );

  const openBook = useCallback(
    async (k: string) => {
      if (k === key) return setLibraryOpen(false);
      const f = await loadFile(k);
      if (f) openFile(f);
      else refreshBooks();
    },
    [key, openFile, refreshBooks],
  );

  /** Dosyaları kitaplığa ekler; kapak ve sayfa sayısını hazırlar. */
  const addFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      if (!pdfs.length) return;
      requestPersistence();
      setAdding((n) => n + pdfs.length);
      const { describePdf } = await import("@/lib/pdfjs");
      for (const f of pdfs) {
        try {
          const { key: k, hasCover } = await addBook(f);
          refreshBooks();
          if (!hasCover) await updateBook(k, await describePdf(f));
        } catch {
          // bozuk/şifreli PDF: kapaksız kalır
        } finally {
          setAdding((n) => n - 1);
          refreshBooks();
        }
      }
    },
    [refreshBooks],
  );

  // Sayfa yenilenince son okunan kitabı geri aç
  useEffect(() => {
    let active = true;
    listBooks()
      .then(async (list) => {
        if (!active) return;
        setBooks(list);
        const last = list.find((b) => b.openedAt);
        const f = last && (await loadFile(last.key));
        if (active && f) openFile(f);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [openFile]);

  const handleLoad = useCallback(
    async (doc: PDFDocumentProxy) => {
      const first = await doc.getPage(1);
      const { width, height } = first.getViewport({ scale: 1 });
      setAspect(height / width);
      setPdf(doc);

      // Kitaplık kartı için kapak ve sayfa sayısı (ilk açılışta bir kez)
      await savingBookRef.current;
      const k = loadedKeyRef.current;
      const book = k && (await getBook(k));
      if (book && (!book.cover || !book.numPages)) {
        const { renderCover } = await import("@/lib/pdfjs");
        await updateBook(book.key, { numPages: doc.numPages, cover: await renderCover(doc) });
        refreshBooks();
      }
    },
    [refreshBooks],
  );

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
    requestAnimationFrame(() => {
      goTo(page);
      pendingPageRef.current = null;
    });
  }, [pdf, pageWidth, goTo]);

  // Okunan sayfayı localStorage'a kaydet. Kaldığın sayfaya dönülmeden önce
  // (henüz 1. sayfadayken) yazıp kayıtlı sayfayı ezmesin.
  useEffect(() => {
    if (pdf && key && pendingPageRef.current === null) saveProgress(key, currentPage);
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

  const openChat = useCallback(async () => {
    const sel = lastSelectionRef.current;
    closePopover();
    setAskChip(null);
    if (sel) {
      lastSelectionRef.current = null;
      window.getSelection()?.removeAllRanges();
      const pageText =
        pdf && sel.page ? (await getPageText(pdf, sel.page, key)).slice(0, 6000) : undefined;
      setChatReference({ ...sel, fileName: file?.name ?? null, pageText });
    }
    setChatOpen(true);
  }, [pdf, file, key, closePopover]);

  /** Vurgulanan metni sohbete referans olarak ekleyip sohbeti açar. */
  const askAbout = useCallback(
    (text: string, page: number) => {
      lastSelectionRef.current = { text, page };
      openChat();
    },
    [openChat],
  );

  /** Seçili metni vurgular; seçim yoksa false. */
  const highlightSelection = useCallback(
    (color: string) => {
      const selection = window.getSelection();
      if (!key || !selection) return false;
      const pieces = selectionHighlights(selection);
      if (!pieces.length) return false;
      const createdAt = Date.now();
      for (const { page, rects, text } of pieces) {
        addAnnotation(key, page, { id: newId(), type: "highlight", color, rects, text, createdAt });
      }
      selection.removeAllRanges();
      lastSelectionRef.current = null;
      closePopover();
      setAskChip(null);
      setHighlightColor(color);
      return true;
    },
    [key, closePopover],
  );

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
  const search = usePdfSearch(pdf, searchActive ? searchQuery : "", key);

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

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (chatOpen) setChatOpen(false);
        else openChat();
        return;
      }
      // Sohbet açıkken arkadaki okuyucu kısayolları çalışmasın
      if (chatOpen) return;

      if (!typing && !mod && file && (e.key.toLowerCase() === "l" || (libraryOpen && e.key === "Escape"))) {
        e.preventDefault();
        setLibraryOpen((o) => !o);
        return;
      }
      // Kitaplık açıkken okuyucu kısayolları çalışmasın
      if (libraryOpen || !file) {
        if (e.key === "?" && !typing) setShowHelp((s) => !s);
        return;
      }

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
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && !typing && key) {
        e.preventDefault();
        undo(key);
        return;
      }
      if (e.key === "Escape" && !typing) {
        setAskChip(null);
        setTool(null);
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
        d: () => setTool((t) => (t === "pen" ? null : "pen")),
        t: () => setTool((t) => (t === "text" ? null : "text")),
        e: () => setTool((t) => (t === "eraser" ? null : "eraser")),
        h: () => highlightSelection(highlightColor),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    file,
    key,
    currentPage,
    numPages,
    chatOpen,
    libraryOpen,
    goTo,
    zoomBy,
    fitWidth,
    fitPage,
    openSearch,
    openChat,
    toggleFocusMode,
    highlightSelection,
    highlightColor,
  ]);

  // --- Kelime seçimi ve çeviri -------------------------------------------

  const handleMouseUp = async (e: React.MouseEvent) => {
    // Çizerken / yazarken çeviri açılmasın
    if (tool) return;
    const { clientX: x, clientY: y } = e;
    // Seçimin tamamlanmasını bekle
    await new Promise((r) => setTimeout(r, 0));

    const selection = window.getSelection();
    if (!selection) return;
    const picked = extractSelection(selection); // kısa seçimi tam kelimeye genişletir
    const selected = selectedPdfText(selection);
    setAskChip(null);
    if (!selected) {
      lastSelectionRef.current = null;
      return;
    }
    lastSelectionRef.current = picked
      ? { text: picked.word, sentence: picked.sentence, page: picked.page }
      : selected;
    if (!picked) {
      // Paragraf gibi uzun seçimler çevrilmez; sohbete sorulabilir
      closePopover();
      setAskChip({ x, y });
      return;
    }

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
            book={key}
            onAsk={askAbout}
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
          const files = [...e.dataTransfer.files];
          // Okurken tek dosya bırakılırsa aç; birden fazlası kitaplığa eklenir
          if (files.length === 1) openFile(files[0]);
          else addFiles(files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            // Kitaplıktan eklenenler yalnızca eklenir; kitaplık boşsa tek dosya doğrudan açılır
            if (files.length === 1 && (!libraryOpen && (file || books.length === 0))) openFile(files[0]);
            else addFiles(files);
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
            onChat={openChat}
            onLibrary={() => setLibraryOpen(true)}
            leftOpen={leftOpen}
            onToggleLeft={() => setLeftOpen((o) => !o)}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((o) => !o)}
            tool={tool}
            onTool={(t) => {
              setTool(t);
              closePopover();
              setAskChip(null);
            }}
            color={inkColor}
            onColor={setInkColor}
            onUndo={() => key && undo(key)}
            ocr={ocrEnabled}
            onToggleOcr={() => key && setOcrEnabled(key, !ocrEnabled)}
          />
        )}

        <div
          ref={scrollRef}
          data-scroll-root
          onScroll={handleScroll}
          onMouseUp={handleMouseUp}
          className="relative flex-1 overflow-auto px-8 py-10"
        >
          {file && (
            <PdfViewer
              file={file}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              textRenderer={textRenderer}
              onLoad={handleLoad}
              onGoTo={goTo}
              bookKey={key!}
              tool={tool}
              color={inkColor}
              ocr={ocrEnabled}
              onAskHighlight={askAbout}
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
        <ResizablePanel id="words" edge="left" defaultWidth={360} minWidth={280}>
          <WordList
            words={words}
            onRemove={remove}
            onClear={clear}
            currentFileName={file?.name ?? null}
            onGoTo={goTo}
          />
        </ResizablePanel>
      )}

      {(!file || libraryOpen) && (
        <div
          className="fixed inset-0 z-30 overflow-y-auto bg-paper"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = [...e.dataTransfer.files];
            if (books.length === 0 && files.length === 1) openFile(files[0]);
            else addFiles(files);
          }}
        >
          <Library
            books={books}
            currentKey={key}
            adding={adding}
            onOpen={openBook}
            onRemove={async (k) => {
              await removeBook(k);
              deleteBookAnnotations(k);
              deleteBookOcr(k);
              deleteGeneratedToc(k);
              if (k === key) {
                setFile(null);
                setPdf(null);
              }
              refreshBooks();
            }}
            onAdd={() => fileInputRef.current?.click()}
            onClose={file ? () => setLibraryOpen(false) : undefined}
          />
        </div>
      )}
      {popover && (
        <TranslationPopover
          state={popover}
          onClose={closePopover}
          onAsk={openChat}
          highlightColor={highlightColor}
          onHighlight={highlightSelection}
        />
      )}
      {askChip && (
        <div
          // Tıklayınca seçim kaybolmasın
          onMouseDown={(e) => e.preventDefault()}
          style={{ left: askChip.x + 8, top: askChip.y + 14 }}
          className="fixed z-30 flex items-center border border-rule bg-sheet text-sm shadow-[0_4px_16px_var(--shadow)]"
        >
          <button onClick={openChat} className="flex items-center gap-2 px-3 py-1.5 hover:text-ink">
            Bu bölümü sor
            <kbd className="font-mono text-[11px] text-muted">Ctrl K</kbd>
          </button>
          <span className="h-5 w-px bg-rule" />
          <HighlightSwatches current={highlightColor} onPick={highlightSelection} />
        </div>
      )}
      <ChatModal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        reference={chatReference}
        onClearReference={() => setChatReference(null)}
        chatId={key ?? "genel"}
        title={file?.name.replace(/\.pdf$/i, "") ?? null}
        pdf={pdf}
        book={key}
        currentPage={currentPage}
      />
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
