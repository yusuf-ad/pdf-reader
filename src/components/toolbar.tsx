"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { HIGHLIGHT_COLORS, INK_COLORS, type Tool } from "@/lib/annotations";
import type { PaperStyle } from "@/lib/blank-book";
import { getPaperStyles } from "@/lib/paper-styles";
import { openAiSettings, useAiSettings } from "@/lib/ai-settings";
import AiSettingsDialog from "./ai-settings-dialog";
import {
  BookmarkIcon,
  ClosePaneIcon,
  CropIcon,
  EraserIcon,
  ExpandIcon,
  FitPageIcon,
  FitWidthIcon,
  ImageIcon,
  KeyboardIcon,
  KeyIcon,
  MarkerIcon,
  NoteIcon,
  OcrIcon,
  PagePlusIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PenIcon,
  SaveIcon,
  SearchIcon,
  SplitIcon,
  SwapPanesIcon,
  TextIcon,
  UndoIcon,
} from "./icons";

type Props = {
  title: string;
  currentPage: number;
  numPages: number;
  onGoTo: (page: number) => void;
  pageInputRef: RefObject<HTMLInputElement | null>;
  scale: number;
  onZoom: (delta: number) => void;
  onResetZoom: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  /** Açık sayfanın arkasına boş sayfa ekler */
  onInsertPage: (style: PaperStyle) => void;
  inserting: boolean;
  /** Açık sayfaya görsel (ekran görüntüsü) ekler */
  onAddImage: () => void;
  onSearch: () => void;
  onFocusMode: () => void;
  onHelp: () => void;
  onChat: () => void;
  /** Sürüklenebilir not kâğıdı */
  stickyOpen: boolean;
  onToggleSticky: () => void;
  onLibrary: () => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  tool: Tool | null;
  onTool: (tool: Tool | null) => void;
  color: string;
  onColor: (color: string) => void;
  onUndo: () => void;
  /** Soru kırpma modu */
  cropping: boolean;
  onCrop: () => void;
  ocr: boolean;
  onToggleOcr: () => void;
  onSave: (saveAs: boolean) => void;
  saving: boolean;
  /** Az önce kaydedildi (kısa bir onay gösterilir) */
  justSaved: boolean;
  /** Bu kitabın en son kaydedildiği dosyanın adı */
  savedTo: string | null;
  /** Yanına ikinci kitabı aç (bölünmemişken) */
  onSplit?: () => void;
  /** Bu bölmeyi kapat (bölünmüşken) */
  onClosePane?: () => void;
  /** İki bölmenin yerini değiştir (bölünmüşken) */
  onSwapPanes?: () => void;
  /** Başlıktan tutup bölmeyi yana sürükleme (bölünmüşken) */
  onPaneDragStart?: (e: PointerEvent) => void;
};

// Dar bölmede (iki kitap yan yana) az kullanılan düğmeler gizlenir; kısayolları çalışır
const NARROW = "@max-5xl:hidden";
const NARROWER = "@max-3xl:hidden";
const NARROWEST = "@max-2xl:hidden";

const TOOLS = [
  ["pen", "toolbarPen", PenIcon],
  ["marker", "toolbarMarker", MarkerIcon],
  ["text", "toolbarText", TextIcon],
  ["eraser", "toolbarEraser", EraserIcon],
] as const satisfies readonly [Tool, string, () => ReactNode][];

export default function Toolbar(p: Props) {
  const t = useT("library");
  const aiSettings = useAiSettings();
  const progress = p.numPages ? (p.currentPage / p.numPages) * 100 : 0;

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-rule px-3 text-sm">
      <IconButton label={t("toolbarContents")} active={p.leftOpen} onClick={p.onToggleLeft}>
        <PanelLeftIcon />
      </IconButton>

      <span
        onPointerDown={p.onPaneDragStart}
        title={p.onPaneDragStart ? t("toolbarDragPane") : undefined}
        className={`ml-2 min-w-0 flex-1 truncate font-serif text-base ${
          p.onPaneDragStart ? "cursor-grab select-none active:cursor-grabbing" : ""
        }`}
      >
        {p.title}
      </span>

      {p.numPages > 0 && (
        <PageInput
          current={p.currentPage}
          total={p.numPages}
          onGoTo={p.onGoTo}
          inputRef={p.pageInputRef}
        />
      )}

      <Divider />

      <IconButton label={t("toolbarZoomOut")} onClick={() => p.onZoom(-0.1)} className={NARROWER}>
        <span className="text-base leading-none">−</span>
      </IconButton>
      <button
        onClick={p.onResetZoom}
        title={t("toolbarResetZoom")}
        className={`w-12 shrink-0 text-center text-xs tabular-nums text-muted hover:text-ink ${NARROWEST}`}
      >
        {Math.round(p.scale * 100)}%
      </button>
      <IconButton label={t("toolbarZoomIn")} onClick={() => p.onZoom(0.1)} className={NARROWER}>
        <span className="text-base leading-none">+</span>
      </IconButton>
      <IconButton label={t("toolbarFitWidth")} onClick={p.onFitWidth} className={NARROW}>
        <FitWidthIcon />
      </IconButton>
      <IconButton label={t("toolbarFitPage")} onClick={p.onFitPage} className={NARROW}>
        <FitPageIcon />
      </IconButton>

      <Divider className={NARROWEST} />

      {TOOLS.map(([id, label, ToolIcon]) => (
        <IconButton
          key={id}
          label={t("toolbarToolHint", { label: t(label) })}
          active={p.tool === id}
          onClick={() => p.onTool(p.tool === id ? null : id)}
          highlight
        >
          <ToolIcon />
        </IconButton>
      ))}
      {(p.tool === "pen" || p.tool === "marker" || p.tool === "text") && (
        <div className="flex shrink-0 items-center gap-1 px-1" role="radiogroup" aria-label={t("toolbarColor")}>
          {(p.tool === "marker" ? HIGHLIGHT_COLORS.map((h) => h.color) : INK_COLORS).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={p.color === c}
              aria-label={c}
              onClick={() => p.onColor(c)}
              style={{ background: c }}
              className={`h-3.5 w-3.5 rounded-full [filter:var(--page-filter)] ${
                p.color === c ? "ring-1 ring-ink ring-offset-2 ring-offset-paper" : "opacity-70 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      )}
      {p.tool && (
        <IconButton label={t("toolbarUndo")} onClick={p.onUndo}>
          <UndoIcon />
        </IconButton>
      )}

      <Divider />

      <IconButton
        label={t("toolbarCrop")}
        active={p.cropping}
        onClick={p.onCrop}
        highlight
      >
        <CropIcon />
      </IconButton>
      <IconButton label={t("toolbarNotes")} active={p.stickyOpen} onClick={p.onToggleSticky} highlight>
        <NoteIcon />
      </IconButton>
      <IconButton label={t("toolbarBookmark")} active={p.bookmarked} onClick={p.onToggleBookmark} className={NARROWER}>
        <BookmarkIcon filled={p.bookmarked} />
      </IconButton>
      <div className={NARROWEST}>
        <InsertPageMenu page={p.currentPage} busy={p.inserting} onInsert={p.onInsertPage} />
      </div>
      <IconButton label={t("toolbarAddImage")} onClick={p.onAddImage} className={NARROW}>
        <ImageIcon />
      </IconButton>
      <IconButton
        label={
          p.saving
            ? t("toolbarSaving")
            : p.savedTo
              ? t("toolbarSaveTo", { name: p.savedTo })
              : t("toolbarSave")
        }
        onClick={(e) => p.onSave(e.shiftKey)}
        active={p.saving}
      >
        <SaveIcon />
      </IconButton>
      {p.justSaved && <span className="shrink-0 pr-1 text-xs text-muted">{t("toolbarSaved")}</span>}
      <IconButton label={t("toolbarSearch")} onClick={p.onSearch} className={NARROWER}>
        <SearchIcon />
      </IconButton>
      <IconButton
        label={t(p.ocr ? "toolbarOcrOn" : "toolbarOcrOff")}
        active={p.ocr}
        onClick={p.onToggleOcr}
        className={NARROW}
      >
        <OcrIcon />
      </IconButton>
      <IconButton label={t("toolbarFocus")} onClick={p.onFocusMode} className={NARROW}>
        <ExpandIcon />
      </IconButton>
      <IconButton label={t("toolbarShortcuts")} onClick={p.onHelp} className={NARROW}>
        <KeyboardIcon />
      </IconButton>

      <Divider className={NARROWEST} />

      <IconButton
        label={aiSettings?.key ? t("toolbarAiSettings") : t("toolbarAiKey")}
        onClick={openAiSettings}
        className="relative"
      >
        <KeyIcon />
        {!aiSettings?.key && <span aria-hidden className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </IconButton>
      <button
        onClick={p.onChat}
        title={t("toolbarAskSelection")}
        className={`flex shrink-0 items-center gap-1.5 px-2 text-muted hover:text-ink ${NARROWEST}`}
      >
        {t("toolbarAsk")}
        <kbd className={`border border-rule px-1 font-mono text-[11px] ${NARROW}`}>Ctrl K</kbd>
      </button>
      <button
        onClick={p.onLibrary}
        title={t("toolbarLibraryHint")}
        className="flex shrink-0 items-center gap-1.5 px-2 text-muted hover:text-ink"
      >
        {t("toolbarLibrary")}
        <kbd className={`border border-rule px-1 font-mono text-[11px] ${NARROW}`}>L</kbd>
      </button>
      {p.onSplit && (
        <IconButton label={t("toolbarSplit")} onClick={p.onSplit}>
          <SplitIcon />
        </IconButton>
      )}
      {p.onSwapPanes && (
        <IconButton label={t("toolbarSwap")} onClick={p.onSwapPanes}>
          <SwapPanesIcon />
        </IconButton>
      )}
      {p.onClosePane && (
        <IconButton label={t("toolbarClosePane")} onClick={p.onClosePane}>
          <ClosePaneIcon />
        </IconButton>
      )}
      <IconButton label={t("toolbarWordList")} active={p.rightOpen} onClick={p.onToggleRight}>
        <PanelRightIcon />
      </IconButton>

      {/* Okuma ilerlemesi */}
      <div
        className="absolute bottom-[-1px] left-0 h-0.5 bg-accent/70 transition-[width] duration-200"
        style={{ width: `${progress}%` }}
      />
      <AiSettingsDialog />
    </header>
  );
}

function IconButton({
  label,
  active,
  highlight,
  onClick,
  className = "",
  children,
}: {
  label: string;
  active?: boolean;
  /** Etkinken arka planla belirginleştir (seçili araç) */
  highlight?: boolean;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 shrink-0 items-center justify-center transition-colors hover:text-ink ${
        active ? "text-ink" : "text-muted"
      } ${active && highlight ? "bg-ink/8" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function InsertPageMenu({
  page,
  busy,
  onInsert,
}: {
  page: number;
  busy: boolean;
  onInsert: (style: PaperStyle) => void;
}) {
  const t = useT("library");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <IconButton
        label={busy ? t("toolbarPageAdding") : t("toolbarInsertPage")}
        active={open || busy}
        onClick={() => !busy && setOpen((o) => !o)}
      >
        <PagePlusIcon />
      </IconButton>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-44 border border-rule bg-sheet py-1 text-xs shadow-[0_4px_16px_var(--shadow)]">
          <p className="px-3 pt-1 pb-1.5 text-muted">{t("toolbarAfterPage", { page })}</p>
          {getPaperStyles().map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setOpen(false);
                onInsert(id);
              }}
              className="block w-full px-3 py-1.5 text-left text-ink hover:bg-ink/8"
            >
              {t("toolbarPaperPage", { label })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Divider({ className = "" }: { className?: string }) {
  return <span className={`mx-1.5 h-4 w-px shrink-0 bg-rule ${className}`} />;
}

function PageInput({
  current,
  total,
  onGoTo,
  inputRef,
}: {
  current: number;
  total: number;
  onGoTo: (page: number) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT("library");
  // Düzenlenirken taslak değer, aksi halde o anki sayfa gösterilir
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const page = Number(draft);
        if (page) onGoTo(page);
        inputRef.current?.blur();
      }}
      className="flex shrink-0 items-baseline gap-1.5 tabular-nums"
      title={t("toolbarGoToPage")}
    >
      <input
        ref={inputRef}
        value={draft ?? String(current)}
        onFocus={(e) => {
          setDraft(String(current));
          e.target.select();
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        inputMode="numeric"
        aria-label={t("toolbarPageNumber")}
        style={{ width: `${String(total).length + 1.5}ch` }}
        className="border-b border-rule bg-transparent text-center outline-none focus:border-ink"
      />
      <span className="text-muted">/ {total}</span>
    </form>
  );
}
