"use client";

import { useMemo, useRef, useState } from "react";
import { downloadBackup, restoreBackup } from "@/lib/backup";
import type { Book } from "@/lib/file-store";
import { loadProgress } from "@/lib/reading-state";

type Sort = "recent" | "title" | "progress";

type Props = {
  books: Book[];
  currentKey: string | null;
  /** Kapakları hazırlanan dosya sayısı */
  adding: number;
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  /** Bir kitap açıksa okumaya dönüş */
  onClose?: () => void;
};

const title = (b: Book) => b.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ");

export default function Library({ books, currentKey, adding, onOpen, onRemove, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const items = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const withProgress = books
      .filter((b) => !q || title(b).toLocaleLowerCase("tr").includes(q))
      .map((b) => {
        const page = loadProgress(b.key);
        return { book: b, page, ratio: page && b.numPages ? page / b.numPages : 0 };
      });
    if (sort === "title") withProgress.sort((a, b) => title(a.book).localeCompare(title(b.book), "tr"));
    if (sort === "progress") withProgress.sort((a, b) => b.ratio - a.ratio);
    return withProgress;
  }, [books, query, sort]);

  if (books.length === 0) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col justify-center px-8">
        <h1 className="font-serif text-3xl leading-tight">Oku, takıldığın kelimeyi seç.</h1>
        <p className="mt-3 leading-relaxed text-muted">
          Seçtiğin kelimenin o cümledeki anlamını ve cümlenin çevirisini gösterir, ikisini birlikte
          kelime listene ekler. Açtığın PDF&apos;ler kitaplığında saklanır.
        </p>
        <button
          onClick={onAdd}
          className="mt-8 self-start border border-ink px-4 py-2 text-sm transition-colors hover:bg-ink hover:text-sheet"
        >
          PDF aç
        </button>
        <p className="mt-3 text-xs text-muted">ya da dosyaları buraya sürükle</p>
        <div className="mt-12 border-t border-rule pt-4 text-xs text-muted">
          Başka bir tarayıcıdan ya da cihazdan mı geliyorsun? <BackupButtons />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <header className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="mr-auto">
          <h1 className="font-serif text-3xl">Kitaplık</h1>
          <p className="mt-1 text-sm text-muted">
            {books.length} kitap
            {adding > 0 && ` · ${adding} dosya ekleniyor…`}
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kitap ara"
          className="w-48 border-b border-rule bg-transparent py-1.5 text-sm outline-none placeholder:text-muted focus:border-ink"
        />
        <div className="flex gap-3 text-sm">
          {(
            [
              ["recent", "Son okunan"],
              ["title", "Ada göre"],
              ["progress", "İlerleme"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSort(id)}
              className={sort === id ? "text-ink" : "text-muted hover:text-ink"}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onAdd}
          className="border border-ink px-3 py-1.5 text-sm transition-colors hover:bg-ink hover:text-sheet"
        >
          Kitap ekle
        </button>
        <BackupButtons />
        {onClose && (
          <button onClick={onClose} className="text-sm text-muted hover:text-ink">
            Okumaya dön <kbd className="ml-1 border border-rule px-1 font-mono text-[11px]">Esc</kbd>
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="mt-16 text-sm text-muted">“{query}” ile eşleşen kitap yok.</p>
      ) : (
        <ul className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-8 gap-y-12">
          {items.map(({ book, page, ratio }) => (
            <li key={book.key} className="group relative">
              <button onClick={() => onOpen(book.key)} className="block w-full text-left">
                <div className="page-frame relative aspect-[3/4] overflow-hidden transition-transform group-hover:-translate-y-1">
                  {book.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- yerel data URL
                    <img
                      src={book.cover}
                      alt=""
                      // Yatay sayfalar (sunum vb.) kırpılmasın, tamamı görünsün
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth > img.naturalHeight) img.style.objectFit = "contain";
                      }}
                      className="relative h-full w-full object-cover object-top [filter:var(--page-filter)]"
                    />
                  ) : (
                    <span className="relative flex h-full items-center justify-center p-4 text-center font-serif text-lg text-muted">
                      {title(book)}
                    </span>
                  )}
                  {book.key === currentKey && (
                    <span className="absolute top-2 left-2 bg-ink/80 px-1.5 py-0.5 text-[10px] tracking-wide text-paper">
                      OKUNUYOR
                    </span>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 font-serif text-[15px] leading-snug group-hover:text-accent">
                  {title(book)}
                </p>
                <div className="mt-2 h-0.5 bg-rule">
                  <div className="h-full bg-accent/70" style={{ width: `${ratio * 100}%` }} />
                </div>
                <p className="mt-1.5 text-xs tabular-nums text-muted">
                  {page && book.numPages
                    ? `s. ${page} / ${book.numPages} · %${Math.round(ratio * 100)}`
                    : book.numPages
                      ? `${book.numPages} sayfa · başlanmadı`
                      : "Başlanmadı"}
                </p>
                {book.openedAt && (
                  <p className="text-xs text-muted">{relativeTime(book.openedAt)}</p>
                )}
              </button>
              <button
                onClick={() => confirm(`“${title(book)}” kitaplıktan kaldırılsın mı?`) && onRemove(book.key)}
                className="absolute top-2 right-2 bg-sheet/90 px-1.5 py-0.5 text-[11px] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
              >
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Notları, kelimeleri ve soruları tek dosyaya yedekler / yedekten geri yükler. */
function BackupButtons() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-3 text-sm">
      <button
        onClick={() => downloadBackup().catch(() => setMessage("Yedek alınamadı."))}
        title="Kelimeler, notlar, vurgular, okuma durumu ve sorular tek bir dosyaya kaydedilir"
        className="text-muted hover:text-ink"
      >
        Yedek al
      </button>
      <button onClick={() => inputRef.current?.click()} className="text-muted hover:text-ink">
        Yedekten yükle
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await restoreBackup(file);
            setMessage("Yedek yüklendi. Kitapları ekleyince notları da gelir.");
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      />
    </span>
  );
}

const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });

function relativeTime(time: number) {
  const minutes = Math.round((time - Date.now()) / 60000);
  if (minutes > -1) return "az önce";
  if (minutes > -60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (days > -30) return rtf.format(days, "day");
  return new Date(time).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}
