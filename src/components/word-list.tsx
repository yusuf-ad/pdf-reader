"use client";

import { useLang, useT } from "@/lib/i18n";
import { useMemo, useState } from "react";
import type { SavedWord } from "@/lib/types";
import { THEMES } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import Highlighted from "./highlighted";
import NotesList, { useNotes } from "./notes-list";

type Props = {
  words: SavedWord[];
  onRemove: (id: string) => void;
  /** Kelimeyi geçtiği cümleyle sohbete sor */
  onAsk: (word: SavedWord) => void;
  onClear: () => void;
  /** Açık dosyanın adı; aynı dosyadaki kelimelere tıklayınca o sayfaya gidilir */
  currentFileName: string | null;
  onGoTo: (page: number) => void;
  /** Açık kitap; notlar sekmesi bu kitabın notlarını gösterir */
  book: string | null;
  currentPage: number;
  onClose: () => void;
};

type Tab = "words" | "notes";

export default function WordList({
  words,
  onRemove,
  onAsk,
  onClear,
  currentFileName,
  onGoTo,
  book,
  currentPage,
  onClose,
}: Props) {
  const t = useT("ai");
  const lang = useLang();
  const [tab, setTab] = useState<Tab>("words");
  const [query, setQuery] = useState("");
  const notes = useNotes(book);
  const noteCount = notes.length;
  const { theme, setTheme } = useTheme();

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return words;
    return words.filter((w) =>
      [w.word, w.wordTranslation, w.sentence, ...(w.synonyms ?? [])].some((s) => s.toLocaleLowerCase("tr").includes(q)),
    );
  }, [words, query]);

  const exportCsv = () => {
    const esc = (s: string | number | null) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [t("wordsWord"), t("wordsTurkish"), t("wordsPartOfSpeech"), t("wordsSynonyms"), t("wordsSentence"), t("wordsSentenceTranslation"), t("wordsPage"), t("wordsFile"), t("wordsDate")],
      ...words.map((w) => [
        w.word,
        w.wordTranslation,
        w.partOfSpeech,
        (w.synonyms ?? []).join(", "),
        w.sentence,
        w.sentenceTranslation,
        w.page,
        w.fileName,
        new Date(w.createdAt).toLocaleString(lang === "tr" ? "tr-TR" : "en-US"),
      ]),
    ];
    // BOM: Excel'in Türkçe karakterleri doğru açması için
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = t("wordsFilename");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-rule bg-sheet">
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-4" role="tablist">
            {(
              [
                ["words", t("wordsTab"), words.length],
                ["notes", t("wordsNotes"), noteCount],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`font-serif text-lg transition-colors ${tab === id ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {label}
                <span className="ml-1.5 font-sans text-xs tabular-nums text-muted">{count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-baseline gap-4 text-xs text-muted">
            {tab === "words" && words.length > 0 && (
              <>
                <button onClick={exportCsv} className="hover:text-ink">
                  {t("wordsCsv")}
                </button>
                <button
                  onClick={() => confirm(t("wordsClearConfirm")) && onClear()}
                  className="hover:text-accent"
                >
                  {t("wordsClear")}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              aria-label={t("wordsClosePanel")}
              title={t("wordsClosePanelHint")}
              className="-mr-2 self-center px-2 text-lg leading-none hover:text-ink"
            >
              ×
            </button>
          </div>
        </div>
        {(tab === "words" ? words.length > 0 : noteCount > 0) && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "words" ? t("wordsSearch") : t("wordsSearchNotes")}
            className="mt-3 w-full border-b border-rule bg-transparent py-1.5 text-sm outline-none placeholder:text-muted focus:border-ink"
          />
        )}
      </div>

      {tab === "notes" ? (
        <NotesList
          book={book}
          items={notes}
          currentPage={currentPage}
          onGoTo={onGoTo}
          query={query}
        />
      ) : (
        <ul className="flex-1 overflow-y-auto px-6">
          {words.length === 0 && (
            <li className="py-6 text-sm leading-relaxed text-muted">
              {t("wordsEmpty")}
            </li>
          )}
          {words.length > 0 && filtered.length === 0 && (
            <li className="py-6 text-sm text-muted">{t("wordsNoMatches")}</li>
          )}
          {filtered.map((w) => (
            <li key={w.id} className="group border-b border-rule py-4 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-[17px]">{w.word}</span>
                <span className="text-xs text-muted">{w.partOfSpeech}</span>
                <button
                  onClick={() => onAsk(w)}
                  title={t("wordsAskHint")}
                  className="ml-auto text-xs text-muted hover:text-ink"
                >
                  {t("wordsAsk")}
                </button>
                <button
                  onClick={() => onRemove(w.id)}
                  className="text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
                >
                  {t("actionDelete")}
                </button>
              </div>
              <p className="font-serif text-accent">{w.wordTranslation}</p>
              {w.synonyms?.length ? (
                <p className="mt-0.5 text-sm text-muted">
                  <span title={t("wordsSynonyms")}>≈</span> {w.synonyms.join(", ")}
                </p>
              ) : null}
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
                  {t("wordsGoToPage", { page: w.page! })}
                </button>
              ) : (
                (w.fileName || w.page) && (
                  <p className="mt-2 truncate text-xs text-muted">
                    {w.fileName}
                    {w.page && t("pageReferenceComma", { page: w.page })}
                  </p>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-rule px-6 py-3 text-xs">
        <span className="mr-2 text-muted">{t("wordsTheme")}</span>
        {THEMES.map((item) => (
          <button
            key={item.id}
            onClick={() => setTheme(item.id)}
            aria-pressed={theme === item.id}
            className={`px-2 py-1 transition-colors ${
              theme === item.id ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t(({ light: "wordsThemeLight", sepia: "wordsThemeSepia", baroque: "wordsThemeBaroque", night: "wordsThemeNight", dark: "wordsThemeDark", plum: "wordsThemePlum", espresso: "wordsThemeEspresso" } as const)[item.id])}
          </button>
        ))}
      </div>
    </aside>
  );
}
