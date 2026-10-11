"use client";

import { useEffect, useRef } from "react";
import type { Translation } from "@/lib/types";
import Highlighted from "./highlighted";

export type PopoverState = {
  x: number;
  y: number;
  word: string;
  sentence: string;
  status: "loading" | "done" | "error";
  result?: Translation;
  error?: string;
};

type Props = {
  state: PopoverState;
  onClose: () => void;
  onAsk: () => void;
};

const WIDTH = 380;

export default function TranslationPopover({ state, onClose, onAsk }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Ekrandan taşmasın
  const left = Math.max(12, Math.min(state.x - WIDTH / 2, window.innerWidth - WIDTH - 12));
  const below = state.y + 18;
  const top = below + 280 > window.innerHeight ? Math.max(12, state.y - 298) : below;

  const { result } = state;

  return (
    <div
      ref={ref}
      role="dialog"
      style={{ left, top, width: WIDTH }}
      className="fixed z-50 border border-rule bg-sheet px-5 py-4 shadow-[0_8px_30px_var(--shadow)]"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-xl">{state.word}</span>
        {result?.partOfSpeech && (
          <span className="text-xs text-muted">{result.partOfSpeech}</span>
        )}
      </div>

      {state.status === "loading" && (
        <p className="mt-2 animate-pulse text-sm text-muted">Çevriliyor…</p>
      )}

      {state.status === "error" && <p className="mt-2 text-sm text-accent">{state.error}</p>}

      {state.status === "done" && result && (
        <>
          <p className="mt-1 font-serif text-lg text-accent">{result.wordTranslation}</p>
          {state.sentence && (
            <div className="mt-4 space-y-2 border-t border-rule pt-3 font-serif text-base leading-relaxed">
              <p className="text-muted">
                <Highlighted text={state.sentence} word={state.word} />
              </p>
              <p>{result.sentenceTranslation}</p>
            </div>
          )}
        </>
      )}

      {state.status !== "loading" && (
        <button
          onClick={onAsk}
          className="mt-4 flex items-center gap-2 text-xs text-muted hover:text-ink"
        >
          Bununla ilgili sor
          <kbd className="border border-rule px-1 font-mono text-[11px]">Ctrl K</kbd>
        </button>
      )}
    </div>
  );
}
