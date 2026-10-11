"use client";

import { useState, type ReactNode, type RefObject } from "react";
import {
  BookmarkIcon,
  ExpandIcon,
  FitPageIcon,
  FitWidthIcon,
  KeyboardIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SearchIcon,
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
  onSearch: () => void;
  onFocusMode: () => void;
  onHelp: () => void;
  onOpenFile: () => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
};

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

      <IconButton label="Yer imi  B" active={p.bookmarked} onClick={p.onToggleBookmark}>
        <BookmarkIcon filled={p.bookmarked} />
      </IconButton>
      <IconButton label="Belgede ara  Ctrl F" onClick={p.onSearch}>
        <SearchIcon />
      </IconButton>
      <IconButton label="Odak modu  F" onClick={p.onFocusMode}>
        <ExpandIcon />
      </IconButton>
      <IconButton label="Kısayollar  ?" onClick={p.onHelp}>
        <KeyboardIcon />
      </IconButton>

      <Divider />

      <button onClick={p.onOpenFile} className="px-2 text-muted hover:text-ink">
        Başka dosya
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
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
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
      }`}
    >
      {children}
    </button>
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
