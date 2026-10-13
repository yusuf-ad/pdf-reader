"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  chapterAt,
  getBookInfo,
  getBookProfile,
  PAGE_TEXT_CHARS,
  profileHeadline,
  type BookContext,
} from "@/lib/book-context";
import { splitSuggestions, type ChatMessage, type Reference } from "@/lib/chat";
import { loadGeneratedToc } from "@/lib/generated-toc";
import { getPageText } from "@/lib/pdf-search";
import { parseSkill, SKILLS, skillLabel, type SkillRequest } from "@/lib/skills";

const MAX_IMAGES = 4;
// Büyük ekran görüntüleri bu boyuta küçültülür (istek küçük kalsın, yazı yine okunur)
const MAX_IMAGE_SIDE = 2000;

/** Görseli küçültüp JPEG data URL'e çevirir. */
async function toImagePart(file: File): Promise<FileUIPart> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // saydam PNG'ler siyaha dönmesin
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    type: "file",
    mediaType: "image/jpeg",
    filename: file.name || "ekran-goruntusu.jpg",
    url: canvas.toDataURL("image/jpeg", 0.9),
  };
}

const imagesIn = (files: Iterable<File>) => [...files].filter((f) => f.type.startsWith("image/"));

type Props = {
  open: boolean;
  onClose: () => void;
  /** Bir sonraki soruya eklenecek seçili metin */
  reference: Reference | null;
  onClearReference: () => void;
  /** Her dosyanın sohbeti ayrı tutulur */
  chatId: string;
  title: string | null;
  /** Skill'ler (/ozet, /sayfa) belge metnini buradan okur */
  pdf: PDFDocumentProxy | null;
  book: string | null;
  currentPage: number;
};

// Az metinli sayfalar boş sayılır (taranmış, OCR yapılmamış)
const MIN_PAGE_CHARS = 20;

export default function ChatModal(props: Props) {
  // Sohbet kapatılınca kaybolmasın diye bileşen hep bağlı kalır, yalnızca gizlenir
  return (
    <div
      className={`fixed inset-0 z-40 items-center justify-center bg-ink/25 ${props.open ? "flex" : "hidden"}`}
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <ChatWindow key={props.chatId} {...props} />
    </div>
  );
}

function ChatWindow({ open, onClose, reference, onClearReference, chatId, title, pdf, book, currentPage }: Props) {
  const [profile, setProfile] = useState<string | null>(null);

  // Sohbet ilk açıldığında kitabı tanı (profil bir kez çıkarılıp saklanır)
  useEffect(() => {
    if (!open || !pdf || !book) return;
    let active = true;
    getBookProfile(pdf, book, title, (p) => getPageText(pdf, p, book)).then((p) => {
      if (active) setProfile(p);
    });
    return () => {
      active = false;
    };
  }, [open, pdf, book, title]);

  /** Her isteğe eklenen kitap bilgisi: künye, profil, açık bölüm ve sayfa. */
  const bookBody = async (): Promise<{ book?: BookContext }> => {
    if (!pdf || !book) return {};
    const [info, profile, pageText] = await Promise.all([
      getBookInfo(pdf),
      getBookProfile(pdf, book, title, (p) => getPageText(pdf, p, book)),
      getPageText(pdf, currentPage, book).catch(() => ""),
    ]);
    return {
      book: {
        fileName: title,
        title: info.title,
        author: info.author,
        profile,
        page: currentPage,
        numPages: pdf.numPages,
        // Gömülü içindekiler yoksa kullanıcının oluşturduğu içindekiler
        chapter: chapterAt(info.outline.length ? info.outline : (loadGeneratedToc(book) ?? []), currentPage),
        pageText: pageText.trim().slice(0, PAGE_TEXT_CHARS) || null,
      },
    };
  };

  const { messages, sendMessage, status, stop, error, regenerate, setMessages } = useChat<ChatMessage>({
    id: chatId,
    // Akış sırasında arayüzü her parçada değil en fazla 50 ms'de bir güncelle
    throttle: 50,
  });
  const [input, setInput] = useState("");
  const [images, setImages] = useState<FileUIPart[]>([]);
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Kullanıcı yukarı kaydırdıysa yeni gelen cevap onu aşağı çekmesin
  const stickRef = useRef(true);
  // Skill için sayfalar okunurken ilerleme
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelReadRef = useRef(false);
  // Kitap bilgisi hazırlanırken (ilk soruda profil çıkarılıyor olabilir)
  const [preparing, setPreparing] = useState(false);
  const busy = status === "submitted" || status === "streaming" || reading !== null || preparing;

  /** Mesajı kitap bilgisiyle birlikte gönderir. */
  const send = async (message: Parameters<typeof sendMessage>[0]) => {
    setPreparing(true);
    let body: object = {};
    try {
      body = await bookBody();
    } catch {
      // Kitap bilgisi okunamazsa soru yine gider
    } finally {
      setPreparing(false);
    }
    await sendMessage(message, { body });
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, reference]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, reading]);

  const stopAll = useCallback(() => {
    cancelReadRef.current = true;
    stop();
  }, [stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (busy) stopAll();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, stopAll, onClose]);

  const addImages = async (files: File[]) => {
    const picked = imagesIn(files);
    if (!picked.length) return;
    const parts = await Promise.all(picked.map((f) => toImagePart(f).catch(() => null)));
    setImages((prev) => [...prev, ...parts.filter((p) => p !== null)].slice(0, MAX_IMAGES));
    inputRef.current?.focus();
  };

  /** Skill'in istediği sayfaları okuyup belge metniyle birlikte gönderir. */
  const runSkill = async (text: string, name: SkillRequest["name"], from: number, to: number) => {
    if (!pdf) return;
    cancelReadRef.current = false;
    const pages: SkillRequest["pages"] = [];
    const emptyPages: number[] = [];
    const total = to - from + 1;
    setReading({ done: 0, total });
    try {
      for (let p = from; p <= to; p++) {
        if (cancelReadRef.current) return;
        const pageText = (await getPageText(pdf, p, book)).trim();
        if (pageText.length < MIN_PAGE_CHARS) emptyPages.push(p);
        else pages.push({ page: p, text: pageText });
        setReading({ done: p - from + 1, total });
      }
    } catch (e) {
      setNotice(`PDF okunamadı: ${e instanceof Error ? e.message : e}`);
      return;
    } finally {
      setReading(null);
    }
    send({ text, metadata: { skill: { name, from, to, fileName: title, pages, emptyPages } } });
  };

  const ask = (text: string) => {
    stickRef.current = true;
    setNotice(null);
    send({ text });
  };

  const submit = () => {
    const text = input.trim();
    if ((!text && !images.length) || busy) return;
    setNotice(null);
    if (text === "/clear") {
      setInput("");
      setMessages([]);
      return;
    }
    stickRef.current = true;
    const skill = parseSkill(text, pdf?.numPages ?? 0, currentPage);
    if (skill) {
      if ("error" in skill) return setNotice(skill.error);
      if (!pdf) return setNotice("Önce bir PDF aç.");
      setInput("");
      runSkill(text, skill.name, skill.from, skill.to);
      return;
    }
    setInput("");
    const metadata = reference ? { reference } : undefined;
    if (images.length) send(text ? { text, files: images, metadata } : { files: images, metadata });
    else send({ text, metadata });
    setImages([]);
    onClearReference();
  };

  return (
    <div
      role="dialog"
      aria-label="Sohbet"
      // Ekran görüntüsü yapıştır (Ctrl V) veya sürükle-bırak
      onPaste={(e) => {
        const files = imagesIn(e.clipboardData.files);
        if (!files.length) return;
        e.preventDefault();
        addImages(files);
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        addImages([...e.dataTransfer.files]);
      }}
      className="relative flex h-[min(80vh,760px)] w-[min(760px,92vw)] flex-col border border-rule bg-sheet shadow-[0_12px_40px_var(--shadow)]"
    >
      <header className="flex items-baseline gap-3 border-b border-rule px-5 py-3">
        <h2 className="font-serif text-lg">Sor</h2>
        {title && (
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted"
            title={profile ?? undefined}
          >
            {profile ? profileHeadline(profile) : title}
          </span>
        )}
        <div className="ml-auto flex shrink-0 gap-4 text-xs text-muted">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="hover:text-ink" disabled={busy}>
              Yeni sohbet
            </button>
          )}
          <button onClick={onClose} className="hover:text-ink">
            Kapat <Kbd>Esc</Kbd>
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
      >
        {messages.length === 0 && (
          <div className="py-8 text-sm leading-relaxed text-muted">
            <p>
              PDF&apos;te bir bölüm seç ve <Kbd>Ctrl K</Kbd> ile buraya ekle; o bölüm hakkında
              istediğini sor. Seçim yapmadan da sorabilirsin; açık sayfa ve bölüm otomatik eklenir.
            </p>
            <ul className="mt-3 space-y-1 font-serif text-[15px] text-ink/80">
              <li>“Bu cümleyi daha sade anlatır mısın?”</li>
              <li>“Buradaki dilbilgisi yapısı ne?”</li>
              <li>“Bahsedilen kişi kim, ne zaman yaşamış?”</li>
            </ul>
            <p className="mt-4">
              Hazır komutlar: <Kbd>/ozet</Kbd> tüm PDF&apos;i özetler (<Kbd>/ozet 10-25</Kbd> yalnızca
              o sayfaları), <Kbd>/sayfa</Kbd> açık sayfayı özetler.
            </p>
            <p className="mt-4">
              Ekran görüntüsü de ekleyebilirsin: <Kbd>Ctrl V</Kbd> ile yapıştır ya da buraya sürükle.
              İçindeki yazıyı okur, çevirir, açıklar.
            </p>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              // Öneriler yalnızca son cevabın altında, cevap bitince
              onSuggest={i === messages.length - 1 && !busy ? ask : undefined}
            />
          ))}

          {reading && (
            <p className="font-mono text-xs text-muted">
              PDF okunuyor… {reading.done}/{reading.total} sayfa
            </p>
          )}
          {preparing && !profile && <p className="animate-pulse font-mono text-xs text-muted">kitap tanınıyor…</p>}
          {status === "submitted" && (
            <p className="animate-pulse font-mono text-xs text-muted">
              {(messages.at(-1)?.metadata?.skill?.pages.length ?? 0) > 1
                ? "özetleniyor… (uzun belgelerde birkaç dakika sürebilir)"
                : "düşünüyor…"}
            </p>
          )}
          {notice && <p className="text-sm text-accent">{notice}</p>}
          {error && (
            <div className="text-sm text-accent">
              Cevap alınamadı: {error.message}{" "}
              <button onClick={async () => regenerate(await bookBody().then((body) => ({ body })).catch(() => ({})))} className="underline underline-offset-2">
                Tekrar dene
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-rule px-5 pt-3 pb-2">
        {reference ? (
          <div className="mb-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ReferenceQuote reference={reference} />
            </div>
            <button
              onClick={onClearReference}
              className="text-xs text-muted hover:text-accent"
              aria-label="Seçili metni kaldır"
            >
              Kaldır
            </button>
          </div>
        ) : (
          <p className="mb-2 text-xs text-muted">
            Referans yok. PDF&apos;te seçip <Kbd>Ctrl K</Kbd> ile ekleyebilirsin.
          </p>
        )}
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel data URL */}
                <img src={img.url} alt={img.filename ?? ""} className="h-16 max-w-32 border border-rule object-cover" />
                <button
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Görseli kaldır"
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center bg-ink text-[10px] leading-none text-sheet opacity-0 transition-opacity group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/^\/\S*$/.test(input) && (
          <ul className="mb-2 space-y-0.5 text-sm">
            {SKILLS.filter((s) => s.usage.startsWith(input)).map((s) => (
              <li key={s.name}>
                <button
                  onClick={() => {
                    setInput(s.usage);
                    inputRef.current?.focus();
                  }}
                  className="flex w-full gap-3 text-left hover:text-ink"
                >
                  <span className="w-16 font-mono text-ink">{s.usage}</span>
                  <span className="text-muted">{s.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <span className="pb-1.5 font-mono text-muted select-none">›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, input.split("\n").length)}
            placeholder={
              images.length
                ? "Görsel hakkında sor (boş bırakırsan okuyup açıklar)…"
                : reference
                  ? "Seçili metin hakkında sor…"
                  : "Bir şey sor…"
            }
            className="flex-1 resize-none bg-transparent py-1 leading-relaxed outline-none placeholder:text-muted"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={images.length >= MAX_IMAGES}
            title="Görsel ekle (Ctrl V ile yapıştır, sürükle-bırak)"
            className="pb-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
          >
            Görsel ekle
          </button>
          {busy && (
            <button onClick={stopAll} className="pb-1.5 text-xs text-muted hover:text-accent">
              Durdur
            </button>
          )}
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          enter gönder · shift+enter yeni satır · ctrl+v görsel yapıştır · /ozet · /sayfa · /clear sohbeti temizle · esc {busy ? "durdur" : "kapat"}
        </p>
      </div>

      {dropping && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center border border-dashed border-ink/40 bg-sheet/90 font-serif text-lg">
          Görseli bırak
        </div>
      )}
    </div>
  );
}

// Yazarken, akış sırasında veya okuyucu her yeniden çizildiğinde eski mesajlar
// (ve markdown'ları) baştan işlenmesin; yalnızca değişen mesaj yeniden çizilir
const Message = memo(function Message({
  message: m,
  onSuggest,
}: {
  message: ChatMessage;
  onSuggest?: (text: string) => void;
}) {
  const text = textOf(m);
  if (m.role !== "user") {
    const { body, suggestions } = splitSuggestions(text);
    return (
      <div>
        <div className="chat-md font-serif text-[16px] leading-relaxed">
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
        {onSuggest && suggestions.length > 0 && (
          <ul className="mt-3 space-y-1">
            {suggestions.map((q) => (
              <li key={q}>
                <button
                  onClick={() => onSuggest(q)}
                  className="w-full border border-rule px-3 py-1.5 text-left text-sm text-muted transition-colors hover:border-accent/60 hover:text-ink"
                >
                  <span className="mr-2 font-mono text-accent">›</span>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {m.metadata?.reference && <ReferenceQuote reference={m.metadata.reference} />}
      {m.metadata?.skill && <SkillNote skill={m.metadata.skill} />}
      <MessageImages images={m.parts.filter((p) => p.type === "file")} />
      {text && (
        <div className="flex gap-2">
          <span className="font-mono text-muted select-none">›</span>
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
});

function MessageImages({ images }: { images: FileUIPart[] }) {
  // Tıklayınca büyür / küçülür
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pl-4">
      {images.map((img, i) => (
        <button key={i} onClick={() => setOpen(open === i ? null : i)} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- yerel data URL */}
          <img
            src={img.url}
            alt={img.filename ?? "Görsel"}
            decoding="async"
            className={`border border-rule ${open === i ? "max-h-[60vh] max-w-full" : "max-h-40 max-w-60 object-cover"}`}
          />
        </button>
      ))}
    </div>
  );
}

function ReferenceQuote({ reference }: { reference: Reference }) {
  const words = reference.text.split(/\s+/).length;
  return (
    <div className="border-l-2 border-accent/60 pl-3">
      <p className="text-[11px] text-muted">
        Seçili metin{reference.page && ` · s. ${reference.page}`}
        {words > 1 && ` · ${words} kelime`}
      </p>
      <p className="line-clamp-3 font-serif text-[15px] leading-snug text-ink/80">
        {reference.text}
      </p>
    </div>
  );
}

function SkillNote({ skill }: { skill: SkillRequest }) {
  return (
    <p className="border-l-2 border-accent/60 pl-3 text-[11px] text-muted">
      {skillLabel(skill)}
      {skill.emptyPages.length > 0 && ` · ${skill.emptyPages.length} sayfada metin yok (taranmış, OCR yapılmamış)`}
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-rule px-1 py-px font-mono text-[11px] text-muted">{children}</kbd>
  );
}

const textOf = (m: ChatMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
