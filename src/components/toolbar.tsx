"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { HIGHLIGHT_COLORS, INK_COLORS, type Tool } from "@/lib/annotations";
import type { PaperStyle } from "@/lib/blank-book";
import { PAPER_STYLES } from "@/lib/paper-styles";
import {
  BookmarkIcon,
  CropIcon,
  EraserIcon,
  ExpandIcon,
  FitPageIcon,
  FitWidthIcon,
  KeyboardIcon,
  MarkerIcon,
  OcrIcon,
  PagePlusIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PenIcon,
  SaveIcon,
  SearchIcon,
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
  onSearch: () => void;
  onFocusMode: () => void;
  onHelp: () => void;
  onChat: () => void;
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
};

const TOOLS: [Tool, string, () => ReactNode][] = [
  ["pen", "Kalem  D", PenIcon],
  ["marker", "Fosforlu kalem  M  (Shift: düz çizgi)", MarkerIcon],
  ["text", "Yazı ekle  T", TextIcon],
  ["eraser", "Silgi  E  (ya da sağ tık basılı)", EraserIcon],
];

export default function Toolbar(p: Props) {
  const progress = p.numPages ? (p.currentPage / p.numPages) * 100 : 0;

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-rule px-3 text-sm">
      <IconButton label="İçindekiler, yer imleri, arama  [" active={p.leftOpen} onClick={p.onToggleLeft}>
        <PanelLeftIcon />
      </IconButton>

      <span className="ml-2 min-w-0 flex-1 truncate font-serif text-base">{p.title}</span>

      {p.numPages > 0 && (
        <PageInput
          current={p.currentPage}
          total={p.numPages}
          onGoTo={p.onGoTo}
          inputRef={p.pageInputRef}
        />
      )}

      <Divider />

      <IconButton label="Uzaklaştır  Ctrl −" onClick={() => p.onZoom(-0.1)}>
        <span className="text-base leading-none">−</span>
      </IconButton>
      <button
        onClick={p.onResetZoom}
        title="Yakınlaştırmayı sıfırla  Ctrl 0"
        className="w-12 text-center text-xs tabular-nums text-muted hover:text-ink"
      >
        {Math.round(p.scale * 100)}%
      </button>
      <IconButton label="Yakınlaştır  Ctrl +" onClick={() => p.onZoom(0.1)}>
        <span className="text-base leading-none">+</span>
      </IconButton>
      <IconButton label="Genişliğe sığdır  W" onClick={p.onFitWidth}>
        <FitWidthIcon />
      </IconButton>
      <IconButton label="Sayfaya sığdır  P" onClick={p.onFitPage}>
        <FitPageIcon />
      </IconButton>

      <Divider />

      {TOOLS.map(([id, label, ToolIcon]) => (
        <IconButton
          key={id}
          label={`${label}  (Esc: bırak)`}
          active={p.tool === id}
          onClick={() => p.onTool(p.tool === id ? null : id)}
          highlight
        >
          <ToolIcon />
        </IconButton>
      ))}
      {(p.tool === "pen" || p.tool === "marker" || p.tool === "text") && (
        <div className="flex shrink-0 items-center gap-1 px-1" role="radiogroup" aria-label="Renk">
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
        <IconButton label="Geri al  Ctrl Z" onClick={p.onUndo}>
          <UndoIcon />
        </IconButton>
      )}

      <Divider />

      <IconButton
        label="Yapamadığım soruyu kırp  Q  (sayfada çerçevele, Esc: vazgeç)"
        active={p.cropping}
        onClick={p.onCrop}
        highlight
      >
        <CropIcon />
      </IconButton>
      <IconButton label="Yer imi  B" active={p.bookmarked} onClick={p.onToggleBookmark}>
        <BookmarkIcon filled={p.bookmarked} />
      </IconButton>
      <InsertPageMenu page={p.currentPage} busy={p.inserting} onInsert={p.onInsertPage} />
      <IconButton
        label={
          p.saving
            ? "Kaydediliyor…"
            : p.savedTo
              ? `Notları PDF'e yazıp ${p.savedTo} dosyasına kaydet  Ctrl S
Farklı kaydet: Ctrl Shift S ya da Shift tık
Değişiklik varsa 10 dakikada bir otomatik kaydedilir`
              : "Notları PDF'e yazıp kaydet  Ctrl S"
        }
        onClick={(e) => p.onSave(e.shiftKey)}
        active={p.saving}
      >
        <SaveIcon />
      </IconButton>
      {p.justSaved && <span className="shrink-0 pr-1 text-xs text-muted">Kaydedildi</span>}
      <IconButton label="Belgede ara  Ctrl F" onClick={p.onSearch}>
        <SearchIcon />
      </IconButton>
      <IconButton
        label={`Taranmış sayfalarda metin tanıma (OCR): ${p.ocr ? "açık" : "kapalı"}`}
        active={p.ocr}
        onClick={p.onToggleOcr}
      >
        <OcrIcon />
      </IconButton>
      <IconButton label="Odak modu  F" onClick={p.onFocusMode}>
        <ExpandIcon />
      </IconButton>
      <IconButton label="Kısayollar  ?" onClick={p.onHelp}>
        <KeyboardIcon />
      </IconButton>

      <Divider />

      <button
        onClick={p.onChat}
        title="Seçili metin hakkında sor"
        className="flex shrink-0 items-center gap-1.5 px-2 text-muted hover:text-ink"
      >
        Sor
        <kbd className="border border-rule px-1 font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <button
        onClick={p.onLibrary}
        title="Kitaplık  L"
        className="flex shrink-0 items-center gap-1.5 px-2 text-muted hover:text-ink"
      >
        Kitaplık
        <kbd className="border border-rule px-1 font-mono text-[11px]">L</kbd>
      </button>
      <IconButton label="Kelime listesi  ]" active={p.rightOpen} onClick={p.onToggleRight}>
        <PanelRightIcon />
      </IconButton>

      {/* Okuma ilerlemesi */}
      <div
        className="absolute bottom-[-1px] left-0 h-0.5 bg-accent/70 transition-[width] duration-200"
        style={{ width: `${progress}%` }}
      />
    </header>
  );
}

function IconButton({
  label,
  active,
  highlight,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  /** Etkinken arka planla belirginleştir (seçili araç) */
  highlight?: boolean;
  onClick: (e: React.MouseEvent) => void;
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
      } ${active && highlight ? "bg-ink/8" : ""}`}
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
        label={busy ? "Sayfa ekleniyor…" : "Bu sayfanın arkasına boş sayfa ekle"}
        active={open || busy}
        onClick={() => !busy && setOpen((o) => !o)}
      >
        <PagePlusIcon />
      </IconButton>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-44 border border-rule bg-sheet py-1 text-xs shadow-[0_4px_16px_var(--shadow)]">
          <p className="px-3 pt-1 pb-1.5 text-muted">{page}. sayfanın arkasına</p>
          {PAPER_STYLES.map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setOpen(false);
                onInsert(id);
              }}
              className="block w-full px-3 py-1.5 text-left text-ink hover:bg-ink/8"
            >
              {label} sayfa
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-1.5 h-4 w-px shrink-0 bg-rule" />;
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
      title="Sayfaya git  G"
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
        aria-label="Sayfa numarası"
        style={{ width: `${String(total).length + 1.5}ch` }}
        className="border-b border-rule bg-transparent text-center outline-none focus:border-ink"
      />
      <span className="text-muted">/ {total}</span>
    </form>
  );
}
