"use client";

import { translate, useT } from "@/lib/i18n";
import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  addBook,
  adoptLegacyData,
  contentKey,
  getBook,
  getSaveHandle,
  listBooks,
  loadFile,
  removeBook,
  replaceBookFile,
  updateBook,
  type Book,
} from "@/lib/file-store";
import {
  addAnnotation,
  getBookAnnotations,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  newId,
  pictureFromBlob,
  shiftHistory,
  undo,
  type Tool,
} from "@/lib/annotations";
import type { PaperStyle } from "@/lib/blank-book";
import type { Reference } from "@/lib/chat";
import { aiHeaders, hasAiKey } from "@/lib/ai-settings";
import { deleteBookOcr, renameBookOcr, setOcrEnabled, useOcrEnabled } from "@/lib/ocr";
import type { MarkInput } from "@/lib/page-marks";
import { getPageText, usePdfSearch } from "@/lib/pdf-search";
import { cropPages, renameBookQuestions, type NewQuestion } from "@/lib/questions";
import { loadProgress, saveProgress, toggleBookmark, useBookmarks } from "@/lib/reading-state";
import { addSelectionNote } from "@/lib/chat-notes";
import { extractSelection, selectedPdfText, selectionHighlights } from "@/lib/selection";
import { deleteBook as deleteBookData, insertBookPage, requestPersistence } from "@/lib/storage";
import { makeTextRenderer } from "@/lib/text-highlight";
import type { SavedWord, Translation } from "@/lib/types";
import { setStickyOpen, useStickyOpen } from "@/lib/sticky-notes";
import { useSavedWords } from "@/lib/use-saved-words";
import { AiMarkerStatus, useAiMarker } from "./ai-marker";
import ChatModal from "./chat-modal";
import type { CropPart } from "./crop-layer";
import LeftPanel, { type LeftTab } from "./left-panel";
import Library from "./library";
import { QuestionDialog } from "./questions";
import ResizablePanel from "./resizable-panel";
import ShortcutsDialog from "./shortcuts-dialog";
import StickyNoteCard from "./sticky-note";
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
const AUTOSAVE_INTERVAL = 10 * 60 * 1000;

type LaunchQueue = {
  setConsumer: (consumer: (params: { files?: FileSystemFileHandle[] }) => void) => void;
};

const RIGHT_PANEL_KEY = "pdf-reader:right-panel";

function rightPanelPreference() {
  try {
    return localStorage.getItem(RIGHT_PANEL_KEY) !== "closed";
  } catch {
    return true;
  }
}

const clampScale =(s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +s.toFixed(2)));

/** Bölünmüş görünümdeki yeri (split-view) */
export type PaneProps = {
  /** İki kitap yan yana mı */
  split: boolean;
  /** Kısayollar ve yapıştırma bu bölmeye mi gidiyor */
  active: boolean;
  /** Soldaki bölme: "Birlikte aç" ile gelen dosya burada açılır */
  primary: boolean;
  /** undefined: son okunan kitap, null: kitaplık, aksi halde bu kitap */
  initialBook?: string | null;
  onBookChange: (key: string | null) => void;
  /** Yanına ikinci bir bölme aç (bölünmemişken) */
  onSplit?: () => void;
  /** Bu bölmeyi kapat (bölünmüşken) */
  onClosePane?: () => void;
  /** İki bölmenin yerini değiştir (bölünmüşken) */
  onSwapPanes?: () => void;
  /** Başlıktan tutup bölmeyi yana sürükleme (bölünmüşken) */
  onPaneDragStart?: (e: ReactPointerEvent) => void;
};

export default function Reader({ pane }: { pane: PaneProps }) {
  const t = useT("reader");
  const [file, setFile] = useState<File | null>(null);
  // Açık kitabın anahtarı (PDF içeriğinden; notlar buna bağlı)
  const [key, setKey] = useState<string | null>(null);
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
  // Kelimeler/notlar paneli; kapatılırsa sonraki açılışta da kapalı kalır.
  // Yan yana açılan bölmede kapalı başlar (yer dar)
  const [rightOpen, setRightOpen] = useState(() => !pane.split && rightPanelPreference());
  // Ekran bölününce yan paneller kapanır (okuma alanı daralmasın); bölme kapanınca
  // kelime paneli tek bölmedeki tercihine döner
  const [wasSplit, setWasSplit] = useState(pane.split);
  if (wasSplit !== pane.split) {
    setWasSplit(pane.split);
    if (pane.split) setLeftOpen(false);
    setRightOpen(!pane.split && rightPanelPreference());
  }
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
  // Soru kırpma modu ve kaydedilmeyi bekleyen soru görüntüsü
  const [cropping, setCropping] = useState(false);
  const [questionDraft, setQuestionDraft] = useState<Omit<NewQuestion, "folderId" | "note"> | null>(null);
  // Sohbete gönderilecek soru görseli
  const [chatImage, setChatImage] = useState<File | null>(null);
  // Son kullanılan vurgu rengi (H kısayolu bununla vurgular)
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].color);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedToState, setSavedTo] = useState<{ book: string; name: string } | null>(null);
  const [inserting, setInserting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  // Son kaydedilen notlar; otomatik kayıt yalnızca bunlar değiştiyse yazar
  const lastSavedRef = useRef<{ book: string; data: unknown } | null>(null);
  const savingRef = useRef(false);
  // Son seçilen metin; Ctrl K ile sohbete referans olarak eklenir
  // fileName verilmezse açık dosya sayılır
  const lastSelectionRef = useRef<
    (Omit<Reference, "fileName" | "pageText"> & { fileName?: string | null }) | null
  >(null);

  const { words, add, remove, clear } = useSavedWords();
  const bookmarks = useBookmarks(key);
  const ocrEnabled = useOcrEnabled(key);
  // Sürüklenebilir not kâğıdı (notlar tüm kitaplarda ortak; açık kaldıysa kitap yeniden açılınca da görünür)
  const stickyOpen = useStickyOpen(key);
  const toggleSticky = useCallback(() => {
    if (key) setStickyOpen(key, !stickyOpen);
  }, [key, stickyOpen]);
  const numPages = pdf?.numPages ?? 0;
  // Başka kitaptan kalan kayıt yeri gösterilmesin
  const savedTo = savedToState?.book === key ? savedToState.name : null;

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
    async (f: File | undefined, knownKey?: string) => {
      if (!f || f.type !== "application/pdf") return;
      const k = knownKey ?? (await contentKey(f));
      await adoptLegacyData(f.name, f.size, k);
      closePopover();
      setLibraryOpen(false);
      setPdf(null);
      setScale(1);
      setCurrentPage(1);
      anchorRef.current = null;
      pendingPageRef.current = loadProgress(k);
      scrollRef.current?.scrollTo({ top: 0 });
      setFile(f);
      setKey(k);
      requestPersistence();
      loadedKeyRef.current = k;
      savingBookRef.current = addBook(f, true, k).then(refreshBooks).catch(() => {});
    },
    [closePopover, refreshBooks],
  );

  const openBook = useCallback(
    async (k: string) => {
      if (k === key) return setLibraryOpen(false);
      const f = await loadFile(k);
      if (f) openFile(f, k);
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

  // Kurulu uygulamada bir PDF "Birlikte aç" ile açıldıysa onu göster
  const launchedRef = useRef(false);
  useEffect(() => {
    if (!pane.primary) return;
    const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer(async ({ files }) => {
      const handle = files?.[0];
      if (!handle) return;
      launchedRef.current = true;
      openFile(await handle.getFile());
    });
  }, [openFile, pane.primary]);

  // Sayfa yenilenince son okunan kitabı (bölünmüş görünümde bu bölmenin kitabını) geri aç
  const [initialBook] = useState(pane.initialBook);
  useEffect(() => {
    let active = true;
    listBooks()
      .then(async (list) => {
        if (!active) return;
        setBooks(list);
        if (initialBook === null) return;
        const last = initialBook ? list.find((b) => b.key === initialBook) : list.find((b) => b.openedAt);
        const f = last && (await loadFile(last.key));
        if (active && f && !launchedRef.current) openFile(f, last.key);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [openFile, initialBook]);

  const reportBook = useEffectEvent((k: string | null) => pane.onBookChange(k));
  useEffect(() => reportBook(key), [key]);

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

  /**
   * Açık sayfanın arkasına boş sayfa ekler. PDF değiştiği için kitabın anahtarı da değişir:
   * notlar, vurgular, yer imleri, OCR, sorular… yeni anahtara taşınır, sonraki sayfalardakiler
   * bir sayfa kayar. Kitap yeni PDF'le yeniden açılır ve eklenen sayfaya gidilir.
   */
  const insertPage = useCallback(
    async (style: PaperStyle) => {
      if (!file || !key || !numPages || inserting) return;
      // Düzenlenen yazı varsa önce eski anahtara kaydedilsin, sonra taşınsın
      (document.activeElement as HTMLElement | null)?.blur();
      setInserting(true);
      const after = currentPage;
      const keepScale = scale;
      try {
        const { insertBlankPage } = await import("@/lib/blank-book");
        const next = await insertBlankPage(file, after, style);
        const k = await contentKey(next);
        const movePage = (p: number) => (p > after ? p + 1 : p);
        await replaceBookFile(key, k, next, numPages + 1);
        insertBookPage(key, k, after);
        shiftHistory(key, k, after);
        await renameBookOcr(key, k, movePage).catch(() => {});
        await renameBookQuestions(key, k, movePage).catch(() => {});
        saveProgress(k, after + 1);
        await openFile(next, k);
        setScale(keepScale);
      } catch (err) {
        alert(translate("reader", "readerInsertFailed", { error: (err as Error).message }));
      } finally {
        setInserting(false);
      }
    },
    [file, key, numPages, inserting, currentPage, scale, openFile],
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

  useEffect(() => {
    // Dar bölmedeki seçim tek bölmeli düzeni bozmasın
    if (pane.split) return;
    try {
      localStorage.setItem(RIGHT_PANEL_KEY, rightOpen ? "open" : "closed");
    } catch {
      // yalnızca bu oturumda geçerli
    }
  }, [rightOpen, pane.split]);

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

  // Orta tuşa basılı tutup sürükleyerek kaydırma (el aracı)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pan: { id: number; x: number; y: number; left: number; top: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      // Tarayıcının kendi otomatik kaydırması devreye girmesin
      e.preventDefault();
      e.stopPropagation();
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      el.scrollLeft = pan.left - (e.clientX - pan.x);
      el.scrollTop = pan.top - (e.clientY - pan.y);
    };
    const onUp = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      pan = null;
      el.style.cursor = "";
    };
    const blockMiddle = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("mousedown", blockMiddle, { capture: true });
    el.addEventListener("auxclick", blockMiddle, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("mousedown", blockMiddle, { capture: true });
      el.removeEventListener("auxclick", blockMiddle, { capture: true });
    };
  }, []);

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
      setChatReference({ ...sel, fileName: sel.fileName !== undefined ? sel.fileName : (file?.name ?? null), pageText });
    }
    setChatOpen(true);
  }, [pdf, file, key, closePopover]);

  /** Soru görselini sohbete ekleyip sohbeti açar. */
  const askImage = useCallback(
    (image: Blob) => {
      closePopover();
      setAskChip(null);
      setQuestionDraft(null);
      setChatImage(new File([image], "soru.png", { type: image.type || "image/png" }));
      setChatOpen(true);
    },
    [closePopover],
  );
  const takeChatImage = useCallback(() => setChatImage(null), []);

  /** Sohbetteki bağlantıdan sayfaya git (sohbet kapanır). */
  const goToFromChat = useCallback(
    (page: number) => {
      setChatOpen(false);
      goTo(page);
    },
    [goTo],
  );

  // Asistan yanlış soruları işaretlerken sohbet küçülür; imleç sayfada görünsün
  const marker = useAiMarker(pdf, key, scrollRef, goTo);
  const runMarker = marker.run;
  const markQuestions = useCallback(
    (id: string, input: MarkInput) => {
      setChatOpen(false);
      runMarker(id, input);
    },
    [runMarker],
  );

  /** Kelime listesindeki kelimeyi, geçtiği cümleyle sohbete ekleyip sohbeti açar. */
  const askWord = useCallback(
    (w: SavedWord) => {
      // Başka bir kitaptan kaydedildiyse o sayfanın metni bu kitaptan okunmasın
      const here = w.fileName === file?.name;
      lastSelectionRef.current = {
        text: w.word,
        sentence: w.sentence || undefined,
        page: here ? w.page : null,
        fileName: w.fileName,
      };
      openChat();
    },
    [file, openChat],
  );

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

  /** Seçili metni alıntı olarak notlara ekler. */
  const noteSelection = useCallback(() => {
    const selection = window.getSelection();
    const picked = selection && selectedPdfText(selection);
    if (!key || !picked) return;
    addSelectionNote(key, selection!.toString() || picked.text, picked.page);
    selection!.removeAllRanges();
    lastSelectionRef.current = null;
    closePopover();
    setAskChip(null);
  }, [key, closePopover]);

  /**
   * Kalem çizgilerini, yazıları ve vurguları PDF'e yazıp kaydeder. İlk kayıtta (ya da farklı
   * kaydette) yer sorulur, sonra hep aynı dosyanın üzerine yazılır.
   */
  const savePdfWithNotes = useCallback(
    async (saveAs = false) => {
      if (!file || !key || saving) return;
      // Düzenlenen yazı varsa önce kaydedilsin
      (document.activeElement as HTMLElement | null)?.blur();
      setSaving(true);
      try {
        const { chooseTarget, discardTarget, writeTarget } = await import("@/lib/save-target");
        const target = await chooseTarget(key, file.name, saveAs);
        if (!target) return;
        const annotations = getBookAnnotations(key);
        try {
          const { exportAnnotatedPdf } = await import("@/lib/export-pdf");
          await writeTarget(key, target, await exportAnnotatedPdf(file, annotations), file.name);
        } catch (err) {
          await discardTarget(target);
          throw err;
        }
        if (target !== "download") setSavedTo({ book: key, name: target.name });
        lastSavedRef.current = { book: key, data: annotations };
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } catch (err) {
        if ((err as Error).name === "NotFoundError") {
          setSavedTo(null);
          alert(translate("reader", "readerSavedFileMissing"));
        } else alert(translate("reader", "readerSaveFailed", { error: (err as Error).message }));
      } finally {
        setSaving(false);
      }
    },
    [file, key, saving],
  );

  // Bu kitabın en son nereye kaydedildiği (düğmenin ipucunda gösterilir)
  useEffect(() => {
    if (!key) return;
    let active = true;
    getSaveHandle(key)
      .then((h) => active && setSavedTo(h ? { book: key, name: h.name } : null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  // Kitap açıldığında var olan notlar kaydedilmiş sayılır; otomatik kayıt yeni değişiklikleri yazar
  useEffect(() => {
    if (key) lastSavedRef.current = { book: key, data: getBookAnnotations(key) };
  }, [key]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  // 10 dakikada bir otomatik kayıt. Yalnızca daha önce kaydedilmiş ve yazma izni bu oturumda
  // verilmiş dosyaya, hiçbir şey sormadan yazar; ilk kayıt yine Ctrl S ile yapılır.
  useEffect(() => {
    if (!file || !key) return;
    const id = setInterval(async () => {
      const annotations = getBookAnnotations(key);
      const last = lastSavedRef.current;
      if (savingRef.current || (last?.book === key && last.data === annotations)) return;
      // Hata buradan dışarı taşmasın: arka planda çalışır, kullanıcıya hata ekranı göstermemeli
      const save = await import("@/lib/save-target").catch(() => null);
      const target = await save?.autoTarget?.(key).catch(() => null);
      if (!save || !target || savingRef.current) return;
      const { writeTarget } = save;
      savingRef.current = true;
      setSaving(true);
      try {
        const { exportAnnotatedPdf } = await import("@/lib/export-pdf");
        await writeTarget(key, target, await exportAnnotatedPdf(file, annotations), file.name);
        lastSavedRef.current = { book: key, data: annotations };
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } catch {
        // Sessizce geç; bir sonraki Ctrl S yer sorar ya da hatayı gösterir
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(id);
  }, [file, key]);

  // --- Yapamadığım sorular ----------------------------------------------

  const startCrop = useCallback(() => {
    setTool(null);
    closePopover();
    setAskChip(null);
    window.getSelection()?.removeAllRanges();
    setCropping((c) => !c);
  }, [closePopover]);

  const handleCrop = useCallback(
    async (parts: CropPart[]) => {
      setCropping(false);
      if (!pdf || !file) return;
      try {
        const { image, sourceWidth } = await cropPages(pdf, parts);
        setQuestionDraft({ image, sourceWidth, book: key, bookName: file.name, page: parts[0].page });
      } catch (err) {
        alert(translate("reader", "readerCropFailed", { error: (err as Error).message }));
      }
    },
    [pdf, file, key],
  );

  /** Dışarıdan gelen görüntü (yapıştırma, sürükleme) soru olarak eklenir. */
  const addQuestionImage = useCallback(
    (image: Blob) => setQuestionDraft({ image, book: key, bookName: file?.name ?? null, page: null }),
    [key, file],
  );

  /** Görseli açık sayfanın ekranda görünen kısmının ortasına yapıştırır. */
  const addPagePicture = useCallback(
    async (image: Blob) => {
      if (!key) return;
      const page = currentPage;
      const frame = scrollRef.current?.querySelector<HTMLElement>(`figure[data-page-number="${page}"] .page-frame`);
      if (!frame) return;
      let picture;
      try {
        picture = await pictureFromBlob(image);
      } catch {
        alert(translate("reader", "readerImageUnreadable"));
        return;
      }
      setTool(null);
      setCropping(false);
      const box = frame.getBoundingClientRect();
      const view = scrollRef.current!.getBoundingClientRect();
      // Ekran görüntüsü ekrandaki boyutunda, en fazla sayfanın %60'ı genişliğinde
      const width = Math.min(picture.width / devicePixelRatio, box.width * 0.6);
      const height = (width * picture.height) / picture.width;
      const visibleTop = Math.max(box.top, view.top);
      const visibleBottom = Math.min(box.bottom, view.bottom);
      const top = Math.max(visibleTop + 16, (visibleTop + visibleBottom - height) / 2) - box.top;
      addAnnotation(key, page, {
        id: newId(),
        type: "image",
        src: picture.src,
        x: (box.width - width) / 2 / box.width,
        y: Math.min(Math.max(0, top), box.height - height) / box.height,
        width: width / box.width,
        height: height / box.height,
      });
    },
    [key, currentPage],
  );

  // Ctrl V: panodaki ekran görüntüsü (bölünmüş görünümde etkin bölmeye)
  useEffect(() => {
    if (!pane.active) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (chatOpen || libraryOpen || questionDraft) return;
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!image) return;
      e.preventDefault();
      addQuestionImage(image);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pane.active, chatOpen, libraryOpen, questionDraft, addQuestionImage]);

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

  // Bölünmüş görünümde yalnızca etkin bölme dinler
  useEffect(() => {
    if (!pane.active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Kırpılan soru penceresi açıkken: soruyu sohbete sor
        if (questionDraft) askImage(questionDraft.image);
        else if (chatOpen) setChatOpen(false);
        else openChat();
        return;
      }
      // Sohbet / soru penceresi açıkken arkadaki okuyucu kısayolları çalışmasın
      if (chatOpen || questionDraft) return;

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

      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        savePdfWithNotes(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === "f" && file) {
        e.preventDefault();
        // Arama paneli zaten açıksa kapat
        if (leftOpen && leftTab === "search") setLeftOpen(false);
        else openSearch();
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
        setCropping(false);
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
        q: startCrop,
        d: () => setTool((t) => (t === "pen" ? null : "pen")),
        m: () => setTool((t) => (t === "marker" ? null : "marker")),
        t: () => setTool((t) => (t === "text" ? null : "text")),
        e: () => setTool((t) => (t === "eraser" ? null : "eraser")),
        h: () => highlightSelection(highlightColor),
        n: toggleSticky,
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
    pane.active,
    file,
    key,
    currentPage,
    numPages,
    chatOpen,
    questionDraft,
    libraryOpen,
    leftOpen,
    leftTab,
    goTo,
    zoomBy,
    fitWidth,
    fitPage,
    openSearch,
    openChat,
    toggleFocusMode,
    toggleSticky,
    highlightSelection,
    highlightColor,
    savePdfWithNotes,
    startCrop,
    askImage,
  ]);

  // --- Kelime seçimi ve çeviri -------------------------------------------

  const handleMouseUp = async (e: React.MouseEvent) => {
    // Çizerken / yazarken / kırparken çeviri açılmasın
    if (tool || cropping) return;
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
      if (!hasAiKey()) throw new Error("missing_api_key");
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiHeaders() },
        body: JSON.stringify({ word: picked.word, sentence: picked.sentence }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? translate("reader", "readerTranslationFailed"));

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
    <div className="reader relative flex h-full min-w-0">
      {file && leftOpen && showPanels && (
        <div className="reader-side-panel h-full shrink-0">
          <ResizablePanel id="left" edge="right" defaultWidth={320} minWidth={240}>
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
              onStartCrop={startCrop}
              onOpenFile={openFile}
              onAskImage={askImage}
            />
          </ResizablePanel>
        </div>
      )}

      <main
        ref={mainRef}
        // @container: araç çubuğu dar bölmede az kullanılan düğmeleri gizler
        className="@container relative flex min-h-0 min-w-0 flex-1 flex-col"
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
          // Görüntü bırakılırsa yapamadığım soru olarak eklenir
          const image = files.find((f) => f.type.startsWith("image/"));
          if (image && file) return addQuestionImage(image);
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
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const image = e.target.files?.[0];
            if (image) addPagePicture(image);
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
            onInsertPage={insertPage}
            inserting={inserting}
            onAddImage={() => imageInputRef.current?.click()}
            onSplit={pane.onSplit}
            onClosePane={pane.onClosePane}
            onSwapPanes={pane.onSwapPanes}
            onPaneDragStart={pane.onPaneDragStart}
            onSearch={openSearch}
            onFocusMode={toggleFocusMode}
            onHelp={() => setShowHelp(true)}
            onChat={openChat}
            stickyOpen={stickyOpen}
            onToggleSticky={toggleSticky}
            onLibrary={() => setLibraryOpen(true)}
            leftOpen={leftOpen}
            onToggleLeft={() => setLeftOpen((o) => !o)}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((o) => !o)}
            tool={tool}
            onTool={(t) => {
              setTool(t);
              setCropping(false);
              closePopover();
              setAskChip(null);
            }}
            // Fosforlu kalem vurgu renklerini kullanır (metin vurgusuyla aynı son renk)
            color={tool === "marker" ? highlightColor : inkColor}
            onColor={tool === "marker" ? setHighlightColor : setInkColor}
            onUndo={() => key && undo(key)}
            cropping={cropping}
            onCrop={startCrop}
            ocr={ocrEnabled}
            onToggleOcr={() => key && setOcrEnabled(key, !ocrEnabled)}
            onSave={savePdfWithNotes}
            saving={saving}
            justSaved={justSaved}
            savedTo={savedTo}
          />
        )}

        <div
          ref={scrollRef}
          data-scroll-root
          onScroll={handleScroll}
          onMouseUp={handleMouseUp}
          className="reader-pages relative min-h-0 flex-1 overflow-auto px-8 py-10"
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
              color={tool === "marker" ? highlightColor : inkColor}
              ocr={ocrEnabled}
              onAskHighlight={askAbout}
              onCrop={cropping ? handleCrop : undefined}
            />
          )}
        </div>

        {file && key && stickyOpen && (
          <StickyNoteCard
            book={key}
            bookTitle={file.name.replace(/\.pdf$/i, "")}
            currentPage={currentPage}
            onGoTo={goTo}
            boundsRef={mainRef}
            onClose={toggleSticky}
          />
        )}

        {cropping && (
          <div className="pointer-events-none absolute top-16 left-1/2 z-20 -translate-x-1/2 border border-rule bg-sheet px-3 py-1.5 text-xs shadow-[0_4px_16px_var(--shadow)]">
            {t("readerCropInstruction")}<span className="font-mono">{t("readerEscapeKey")}</span>{t("readerCropCancel")}
          </div>
        )}

        {focusMode && numPages > 0 && (
          <div className="pointer-events-none absolute right-6 bottom-4 bg-sheet/90 px-3 py-1 text-xs tabular-nums text-muted">
            {currentPage} / {numPages}
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center border border-dashed border-ink/40 bg-paper/80 font-serif text-lg">
            {t("readerDropToOpen")}
          </div>
        )}
      </main>

      {rightOpen && showPanels && (
        <div className="reader-side-panel h-full shrink-0">
          <ResizablePanel id="words" edge="left" defaultWidth={360} minWidth={280}>
            <WordList
              words={words}
              onRemove={remove}
              onAsk={askWord}
              onClear={clear}
              currentFileName={file?.name ?? null}
              onGoTo={goTo}
              book={key}
              currentPage={currentPage}
              onClose={() => setRightOpen(false)}
            />
          </ResizablePanel>
        </div>
      )}

      {(!file || libraryOpen) && (
        <div
          // Bölmenin içinde: yandaki kitap görünür kalsın
          className="reader-library absolute inset-0 z-30 overflow-y-auto bg-paper"
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
              deleteBookData(k);
              deleteBookOcr(k);
              if (k === key) {
                setFile(null);
                setKey(null);
                setPdf(null);
              }
              refreshBooks();
            }}
            onAdd={() => fileInputRef.current?.click()}
            onCreateBlank={async (title, pages, style) => {
              const { blankBookPdf } = await import("@/lib/blank-book");
              await openFile(await blankBookPdf(title, pages, style));
            }}
            onClose={file ? () => setLibraryOpen(false) : pane.onClosePane}
            closeLabel={file ? undefined : t("readerClosePane")}
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
            {t("readerAskSelection")}
            <kbd className="font-mono text-[11px] text-muted">{t("readerAskShortcut")}</kbd>
          </button>
          <span className="h-5 w-px bg-rule" />
          <button onClick={noteSelection} className="px-3 py-1.5 hover:text-ink">
            {t("readerAddToNote")}
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
        fileName={file?.name ?? null}
        pdf={pdf}
        book={key}
        currentPage={currentPage}
        pendingImage={chatImage}
        onImageTaken={takeChatImage}
        onGoTo={goToFromChat}
        onMarkQuestions={markQuestions}
      />
      <AiMarkerStatus
        status={marker.status}
        book={key}
        onStop={marker.stop}
        onDismiss={marker.dismiss}
      />
      {questionDraft && (
        <QuestionDialog
          draft={questionDraft}
          onAsk={() => askImage(questionDraft.image)}
          onAddToPdf={
            file
              ? () => {
                  addPagePicture(questionDraft.image);
                  setQuestionDraft(null);
                }
              : undefined
          }
          onClose={() => setQuestionDraft(null)}
          onSaved={() => {
            setQuestionDraft(null);
            setLeftOpen(true);
            setLeftTab("questions");
          }}
        />
      )}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
