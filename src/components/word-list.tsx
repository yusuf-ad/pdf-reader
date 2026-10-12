"use client";

import { useMemo, useState } from "react";
import type { SavedWord } from "@/lib/types";
import { THEMES } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import Highlighted from "./highlighted";

type Props = {
  words: SavedWord[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Açık dosyanın adı; aynı dosyadaki kelimelere tıklayınca o sayfaya gidilir */
  currentFileName: string | null;
  onGoTo: (page: number) => void;
};

export default function WordList({ words, onRemove, onClear, currentFileName, onGoTo }: Props) {
  const [query, setQuery] = useState("");
  const { theme, setTheme } = useTheme();

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return words;
    return words.filter((w) =>
      [w.word, w.wordTranslation, w.sentence].some((s) => s.toLocaleLowerCase("tr").includes(q)),
    );
  }, [words, query]);

  const exportCsv = () => {
    const esc = (s: string | number | null) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Kelime", "Türkçe", "Tür", "Cümle", "Cümle (TR)", "Sayfa", "Dosya", "Tarih"],
      ...words.map((w) => [
        w.word,
        w.wordTranslation,
        w.partOfSpeech,
        w.sentence,
        w.sentenceTranslation,
        w.page,
        w.fileName,
        new Date(w.createdAt).toLocaleString("tr-TR"),
      ]),
    ];
    // BOM: Excel'in Türkçe karakterleri doğru açması için
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kelimeler.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-rule bg-sheet">
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-lg">
            Kelimeler
            <span className="ml-2 font-sans text-xs tabular-nums text-muted">{words.length}</span>
          </h2>
          {words.length > 0 && (
            <div className="flex gap-4 text-xs text-muted">
              <button onClick={exportCsv} className="hover:text-ink">
                CSV olarak indir
              </button>
              <button
                onClick={() => confirm("Tüm kelimeler silinsin mi?") && onClear()}
                className="hover:text-accent"
              >
                Temizle
              </button>
            </div>
          )}
        </div>
        {words.length > 0 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara"
            className="mt-3 w-full border-b border-rule bg-transparent py-1.5 text-sm outline-none placeholder:text-muted focus:border-ink"
          />
        )}
      </div>

      <ul className="flex-1 overflow-y-auto px-6">
        {words.length === 0 && (
          <li className="py-6 text-sm leading-relaxed text-muted">
            Çevirdiğin kelimeler, geçtikleri cümleyle birlikte burada birikir.
          </li>
        )}
        {words.length > 0 && filtered.length === 0 && (
          <li className="py-6 text-sm text-muted">Eşleşen kelime yok.</li>
        )}
        {filtered.map((w) => (
          <li key={w.id} className="group border-b border-rule py-4 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-[17px]">{w.word}</span>
              <span className="text-xs text-muted">{w.partOfSpeech}</span>
              <button
                onClick={() => onRemove(w.id)}
                className="ml-auto text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
              >
                Sil
              </button>
            </div>
            <p className="font-serif text-accent">{w.wordTranslation}</p>
            {w.sentence && (
              <div className="mt-2 space-y-1 font-serif text-[15px] leading-relaxed">
                <p className="text-muted">
                  <Highlighted text={w.sentence} word={w.word} />
                </p>
                <p>{w.sentenceTranslation}</p>
              </div>
            )}
            {w.page && w.fileName === currentFileName ? (
              <button
                onClick={() => onGoTo(w.page!)}
                className="mt-2 text-xs text-muted underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-ink"
              >
                Sayfaya git · s. {w.page}
              </button>
            ) : (
              (w.fileName || w.page) && (
                <p className="mt-2 truncate text-xs text-muted">
                  {w.fileName}
                  {w.page && `, s. ${w.page}`}
                </p>
              )
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-1 border-t border-rule px-6 py-3 text-xs">
        <span className="mr-2 text-muted">Tema</span>
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={theme === t.id}
            className={`px-2 py-1 transition-colors ${
              theme === t.id ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
