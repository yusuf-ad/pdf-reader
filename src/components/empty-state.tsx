"use client";

import type { RecentFile } from "@/lib/file-store";
import { loadProgress } from "@/lib/reading-state";

type Props = {
  recent: RecentFile[];
  onOpenPicker: () => void;
  onOpenRecent: (key: string) => void;
  onForget: (key: string) => void;
};

export default function EmptyState({ recent, onOpenPicker, onOpenRecent, onForget }: Props) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center">
      <h1 className="font-serif text-3xl leading-tight">Oku, takıldığın kelimeyi seç.</h1>
      <p className="mt-3 leading-relaxed text-muted">
        Seçtiğin kelimenin o cümledeki anlamını ve cümlenin çevirisini gösterir, ikisini birlikte
        kelime listene ekler.
      </p>
      <button
        onClick={onOpenPicker}
        className="mt-8 self-start border border-ink px-4 py-2 text-sm transition-colors hover:bg-ink hover:text-sheet"
      >
        PDF aç
      </button>
      <p className="mt-3 text-xs text-muted">ya da dosyayı buraya sürükle</p>

      {recent.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xs text-muted">Son açılanlar</h2>
          <ul className="mt-2 border-t border-rule">
            {recent.map((f) => {
              const page = loadProgress(f.key);
              return (
                <li key={f.key} className="group flex items-baseline border-b border-rule">
                  <button
                    onClick={() => onOpenRecent(f.key)}
                    className="min-w-0 flex-1 py-3 text-left"
                  >
                    <span className="block truncate font-serif text-[17px] group-hover:text-accent">
                      {f.name.replace(/\.pdf$/i, "")}
                    </span>
                    <span className="text-xs text-muted">
                      {page ? `Kaldığın sayfa: ${page}` : "Henüz okunmadı"} ·{" "}
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </button>
                  <button
                    onClick={() => onForget(f.key)}
                    className="pl-4 text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-accent"
                  >
                    Kaldır
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
