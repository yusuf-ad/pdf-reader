"use client";

import { useMemo, useState } from "react";
import { sameWord, useSavedWords } from "@/lib/use-saved-words";
import type { ProposedWord } from "@/lib/words";
import Highlighted from "./highlighted";

// Akış sırasında gelen yarım girdi (alanlar eksik olabilir)
type PartialWord = Partial<Omit<ProposedWord, "synonyms">> & { synonyms?: (string | undefined)[] };
type PartialInput = { title?: string; words?: (PartialWord | undefined)[] };

type Props = {
  input: PartialInput | undefined;
  /** Öneri tamamen geldi; ancak o zaman eklenebilir */
  ready: boolean;
  error?: string;
  /** Kelimeler bu dosyaya bağlanır (kelime listesinde "Sayfaya git" için) */
  fileName: string | null;
  onGoTo?: (page: number) => void;
};

const toWord = (w: PartialWord | undefined): ProposedWord | null =>
  w?.word?.trim()
    ? {
        word: w.word.trim(),
        wordTranslation: w.wordTranslation ?? "",
        partOfSpeech: w.partOfSpeech ?? "",
        synonyms: (w.synonyms ?? []).filter((s): s is string => typeof s === "string" && s.trim() !== ""),
        sentence: w.sentence ?? "",
        sentenceTranslation: w.sentenceTranslation ?? "",
        page: w.page ?? null,
      }
    : null;

/**
 * Modelin kelime listesine eklemeyi önerdiği kelimeler (generative UI). Hiçbiri kendiliğinden
 * eklenmez: kullanıcı önizlemede istemediklerinin işaretini kaldırıp onaylar.
 */
export default function WordProposal({ input, ready, error, fileName, onGoTo }: Props) {
  const { words: saved, addMany, removeMany } = useSavedWords();
  const words = useMemo(() => (input?.words ?? []).map(toWord).filter((w) => w !== null), [input]);
  // Varsayılan hepsi seçili; kullanıcının kaldırdıkları tutulur
  const [unchecked, setUnchecked] = useState<Set<number>>(() => new Set());
  const [added, setAdded] = useState<string[] | null>(null);

  if (error) return <p className="text-sm text-accent">Kelimeler önerilemedi: {error}</p>;

  const inList = words.map((w) => saved.some((s) => sameWord(s, w)));
  const selected = words.flatMap((w, i) => (!inList[i] && !unchecked.has(i) ? [i] : []));
  const addable = words.flatMap((_, i) => (inList[i] ? [] : [i]));
  // Eklendikten sonra listeden silinenler geri alınacaklardan düşer
  const stillAdded = added?.filter((id) => saved.some((s) => s.id === id)) ?? [];

  const toggle = (i: number) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const add = () => {
    const ids = addMany(
      selected.map((i) => {
        const { synonyms, ...w } = words[i];
        return { ...w, ...(synonyms.length ? { synonyms } : {}), fileName };
      }),
    );
    setAdded(ids);
  };

  return (
    <section className="border border-rule bg-sheet px-5 py-4 font-sans">
      <p className="text-xs tracking-wide text-muted uppercase">
        {ready ? "Kelime listesine eklensin mi?" : "Kelimeler bulunuyor…"}
      </p>
      <p className="mt-1 font-serif text-xl leading-snug">{input?.title || "…"}</p>

      {ready && !words.length && <p className="mt-3 text-sm text-muted">Eklenecek kelime bulunamadı.</p>}
      <ul className="mt-3 divide-y divide-rule">
        {words.map((w, i) => {
          const disabled = !ready || inList[i] || added !== null;
          return (
            <li key={i}>
              <label className={`flex gap-3 py-3 ${disabled ? "" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  className="mt-1.5 shrink-0"
                  checked={inList[i] || !unchecked.has(i)}
                  disabled={disabled}
                  onChange={() => toggle(i)}
                />
                <div className={`min-w-0 flex-1 ${!inList[i] && unchecked.has(i) ? "opacity-50" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[17px]">{w.word}</span>
                    <span className="text-xs text-muted">{w.partOfSpeech}</span>
                    {inList[i] && <span className="ml-auto text-xs text-muted">✓ listede</span>}
                  </div>
                  <p className="font-serif text-accent">{w.wordTranslation}</p>
                  {w.synonyms.length > 0 && (
                    <p className="mt-0.5 text-sm text-muted">
                      <span title="Eş anlamlılar">≈</span> {w.synonyms.join(", ")}
                    </p>
                  )}
                  {w.sentence && (
                    <p className="mt-1.5 font-serif text-[15px] leading-relaxed text-muted">
                      <Highlighted text={w.sentence} word={w.word} />
                    </p>
                  )}
                  {w.page && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onGoTo?.(w.page!);
                      }}
                      className="mt-1 text-xs text-muted underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-ink"
                    >
                      s. {w.page}
                    </button>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {ready && words.length > 0 && (
        <div className="mt-3 flex items-baseline gap-4 border-t border-rule pt-3 text-xs">
          {added !== null ? (
            <>
              <span className="flex-1 text-muted">
                {stillAdded.length ? `✓ ${stillAdded.length} kelime eklendi` : "Geri alındı"}
              </span>
              {stillAdded.length > 0 && (
                <button onClick={() => removeMany(stillAdded)} className="text-muted underline underline-offset-2 hover:text-ink">
                  Geri al
                </button>
              )}
            </>
          ) : addable.length ? (
            <>
              <button
                onClick={() => setUnchecked(selected.length === addable.length ? new Set(addable) : new Set())}
                className="text-muted hover:text-ink"
              >
                {selected.length === addable.length ? "Hiçbiri" : "Tümü"}
              </button>
              <span className="flex-1" />
              <button
                onClick={add}
                disabled={!selected.length}
                className="border border-ink px-3 py-1.5 text-sm text-ink transition-colors hover:bg-ink hover:text-sheet disabled:opacity-40"
              >
                Seçilenleri ekle ({selected.length})
              </button>
            </>
          ) : (
            <span className="text-muted">Hepsi zaten listende.</span>
          )}
        </div>
      )}
    </section>
  );
}
