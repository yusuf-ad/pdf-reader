"use client";

import { useEffect, useRef, useState } from "react";
import { hasAiKey, openAiSettings, useAiSettings } from "@/lib/ai-settings";
import {
  addQuestion,
  createFolder,
  deleteFolder,
  getLastFolder,
  imageUrl,
  removeQuestion,
  renameFolder,
  setLastFolder,
  updateQuestion,
  useFolders,
  useQuestions,
  type NewQuestion,
  type Question,
} from "@/lib/questions";

const AI_COPY = {
  addKey: "AI özellikleri için API key ekle",
  settings: "API key ekle / düzenle",
};

/** PDF'ten kırpılan görüntüler sayfa gibi temaya uyar; dışarıdan yapıştırılanlar olduğu gibi kalır. */
const imageFilter = (page: number | null) => (page ? "[filter:var(--page-filter)]" : "");

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={label}
        className="flex max-h-full w-160 max-w-full flex-col border border-rule bg-sheet shadow-[0_8px_30px_var(--shadow)]"
      >
        {children}
      </div>
    </div>
  );
}

const inputClass =
  "w-full border-b border-rule bg-transparent py-1.5 outline-none placeholder:text-muted focus:border-ink";

const NEW_FOLDER = "__new__";

/** Klasör seçimi; listeden "Yeni klasör…" seçilince ad yazılır, Enter ile oluşturulur. */
function FolderPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  autoFocus?: boolean;
}) {
  const folders = useFolders();
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      // Enter formu göndermesin, Esc pencereyi kapatmasın; yalnızca ad girişini bitirsin
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        <NameInput
          placeholder="Klasör adı, ör. Adverbial Clauses testi"
          onDone={(name) => {
            setCreating(false);
            if (name) onChange(createFolder(name).id);
          }}
        />
      </div>
    );
  }

  return (
    <select
      autoFocus={autoFocus}
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === NEW_FOLDER) setCreating(true);
        else onChange(e.target.value || null);
      }}
      className={`${inputClass} cursor-pointer`}
    >
      <option value="">Klasörsüz</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
      <option value={NEW_FOLDER}>+ Yeni klasör…</option>
    </select>
  );
}

/** Yeni soruyu kaydetmeden önce klasör ve not sorulur. */
export function QuestionDialog({
  draft,
  onClose,
  onSaved,
  onAsk,
  onAddToPdf,
}: {
  draft: Omit<NewQuestion, "folderId" | "note">;
  onClose: () => void;
  onSaved: () => void;
  /** Kaydetmeden sohbete sor */
  onAsk: () => void;
  /** Soru olarak kaydetmeden açık sayfaya görsel olarak ekle (PDF açıkken) */
  onAddToPdf?: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(getLastFolder);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await addQuestion({ ...draft, folderId, note: note.trim() });
      setLastFolder(folderId);
      // Sorular sekmesi kaydedilen sorunun klasörüyle açılsın
      rememberedView = folderId ? { kind: "folder", id: folderId } : { kind: "none" };
      onSaved();
    } catch (err) {
      setSaving(false);
      alert(`Soru kaydedilemedi: ${(err as Error).message}`);
    }
  };

  return (
    <Modal label="Soruyu kaydet" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex min-h-0 flex-col"
      >
        <div className="border-b border-rule px-6 py-4">
          <h2 className="font-serif text-xl">Yapamadığım soru</h2>
          <p className="mt-1 text-xs text-muted">
            {draft.bookName?.replace(/\.pdf$/i, "") ?? "Yapıştırılan görüntü"}
            {draft.page && ` · s. ${draft.page}`}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-paper p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob görüntüsü */}
          <img src={imageUrl(draft.image)} alt="Kırpılan soru" className={`mx-auto max-h-[45vh] ${imageFilter(draft.page)}`} />
        </div>
        <div className="space-y-4 px-6 py-4 text-sm">
          <label className="block">
            <span className="text-xs text-muted">Klasör</span>
            <FolderPicker value={folderId} onChange={setFolderId} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Not</span>
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
              rows={2}
              placeholder="Neden yapamadım? (formülü bilmiyordum, işlem hatası…)"
              className={`${inputClass} resize-none`}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-rule px-6 py-3 text-sm">
          <span className="mr-auto text-xs text-muted">Enter: kaydet · Esc: vazgeç</span>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-muted hover:text-ink">
            Vazgeç
          </button>
          {onAddToPdf && (
            <button
              type="button"
              onClick={onAddToPdf}
              title="Görseli açık sayfaya yapıştır; taşınabilir, boyutlandırılabilir, kaydedince PDF'e yazılır"
              className="border border-rule px-3 py-1.5 transition-colors hover:border-ink"
            >
              PDF&apos;e ekle
            </button>
          )}
          <button
            type="button"
            onClick={onAsk}
            title="Kaydetmeden sohbete gönder; görsel eklenir, istersen sorunu yazarsın"
            className="flex items-center gap-1.5 border border-rule px-3 py-1.5 transition-colors hover:border-ink"
          >
            Sohbete sor <kbd className="font-mono text-[11px] text-muted">Ctrl K</kbd>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="border border-ink px-4 py-1.5 transition-colors hover:bg-ink hover:text-sheet disabled:opacity-50"
          >
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Status = "open" | "solved" | "all";

const STATUSES: [Status, string][] = [
  ["open", "Çözülmedi"],
  ["solved", "Çözüldü"],
  ["all", "Hepsi"],
];

/** Klasör listesi yerine açık olan görünüm: bir klasör ya da hazır gruplardan biri */
type View = { kind: "folder"; id: string } | { kind: "book" | "all" | "none" };

// Panel kapanıp açılınca aynı klasörde kalınsın
let rememberedView: View | null = null;

const countLabel = (list: Question[]) => {
  const open = list.filter((q) => q.status === "open").length;
  return open === list.length ? `${list.length}` : `${open} / ${list.length}`;
};

function Row({ label, list, onOpen, title }: { label: string; list: Question[]; onOpen: () => void; title?: string }) {
  return (
    <li>
      <button
        onClick={onOpen}
        title={title}
        className="flex w-full items-baseline gap-3 px-5 py-2 text-left hover:bg-ink/5"
      >
        <span className="min-w-0 flex-1 truncate font-serif text-[15px]">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{countLabel(list)}</span>
      </button>
    </li>
  );
}

/** Sol paneldeki "Sorular" sekmesi: önce klasörler, klasöre girince sorular. */
export function QuestionsTab({
  book,
  onGoTo,
  onStartCrop,
  onOpenFile,
  onAskImage,
}: {
  book: string | null;
  onGoTo: (page: number) => void;
  onStartCrop: () => void;
  /** Birleştirilen PDF okuyucuda açılır */
  onOpenFile: (file: File) => void;
  onAskImage: (image: Blob) => void;
}) {
  const questions = useQuestions();
  const folders = useFolders();
  const [view, setViewState] = useState<View | null>(rememberedView);
  const [creating, setCreating] = useState(false);

  const setView = (v: View | null) => {
    rememberedView = v;
    setViewState(v);
    // Klasörün içindeyken kırpılan soru varsayılan olarak bu klasöre gider
    if (v?.kind === "folder") setLastFolder(v.id);
  };

  // Açık klasör silindiyse listeye dön
  const current = view?.kind === "folder" && !folders.some((f) => f.id === view.id) ? null : view;

  const header = (
    <div className="space-y-2 border-b border-rule px-5 py-3">
      <button
        onClick={onStartCrop}
        className="w-full border border-rule px-3 py-1.5 text-left transition-colors hover:border-ink"
      >
        Sayfadan soru kırp <span className="float-right font-mono text-xs text-muted">Q</span>
      </button>
      <p className="text-xs leading-relaxed text-muted">
        Ya da bir ekran görüntüsünü <span className="font-mono">Ctrl V</span> ile yapıştır.
      </p>
    </div>
  );

  if (current) {
    return (
      <div className="text-sm">
        {header}
        <FolderView view={current} book={book} onBack={() => setView(null)} onGoTo={onGoTo} onOpenFile={onOpenFile} onAskImage={onAskImage} />
      </div>
    );
  }

  const fromBook = questions.filter((q) => book && q.book === book);
  const loose = questions.filter((q) => !q.folderId);

  return (
    <div className="text-sm">
      {header}
      {questions.length === 0 && folders.length === 0 ? (
        <p className="px-5 py-6 text-muted">
          Henüz kaydedilmiş soru yok. Yapamadığın soruyu sayfadan kırp, bir klasöre koy (ör. bir testin
          adı); sonra buradan tekrar bakarsın.
        </p>
      ) : (
        <>
          <ul className="border-b border-rule py-2 text-muted">
            {book && <Row label="Bu kitaptan" list={fromBook} onOpen={() => setView({ kind: "book" })} />}
            <Row label="Tüm sorular" list={questions} onOpen={() => setView({ kind: "all" })} />
            {loose.length > 0 && (
              <Row label="Klasörsüz" list={loose} onOpen={() => setView({ kind: "none" })} />
            )}
          </ul>
          <p className="px-5 pt-3 text-xs text-muted">Klasörler</p>
          <ul className="py-1">
            {folders.map((f) => (
              <Row
                key={f.id}
                label={f.name}
                list={questions.filter((q) => q.folderId === f.id)}
                onOpen={() => setView({ kind: "folder", id: f.id })}
                title="çözülmedi / toplam"
              />
            ))}
          </ul>
        </>
      )}
      <div className="px-5 pb-4">
        {creating ? (
          <NameInput
            placeholder="Klasör adı, ör. Adverbial Clauses testi"
            onDone={(name) => {
              setCreating(false);
              if (name) setView({ kind: "folder", id: createFolder(name).id });
            }}
          />
        ) : (
          <button onClick={() => setCreating(true)} className="py-1 text-muted hover:text-ink">
            + Yeni klasör
          </button>
        )}
      </div>
    </div>
  );
}

/** Enter/odak kaybında adı bildirir; Esc ile boş döner. */
function NameInput({
  initial = "",
  placeholder,
  onDone,
}: {
  initial?: string;
  placeholder?: string;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  // Enter/Esc'den sonra gelen odak kaybı ikinci kez bildirmesin
  const doneRef = useRef(false);
  const done = (value: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(value);
  };
  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(name.trim());
        if (e.key === "Escape") done("");
      }}
      onBlur={() => done(name.trim())}
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

function FolderView({
  view,
  book,
  onBack,
  onGoTo,
  onOpenFile,
  onAskImage,
}: {
  view: View;
  book: string | null;
  onBack: () => void;
  onGoTo: (page: number) => void;
  onOpenFile: (file: File) => void;
  onAskImage: (image: Blob) => void;
}) {
  const questions = useQuestions();
  const folders = useFolders();
  const [status, setStatus] = useState<Status>("open");
  const [renaming, setRenaming] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const folder = view.kind === "folder" ? folders.find((f) => f.id === view.id) : undefined;
  const title = folder?.name ?? { book: "Bu kitaptan", all: "Tüm sorular", none: "Klasörsüz", folder: "" }[view.kind];
  const inView = questions.filter((q) =>
    view.kind === "folder"
      ? q.folderId === view.id
      : view.kind === "book"
        ? q.book === book
        : view.kind === "none"
          ? !q.folderId
          : true,
  );
  const items = inView.filter((q) => status === "all" || q.status === status);
  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name;
  const opened = questions.find((q) => q.id === openId) ?? null;

  /** Listedeki (filtrelenmiş) soruları kitap ve sayfa sırasıyla tek PDF yapıp açar. */
  const makePdf = async () => {
    if (!items.length || making) return;
    setMaking(true);
    try {
      const ordered = [...items].sort(
        (a, b) =>
          (a.bookName ?? "").localeCompare(b.bookName ?? "", "tr") ||
          (a.page ?? 0) - (b.page ?? 0) ||
          a.createdAt - b.createdAt,
      );
      const { questionsToPdf } = await import("@/lib/questions-pdf");
      onOpenFile(await questionsToPdf(title, ordered));
    } catch (err) {
      alert(`PDF oluşturulamadı: ${(err as Error).message}`);
    } finally {
      setMaking(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 space-y-2 border-b border-rule bg-sheet px-5 py-3">
        <button onClick={onBack} className="text-xs text-muted hover:text-ink">
          ← Klasörler
        </button>
        {renaming && folder ? (
          <NameInput
            initial={folder.name}
            onDone={(name) => {
              setRenaming(false);
              if (name) renameFolder(folder.id, name);
            }}
          />
        ) : (
          <div className="flex items-baseline gap-3">
            <h3 className="min-w-0 flex-1 font-serif text-lg leading-snug break-words">{title}</h3>
            {folder && (
              <>
                <button onClick={() => setRenaming(true)} className="shrink-0 text-xs text-muted hover:text-ink">
                  Adlandır
                </button>
                <button
                  onClick={() => {
                    if (confirm(`"${folder.name}" klasörü silinsin mi? İçindeki sorular silinmez, klasörsüz kalır.`)) {
                      deleteFolder(folder.id);
                      onBack();
                    }
                  }}
                  className="shrink-0 text-xs text-muted hover:text-accent"
                >
                  Sil
                </button>
              </>
            )}
          </div>
        )}
        <div className="flex gap-3 text-xs">
          {STATUSES.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setStatus(id)}
              className={status === id ? "text-ink underline underline-offset-4" : "text-muted hover:text-ink"}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto tabular-nums text-muted">{countLabel(inView)}</span>
        </div>
        {items.length > 0 && (
          <button
            onClick={makePdf}
            disabled={making}
            title="Listedeki soruları alt alta dizip tek bir PDF yapar ve okuyucuda açar (kitaplığa eklenir)"
            className="w-full border border-rule px-3 py-1.5 text-left text-xs transition-colors hover:border-ink disabled:animate-pulse"
          >
            {making ? "PDF hazırlanıyor…" : `Bu ${items.length} soruyu PDF olarak aç`}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-5 py-6 text-muted">
          {inView.length === 0
            ? folder
              ? "Bu klasör boş. Burası açıkken kırptığın sorular bu klasöre önerilir."
              : "Burada soru yok."
            : status === "open"
              ? "Hepsini çözmüşsün."
              : "Bu filtrede soru yok."}
        </p>
      ) : (
        <ul className="space-y-1 py-2">
          {items.map((q) => (
            <li key={q.id}>
              <button onClick={() => setOpenId(q.id)} className="block w-full px-5 py-2 text-left hover:bg-ink/5">
                <span className="flex gap-2 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate">
                    {view.kind === "folder"
                      ? (q.bookName?.replace(/\.pdf$/i, "") ?? "Yapıştırılan görüntü")
                      : (folderName(q.folderId) ?? "Klasörsüz")}
                  </span>
                  {q.page && <span className="tabular-nums">s. {q.page}</span>}
                  {q.status === "solved" && <span className="text-ink">✓</span>}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob görüntüsü */}
                <img
                  src={imageUrl(q.image)}
                  alt="Soru"
                  className={`mt-1 max-h-40 w-full border border-rule object-contain object-top-left ${imageFilter(q.page)} ${
                    q.status === "solved" ? "opacity-50" : ""
                  }`}
                />
                {q.note && <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">{q.note}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {opened && (
        <QuestionViewer
          question={opened}
          canGoTo={opened.book === book && !!opened.page}
          onGoTo={() => {
            onGoTo(opened.page!);
            setOpenId(null);
          }}
          onAsk={() => {
            setOpenId(null);
            onAskImage(opened.image);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/** Soruyu büyük gösterir; klasörü/notu değiştirilir, çözüldü işaretlenir. */
function QuestionViewer({
  question: q,
  canGoTo,
  onGoTo,
  onAsk,
  onClose,
}: {
  question: Question;
  canGoTo: boolean;
  onGoTo: () => void;
  onAsk: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(q.note);
  const settings = useAiSettings();

  // Kapanırken değişen not kaydedilir
  const close = () => {
    if (note.trim() !== q.note) updateQuestion(q.id, { note: note.trim() });
    onClose();
  };

  return (
    <Modal label="Soru" onClose={close}>
      <div className="flex items-baseline gap-3 border-b border-rule px-6 py-3 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">
          {q.bookName?.replace(/\.pdf$/i, "") ?? "Yapıştırılan görüntü"}
          {q.page && ` · s. ${q.page}`} · {new Date(q.createdAt).toLocaleDateString("tr")}
        </span>
        <button onClick={close} className="hover:text-ink">
          Kapat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-paper p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob görüntüsü */}
        <img src={imageUrl(q.image)} alt="Soru" className={`mx-auto ${imageFilter(q.page)}`} />
      </div>
      <div className="grid grid-cols-[180px_1fr] gap-x-4 px-6 py-4 text-sm">
        <label className="block">
          <span className="text-xs text-muted">Klasör</span>
          <FolderPicker value={q.folderId ?? null} onChange={(folderId) => updateQuestion(q.id, { folderId })} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Not</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 border-t border-rule px-6 py-3 text-sm">
        <button
          onClick={() => {
            if (confirm("Bu soru silinsin mi?")) {
              removeQuestion(q.id);
              onClose();
            }
          }}
          className="text-muted hover:text-accent"
        >
          Sil
        </button>
        {canGoTo && (
          <button onClick={onGoTo} className="text-muted hover:text-ink">
            Sayfaya git
          </button>
        )}
        <button
          onClick={() => {
            if (!hasAiKey()) return openAiSettings();
            if (note.trim() !== q.note) updateQuestion(q.id, { note: note.trim() });
            onAsk();
          }}
          className="text-muted hover:text-ink"
        >
          {settings?.key ? "Sohbete sor" : AI_COPY.settings}
        </button>
        <button
          onClick={() => updateQuestion(q.id, { status: q.status === "solved" ? "open" : "solved" })}
          className={`ml-auto border px-4 py-1.5 transition-colors ${
            q.status === "solved"
              ? "border-rule text-muted hover:border-ink hover:text-ink"
              : "border-ink hover:bg-ink hover:text-sheet"
          }`}
        >
          {q.status === "solved" ? "Tekrar çözülmedi yap" : "Çözdüm ✓"}
        </button>
      </div>
      {!settings?.key && <p className="px-6 pb-3 text-xs text-muted">{AI_COPY.addKey}</p>}
    </Modal>
  );
}
