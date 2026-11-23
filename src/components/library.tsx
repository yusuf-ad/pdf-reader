"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { downloadBackup, restoreBackup } from "@/lib/backup";
import type { PaperStyle } from "@/lib/blank-book";
import { PAPER_STYLES } from "@/lib/paper-styles";
import { addWelcomeBook, type Book } from "@/lib/file-store";
import { loadProgress } from "@/lib/reading-state";
import { openOnboarding } from "./onboarding";

const ONBOARDING_TEXT = {
  sample: "Örnek PDF'i aç",
  loading: "Örnek PDF hazırlanıyor…",
  error: "Örnek PDF açılamadı. Yeniden deneyebilir veya kendi PDF’ini açabilirsin.",
} as const;

const DATA_NOTICE_TEXT = {
  title: "Verilerin bu tarayıcıda",
  message:
    "Kitapların ve notların yalnızca bu tarayıcıda saklanır. Tarayıcı verilerini silersen ya da başka cihaza geçersen kaybolur — düzenli yedek al.",
  backupHint: "Yedek dosyası PDF’leri içermez; kitap dosyalarını da ayrıca sakla.",
  dismiss: "Anladım",
} as const;

const DATA_NOTICE_DISMISSED_KEY = "pdf-reader:data-notice-dismissed";
const dataNoticeListeners = new Set<() => void>();

function isDataNoticeDismissed() {
  try {
    return localStorage.getItem(DATA_NOTICE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeDataNotice(listener: () => void) {
  dataNoticeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DATA_NOTICE_DISMISSED_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    dataNoticeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function dismissDataNotice() {
  try {
    localStorage.setItem(DATA_NOTICE_DISMISSED_KEY, "true");
  } catch {
    return;
  }
  dataNoticeListeners.forEach((listener) => listener());
}

type Sort = "recent" | "title" | "progress";

type Props = {
  books: Book[];
  currentKey: string | null;
  /** Kapakları hazırlanan dosya sayısı */
  adding: number;
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  /** Not almak için boş defter oluşturup açar */
  onCreateBlank: (title: string, pages: number, style: PaperStyle) => Promise<void>;
  /** Bir kitap açıksa okumaya dönüş */
  onClose?: () => void;
  /** Kapatma düğmesinin yazısı; verilirse Esc ipucu gösterilmez (boş bölmeyi kapatmak gibi) */
  closeLabel?: string;
};

const title = (b: Book) => b.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ");

// "Konumu aç" yalnızca uygulama yerelde çalışırken (sunucu kullanıcının bilgisayarıyken) işe yarar
const LOCAL_REVEAL = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_LOCAL_REVEAL === "1";

export default function Library({
  books,
  currentKey,
  adding,
  onOpen,
  onRemove,
  onAdd,
  onCreateBlank,
  onClose,
  closeLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [blankOpen, setBlankOpen] = useState(false);
  const [revealing, setRevealing] = useState<{ key: string; text: string } | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState(false);

  useEffect(() => {
    let active = true;
    addWelcomeBook(true).then((key) => {
      if (!active || !key) return;
      onOpen(key);
      openOnboarding(true);
    }).catch(() => { if (active) setSampleError(true); });
    return () => { active = false; };
  }, [onOpen]);

  const openSample = async () => {
    setSampleBusy(true);
    setSampleError(false);
    try {
      const key = await addWelcomeBook();
      if (key) {
        onOpen(key);
        openOnboarding(true);
      }
    } catch {
      setSampleError(true);
    } finally {
      setSampleBusy(false);
    }
  };

  /** PDF'in diskteki klasörünü açar; sunucu dosyayı ad ve boyutundan bulur. */
  const revealBook = async (book: Book) => {
    setRevealing({ key: book.key, text: "Aranıyor…" });
    const text = await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: book.key, name: book.name, size: book.size }),
    })
      .then((r) => r.json())
      .then((r: { found?: boolean }) => (r.found ? "Açıldı" : "Bulunamadı"))
      .catch(() => "Açılamadı");
    setRevealing({ key: book.key, text });
    setTimeout(() => setRevealing((r) => (r?.key === book.key && r.text === text ? null : r)), 2500);
  };

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
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-8 py-8">
        <DataLocalityNotice />
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
        <button
          onClick={openSample}
          disabled={sampleBusy}
          className="mt-4 self-start text-sm underline underline-offset-4 hover:text-accent disabled:text-muted"
        >
          {sampleBusy ? ONBOARDING_TEXT.loading : ONBOARDING_TEXT.sample}
        </button>
        {sampleError && <p role="status" className="mt-2 text-xs text-muted">{ONBOARDING_TEXT.error}</p>}
        <div className="mt-6 text-sm">
          {blankOpen ? (
            <BlankBookForm onCreate={onCreateBlank} onCancel={() => setBlankOpen(false)} />
          ) : (
            <button onClick={() => setBlankOpen(true)} className="text-muted hover:text-ink">
              ya da boş bir defter oluştur
            </button>
          )}
        </div>
        <div className="mt-12 border-t border-rule pt-4 text-xs text-muted">
          Başka bir tarayıcıdan ya da cihazdan mı geliyorsun? <BackupButtons />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <DataLocalityNotice />
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
        <button
          onClick={() => setBlankOpen((o) => !o)}
          className={`border px-3 py-1.5 text-sm transition-colors ${blankOpen ? "border-ink text-ink" : "border-rule text-muted hover:border-ink hover:text-ink"}`}
        >
          Boş defter
        </button>
        <BackupButtons />
        {onClose && (
          <button onClick={onClose} className="text-sm text-muted hover:text-ink">
            {closeLabel ?? (
              <>
                Okumaya dön <kbd className="ml-1 border border-rule px-1 font-mono text-[11px]">Esc</kbd>
              </>
            )}
          </button>
        )}
      </header>

      {blankOpen && (
        <div className="mt-6 border-t border-rule pt-4 text-sm">
          <BlankBookForm onCreate={onCreateBlank} onCancel={() => setBlankOpen(false)} />
        </div>
      )}

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
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => confirm(`“${title(book)}” kitaplıktan kaldırılsın mı?`) && onRemove(book.key)}
                  className="bg-sheet/90 px-1.5 py-0.5 text-[11px] text-muted hover:text-accent"
                >
                  Kaldır
                </button>
                {LOCAL_REVEAL && <button
                  onClick={() => revealBook(book)}
                  title="PDF'in bulunduğu klasörü dosya gezgininde açar"
                  className="bg-sheet/90 px-1.5 py-0.5 text-[11px] text-muted hover:text-ink"
                >
                  {revealing?.key === book.key ? revealing.text : "Konumu aç"}
                </button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DataLocalityNotice() {
  const dismissed = useSyncExternalStore(
    subscribeDataNotice,
    isDataNoticeDismissed,
    () => false,
  );

  if (dismissed) return null;

  return (
    <aside aria-label={DATA_NOTICE_TEXT.title} className="mb-8 border border-rule bg-sheet p-4">
      <p className="font-serif text-lg">{DATA_NOTICE_TEXT.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{DATA_NOTICE_TEXT.message}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{DATA_NOTICE_TEXT.backupHint}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <BackupButtons />
        <button
          type="button"
          onClick={dismissDataNotice}
          className="text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          {DATA_NOTICE_TEXT.dismiss}
        </button>
      </div>
    </aside>
  );
}

/** Boş defterin adını, sayfa sayısını ve kâğıt türünü sorar. */
function BlankBookForm({
  onCreate,
  onCancel,
}: {
  onCreate: Props["onCreateBlank"];
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [pages, setPages] = useState(50);
  const [style, setStyle] = useState<PaperStyle>("lined");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-x-6 gap-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await onCreate(name.trim() || "Defter", Math.min(500, Math.max(1, pages || 1)), style);
        } finally {
          setBusy(false);
        }
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Ad</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Defter"
          className="w-56 border-b border-rule bg-transparent py-1.5 outline-none placeholder:text-muted focus:border-ink"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Sayfa</span>
        <input
          type="number"
          min={1}
          max={500}
          value={pages}
          onChange={(e) => setPages(e.target.valueAsNumber)}
          className="w-20 border-b border-rule bg-transparent py-1.5 tabular-nums outline-none focus:border-ink"
        />
      </label>
      <div className="flex gap-3 pb-1.5">
        {PAPER_STYLES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStyle(id)}
            className={style === id ? "text-ink underline underline-offset-4" : "text-muted hover:text-ink"}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="submit"
        disabled={busy}
        className="border border-ink px-3 py-1.5 transition-colors hover:bg-ink hover:text-sheet disabled:opacity-50"
      >
        {busy ? "Oluşturuluyor…" : "Oluştur"}
      </button>
      <button type="button" onClick={onCancel} className="pb-1.5 text-muted hover:text-ink">
        Vazgeç
      </button>
    </form>
  );
}

/** Notları, kelimeleri ve soruları tek dosyaya yedekler / yedekten geri yükler. */
function BackupButtons() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-3 text-sm">
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
