"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  chapterAt,
  getBookInfo,
  getBookProfile,
  PAGE_TEXT_CHARS,
  profileHeadline,
  type BookContext,
} from "@/lib/book-context";
import {
  deleteSession,
  latestSession,
  loadSession,
  newSessionId,
  saveSession,
  useChatSessions,
  type ChatSession,
} from "@/lib/chat-history";
import { addChatNote, removeChatNote, useChatNotes } from "@/lib/chat-notes";
import {
  isWebSearchPart,
  splitSuggestions,
  type ChatMessage,
  type Reference,
} from "@/lib/chat";
import { loadGeneratedToc } from "@/lib/generated-toc";
import {
  isChangeActive,
  MEMORY_MAX_CHARS,
  MEMORY_MAX_ITEMS,
  type MemoryChange,
} from "@/lib/memory";
import {
  addMemory,
  applyChanges,
  editMemory,
  memoryBody,
  removeMemory,
  revertChanges,
  setMemoryEnabled,
  useMemory,
  useMemoryEnabled,
} from "@/lib/memory-store";
import { getMarksText } from "@/lib/marks";
import { renderMarkedPage } from "@/lib/page-image";
import { getPageText } from "@/lib/pdf-search";
import { bookKey, get, set } from "@/lib/storage";
import {
  parseQuizRequest,
  parseSkill,
  parseCheckRequest,
  parseMarkRequest,
  parseWordsRequest,
  SKILLS,
  skillLabel,
  type SkillRequest,
} from "@/lib/skills";
import Quiz from "./quiz";
import type { MarkInput } from "@/lib/page-marks";
import { MarkCard } from "./ai-marker";
import { NoteCard } from "./note-writer";
import WordProposal from "./word-proposal";

const MAX_IMAGES = 4;
// Büyük ekran görüntüleri bu boyuta küçültülür (istek küçük kalsın, yazı yine okunur)
const MAX_IMAGE_SIDE = 2000;

const profileStore = (book: string) => ({
  get: () => get<string>(bookKey("profile", book)),
  set: (profile: string) => set(bookKey("profile", book), profile),
});

/** Görseli küçültüp JPEG data URL'e çevirir. */
async function toImagePart(file: File): Promise<FileUIPart> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height),
  );
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

const imagesIn = (files: Iterable<File>) =>
  [...files].filter((f) => f.type.startsWith("image/"));

type Props = {
  open: boolean;
  onClose: () => void;
  /** Bir sonraki soruya eklenecek seçili metin */
  reference: Reference | null;
  onClearReference: () => void;
  /** Her dosyanın sohbeti ayrı tutulur */
  chatId: string;
  title: string | null;
  /** Açık dosyanın tam adı; sohbetten eklenen kelimeler buna bağlanır */
  fileName: string | null;
  /** Skill'ler (/ozet, /sayfa) belge metnini buradan okur */
  pdf: PDFDocumentProxy | null;
  book: string | null;
  currentPage: number;
  /** Sohbete eklenecek görsel (kırpılan soru); eklenince onImageTaken çağrılır */
  pendingImage?: File | null;
  onImageTaken?: () => void;
  /** Test açıklamasındaki sayfa bağlantısı */
  onGoTo?: (page: number) => void;
  /** Yanlış soruları sayfada işaretlet (sohbet küçülür, asistan imleci gezer) */
  onMarkQuestions?: (id: string, input: MarkInput) => void;
};

const IMAGE_PROMPT = "Bu soruyu çöz ve adım adım açıkla.";

// Az metinli sayfalar boş sayılır (taranmış, OCR yapılmamış)
const MIN_PAGE_CHARS = 20;

export default function ChatModal(props: Props) {
  // Açık sohbet; PDF değişince o kitabın en son sohbeti açılır
  const [session, setSession] = useState(() => ({
    chatId: props.chatId,
    id: latestSession(props.chatId)?.id ?? newSessionId(),
  }));
  if (session.chatId !== props.chatId) {
    setSession({
      chatId: props.chatId,
      id: latestSession(props.chatId)?.id ?? newSessionId(),
    });
  }
  const openSession = useCallback(
    (id: string) => setSession({ chatId: props.chatId, id }),
    [props.chatId],
  );

  // Sohbet kapatılınca kaybolmasın diye bileşen hep bağlı kalır, yalnızca gizlenir
  return (
    <div
      className={`fixed inset-0 z-40 items-center justify-center bg-scrim ${props.open ? "flex" : "hidden"}`}
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <ChatWindow
        key={`${props.chatId}:${session.id}`}
        {...props}
        sessionId={session.id}
        onOpenSession={openSession}
      />
    </div>
  );
}

function ChatWindow({
  sessionId,
  onOpenSession,
  open,
  onClose,
  reference,
  onClearReference,
  chatId,
  title,
  fileName,
  pdf,
  book,
  currentPage,
  pendingImage,
  onImageTaken,
  onGoTo,
  onMarkQuestions,
}: Props & { sessionId: string; onOpenSession: (id: string) => void }) {
  const [profile, setProfile] = useState<string | null>(null);

  // Sohbet ilk açıldığında kitabı tanı (profil bir kez çıkarılıp saklanır)
  useEffect(() => {
    if (!open || !pdf || !book) return;
    let active = true;
    getBookProfile(
      pdf,
      book,
      title,
      (p) => getPageText(pdf, p, book),
      profileStore(book),
    ).then((p) => {
      if (active) setProfile(p);
    });
    return () => {
      active = false;
    };
  }, [open, pdf, book, title]);

  // Açık sayfa chip'i: kaldırılırsa yalnızca o sayfa için kapalı kalır, sayfa değişince ya da gönderince geri gelir
  const [pageOffAt, setPageOffAt] = useState<number | null>(null);
  const pageOff = pageOffAt === currentPage;
  const pagePreview = usePagePreview(open, pdf, book, currentPage);

  /** Her isteğe eklenen kitap bilgisi: künye, profil, açık bölüm ve sayfa (chip kaldırıldıysa sayfa metni ve işaretleri olmadan). */
  const bookBody = async (): Promise<{ book?: BookContext }> => {
    if (!pdf || !book) return {};
    const [info, profile, pageText, marks] = await Promise.all([
      getBookInfo(pdf),
      getBookProfile(
        pdf,
        book,
        title,
        (p) => getPageText(pdf, p, book),
        profileStore(book),
      ),
      pageOff ? "" : getPageText(pdf, currentPage, book).catch(() => ""),
      pageOff ? null : getMarksText(pdf, book, currentPage).catch(() => null),
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
        chapter: chapterAt(
          info.outline.length ? info.outline : (loadGeneratedToc(book) ?? []),
          currentPage,
        ),
        pageText: pageText.trim().slice(0, PAGE_TEXT_CHARS) || null,
        marks,
      },
    };
  };

  const { messages, sendMessage, status, stop, error, regenerate } =
    useChat<ChatMessage>({
      id: chatId,
      // Kaydedilmiş sohbet kaldığı yerden devam eder (bileşen sohbet değişince yeniden kurulur)
      messages: loadSession(chatId, sessionId),
      // Akış sırasında arayüzü her parçada değil en fazla 50 ms'de bir güncelle
      throttle: 50,
      // Modelin hafıza değişiklikleri cevap bitince yerel hafızaya yazılır
      onFinish: ({ message }) => applyChanges(memoryChangesOf(message)),
    });

  // Cevap bitince (akış sırasında her parçada değil) sohbeti kaydet
  const savedRef = useRef(messages);
  useEffect(() => {
    if (
      status === "submitted" ||
      status === "streaming" ||
      savedRef.current === messages
    )
      return;
    savedRef.current = messages;
    saveSession(chatId, sessionId, messages);
  }, [chatId, sessionId, messages, status]);
  const sessions = useChatSessions(chatId);
  // Sohbetin yerinde açılan liste
  const [panel, setPanel] = useState<"history" | "memory" | null>(null);
  const showHistory = panel === "history";
  const memory = useMemory();
  const newChat = () => onOpenSession(newSessionId());
  const [input, setInput] = useState("");
  const [images, setImages] = useState<FileUIPart[]>([]);
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Kullanıcı yukarı kaydırdıysa yeni gelen cevap onu aşağı çekmesin
  const stickRef = useRef(true);
  // Skill için sayfalar okunurken ilerleme
  const [reading, setReading] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelReadRef = useRef(false);
  // Kitap bilgisi hazırlanırken (ilk soruda profil çıkarılıyor olabilir)
  const [preparing, setPreparing] = useState(false);
  const busy =
    status === "submitted" ||
    status === "streaming" ||
    reading !== null ||
    preparing;
  const chatNotes = useChatNotes(book);
  // toggleNote her akış parçasında değişmesin (mesajlar memo'lu)
  const latestRef = useRef({ messages, chatNotes, book, currentPage });
  useEffect(() => {
    latestRef.current = { messages, chatNotes, book, currentPage };
  });

  /** Cevabı, sorulan soruyla ve sayfasıyla birlikte notlara ekler ya da çıkarır. */
  const toggleNote = useCallback((index: number) => {
    const { messages, chatNotes, book, currentPage } = latestRef.current;
    const answer = messages[index];
    if (!book || !answer) return;
    if (chatNotes.some((n) => n.messageId === answer.id))
      return removeChatNote(book, answer.id);
    const asked = messages[index - 1];
    const meta = asked?.metadata;
    const question = meta?.skill
      ? skillLabel(meta.skill)
      : [meta?.reference?.text, asked ? textOf(asked) : ""]
          .filter(Boolean)
          .join(" — ");
    addChatNote(book, {
      messageId: answer.id,
      text: splitSuggestions(textOf(answer)).body,
      question: question.slice(0, 300),
      page:
        meta?.reference?.page ?? meta?.page ?? (meta?.skill ? null : currentPage),
    });
  }, []);

  /** Mesajı kitap bilgisiyle birlikte gönderir. */
  const send = async (message: Parameters<typeof sendMessage>[0]) => {
    setPreparing(true);
    let body: object = memoryBody();
    try {
      body = { ...body, ...(await bookBody()) };
    } catch {
      // Kitap bilgisi okunamazsa soru yine gider
    } finally {
      setPreparing(false);
    }
    await sendMessage(message, { body });
  };

  // Mesajlar memo'lu: düzenle / yeniden sor her çizimde değişmesin
  const resendRef = useRef<(id: string, text?: string) => void>(() => {});
  const resendNow = async (id: string, text?: string) => {
    const asked = messages.find((m) => m.id === id);
    if (!asked) return;
    stickRef.current = true;
    setNotice(null);
    if (text === undefined) {
      // Aynı soru: sonrasındaki cevaplar silinip yeniden sorulur
      setPreparing(true);
      let body: object = memoryBody();
      try {
        body = { ...body, ...(await bookBody()) };
      } catch {
        // Kitap bilgisi okunamazsa soru yine gider
      } finally {
        setPreparing(false);
      }
      await regenerate({ messageId: id, body });
      return;
    }
    // Düzenlenen soru yerinde değişir; görselleri ve seçili metni korunur
    const files = asked.parts.filter((p) => p.type === "file");
    const metadata = asked.metadata?.skill
      ? asked.metadata
      : { ...asked.metadata, page: pageOff ? undefined : currentPage };
    send({ text, files, metadata, messageId: id });
  };
  useEffect(() => {
    resendRef.current = resendNow;
  });
  const resend = useCallback(
    (id: string, text?: string) => resendRef.current(id, text),
    [],
  );

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
      else if (panel) setPanel(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, panel, stopAll, onClose]);

  const addImages = async (files: File[]) => {
    const picked = imagesIn(files);
    if (!picked.length) return;
    const parts = await Promise.all(
      picked.map((f) => toImagePart(f).catch(() => null)),
    );
    setImages((prev) =>
      [...prev, ...parts.filter((p) => p !== null)].slice(0, MAX_IMAGES),
    );
    inputRef.current?.focus();
  };

  // Kırpılan soru: görsel eklenir, hazır soru seçili gelir (Enter: gönder, yazınca değişir)
  useEffect(() => {
    if (!pendingImage) return;
    onImageTaken?.();
    toImagePart(pendingImage)
      .then((part) => {
        setImages((prev) => [...prev, part].slice(-MAX_IMAGES));
        setInput((prev) => prev || IMAGE_PROMPT);
        requestAnimationFrame(() => inputRef.current?.select());
      })
      .catch(() => {});
  }, [pendingImage, onImageTaken]);

  /** Skill'in istediği sayfaları okuyup belge metniyle birlikte gönderir. */
  const runSkill = async (
    text: string,
    name: SkillRequest["name"],
    from: number,
    to: number,
    extra?: Pick<SkillRequest, "count" | "request">,
  ) => {
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
    // Cevap kontrolü: kalemle işaretlenen şıklar metinde yok; sayfa işaretleriyle görsel olarak gider
    let files: FileUIPart[] = [];
    if (name === "kontrol" && book) {
      try {
        files = [await renderMarkedPage(pdf, book, from)];
      } catch {
        return setNotice("Sayfanın görüntüsü alınamadı.");
      }
    }
    const metadata = {
      skill: { name, from, to, fileName: title, pages, emptyPages, ...extra },
    };
    send(files.length ? { text, files, metadata } : { text, metadata });
  };

  const ask = (text: string) => {
    stickRef.current = true;
    setNotice(null);
    send({ text });
  };

  const submit = () => {
    // Referans varken boş gönderilirse açıklama istenir (kelime listesinden hızlı sorma)
    const text =
      input.trim() ||
      (reference && !images.length ? explainPrompt(reference) : "");
    if ((!text && !images.length) || busy) return;
    setNotice(null);
    if (text === "/clear") {
      setInput("");
      if (messages.length) newChat();
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
    // "15 soruluk test hazırla" gibi komutsuz test isteği: sayfa belirtilmediyse tüm PDF okunur.
    // Seçili metin ya da görsel varsa test onlardan hazırlanır (normal soru gibi gider).
    const quiz =
      !reference && !images.length && pdf
        ? parseQuizRequest(text, pdf.numPages, currentPage)
        : null;
    if (quiz) {
      setInput("");
      runSkill(text, "test", quiz.from, quiz.to, {
        count: quiz.count,
        request: text,
      });
      return;
    }
    // "bu PDF'teki zıtlık bağlaçlarını kelimelere ekle": sayfalar okunur, öneriler önizlemeyle gelir
    const words =
      !reference && !images.length && pdf
        ? parseWordsRequest(text, pdf.numPages, currentPage)
        : null;
    if (words) {
      setInput("");
      runSkill(text, "kelime", words.from, words.to, { request: text });
      return;
    }
    // "3, 7 ve 12'yi yanlış yaptım işaretle": sayfa tam okunur, model çözüp işaretletir
    const mark =
      !reference && !images.length && pdf && onMarkQuestions
        ? parseMarkRequest(text, pdf.numPages, currentPage)
        : null;
    if (mark) {
      setInput("");
      runSkill(text, "isaretle", mark.page, mark.page, { request: text });
      return;
    }
    // "işaretlediğim soruları kontrol et": sayfa işaretleriyle görsel olarak gider, model yanlışları bulur
    const check =
      !reference && !images.length && pdf && onMarkQuestions
        ? parseCheckRequest(text, pdf.numPages, currentPage)
        : null;
    if (check) {
      setInput("");
      runSkill(text, "kontrol", check.page, check.page, { request: text });
      return;
    }
    setInput("");
    // Chip kaldırıldıysa seçimle gelen sayfa metni de gitmez
    const metadata = {
      ...(reference && {
        reference: pageOff ? { ...reference, pageText: undefined } : reference,
      }),
      ...(!pageOff && { page: currentPage }),
    };
    if (images.length)
      send(
        text ? { text, files: images, metadata } : { files: images, metadata },
      );
    else send({ text, metadata });
    setImages([]);
    onClearReference();
    setPageOffAt(null);
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
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        addImages([...e.dataTransfer.files]);
      }}
      className="relative flex h-[min(80vh,760px)] w-[min(760px,92vw)] flex-col border border-rule bg-sheet shadow-[0_12px_40px_var(--shadow)]"
    >
      <header className="flex items-baseline gap-3 border-b border-rule px-6 py-3">
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
          <button
            onClick={() => setPanel((v) => (v === "memory" ? null : "memory"))}
            className={panel === "memory" ? "text-ink" : "hover:text-ink"}
            title="Sana dair hatırladıkları; tüm kitaplarda geçerli"
          >
            Hafıza{memory.length > 0 && ` (${memory.length})`}
          </button>
          {sessions.length > 0 && (
            <button
              onClick={() =>
                setPanel((v) => (v === "history" ? null : "history"))
              }
              className={showHistory ? "text-ink" : "hover:text-ink"}
              disabled={busy}
            >
              Geçmiş ({sessions.length})
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={newChat}
              className="hover:text-ink"
              disabled={busy}
            >
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
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6"
      >
        {/* Okuma ölçüsü: satırlar ~70 karakteri geçmesin */}
        <div className="mx-auto max-w-[70ch]">
          {panel && (
            <div className="mb-4 flex items-baseline gap-3 border-b border-rule pb-2">
              <h3 className="flex-1 font-serif text-base">
                {panel === "memory" ? "Hafıza" : "Geçmiş sohbetler"}
              </h3>
              <button
                onClick={() => setPanel(null)}
                className="text-xs text-muted hover:text-ink"
              >
                ← Sohbete dön <Kbd>Esc</Kbd>
              </button>
            </div>
          )}
          {showHistory && (
            <History
              sessions={sessions}
              current={sessionId}
              onOpen={(id) => {
                setPanel(null);
                if (id !== sessionId) onOpenSession(id);
              }}
              onDelete={(id) => {
                if (id === sessionId) newChat();
                deleteSession(chatId, id);
              }}
            />
          )}

          {panel === "memory" && <MemoryPanel items={memory} />}

          {!panel && messages.length === 0 && (
            <div className="py-8 text-sm leading-relaxed text-muted">
              <p>
                PDF&apos;te bir bölüm seç ve <Kbd>Ctrl K</Kbd> ile buraya ekle;
                o bölüm hakkında istediğini sor. Seçim yapmadan da sorabilirsin;
                açık sayfa ve bölüm otomatik eklenir.
              </p>
              <ul className="mt-3 space-y-1 font-serif text-[15px] text-ink/80">
                <li>“Bu cümleyi daha sade anlatır mısın?”</li>
                <li>“Buradaki dilbilgisi yapısı ne?”</li>
                <li>“Bahsedilen kişi kim, ne zaman yaşamış?”</li>
              </ul>
              <p className="mt-4">
                Hazır komutlar: <Kbd>/ozet</Kbd> tüm PDF&apos;i özetler (
                <Kbd>/ozet 10-25</Kbd> yalnızca o sayfaları), <Kbd>/sayfa</Kbd>{" "}
                açık sayfayı özetler, <Kbd>/test</Kbd> tüm PDF&apos;ten çoktan
                seçmeli test hazırlar (<Kbd>/test 10-25</Kbd> yalnızca o
                sayfalardan). “15 soruluk test hazırla”, “bu sayfadan test yap”
                gibi yazarak da isteyebilirsin.
              </p>
              <p className="mt-4">
                Test çözdüysen şıklarını kalemle işaretleyip “cevaplarımı
                kontrol et” yaz: işaretlerini sayfadan okur, yanlışlarının
                numarasını sarı, doğru şıkkı yeşil işaretler ve yanına kısa not
                yazar. Yanlışlarını biliyorsan “3 ve 7&apos;yi yanlış yaptım,
                işaretle” de diyebilirsin.
              </p>
              <p className="mt-4">
                Ekran görüntüsü de ekleyebilirsin: <Kbd>Ctrl V</Kbd> ile
                yapıştır ya da buraya sürükle. İçindeki yazıyı okur, çevirir,
                açıklar.
              </p>
            </div>
          )}

          <div className={`flex-col gap-6 ${panel ? "hidden" : "flex"}`}>
            {messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                index={i}
                // Cevap bitmeden nota alınmasın
                onToggleNote={
                  book && !(busy && i === messages.length - 1)
                    ? toggleNote
                    : undefined
                }
                saved={chatNotes.some((n) => n.messageId === m.id)}
                // Öneriler yalnızca son cevabın altında, cevap bitince
                onSuggest={i === messages.length - 1 && !busy ? ask : undefined}
                streaming={busy && i === messages.length - 1}
                onResend={busy ? undefined : resend}
                fileName={fileName}
                book={book}
                onGoTo={onGoTo}
                onMark={onMarkQuestions}
              />
            ))}

            {reading && (
              <p className="font-mono text-xs text-muted">
                PDF okunuyor… {reading.done}/{reading.total} sayfa
              </p>
            )}
            {preparing && !profile && (
              <p className="animate-pulse font-mono text-xs text-muted">
                kitap tanınıyor…
              </p>
            )}
            {status === "submitted" && (
              <p className="animate-pulse font-mono text-xs text-muted">
                {messages.at(-1)?.metadata?.skill?.name === "test"
                  ? "test hazırlanıyor…"
                  : messages.at(-1)?.metadata?.skill?.name === "kelime"
                    ? "kelimeler aranıyor…"
                    : (messages.at(-1)?.metadata?.skill?.pages.length ?? 0) > 1
                      ? "özetleniyor… (uzun belgelerde birkaç dakika sürebilir)"
                      : "düşünüyor…"}
              </p>
            )}
            {notice && <p className="text-sm text-accent">{notice}</p>}
            {error && (
              <div className="text-sm text-accent">
                Cevap alınamadı: {error.message}{" "}
                <button
                  onClick={async () =>
                    regenerate({
                      body: {
                        ...memoryBody(),
                        ...(await bookBody().catch(() => ({}))),
                      },
                    })
                  }
                  className="underline underline-offset-2"
                >
                  Tekrar dene
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hafıza / geçmiş açıkken soru alanı gizlenir; yazılan taslak kaybolmasın diye bağlı kalır */}
      <div
        className={`border-t border-rule px-6 pt-3 pb-3 ${panel ? "hidden" : ""}`}
      >
        <div className="mx-auto max-w-[70ch]">
          {pdf && (
            <div className="mb-2 flex items-baseline gap-3 text-xs">
              <PageChip
                page={currentPage}
                preview={pagePreview?.page === currentPage ? pagePreview : null}
                off={pageOff}
                onToggle={() => {
                  setPageOffAt(pageOff ? null : currentPage);
                  inputRef.current?.focus();
                }}
              />
              {!reference && messages.length === 0 && (
                <span className="ml-auto text-muted">
                  Seçip <Kbd>Ctrl K</Kbd> ile metin ekleyebilirsin.
                </span>
              )}
            </div>
          )}
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
            !pdf &&
            messages.length === 0 && (
              <p className="mb-2 text-xs text-muted">
                Referans yok. PDF&apos;te seçip <Kbd>Ctrl K</Kbd> ile
                ekleyebilirsin.
              </p>
            )
          )}
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- yerel data URL */}
                  <img
                    src={img.url}
                    alt={img.filename ?? ""}
                    className="h-16 max-w-32 border border-rule object-cover"
                  />
                  <button
                    onClick={() =>
                      setImages((prev) => prev.filter((_, j) => j !== i))
                    }
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
          <div className="flex items-end gap-3 border border-rule bg-paper px-3 py-2 transition-colors focus-within:border-muted">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={Math.min(6, input.split("\n").length)}
              placeholder={
                images.length
                  ? "Görsel hakkında sor (boş bırakırsan okuyup açıklar)…"
                  : reference
                    ? "Seçili metin hakkında sor (boş bırakıp Enter: açıkla)…"
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
              className="pb-1 text-xs text-muted hover:text-ink disabled:opacity-40"
            >
              Görsel ekle
            </button>
            {busy && (
              <button
                onClick={stopAll}
                className="pb-1 text-xs text-muted hover:text-accent"
              >
                Durdur
              </button>
            )}
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted">
            enter gönder, shift+enter yeni satır, / komutlar, esc{" "}
            {busy ? "durdur" : "kapat"}
          </p>
        </div>
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
  index,
  onSuggest,
  onToggleNote,
  saved,
  streaming,
  onResend,
  fileName,
  book,
  onGoTo,
  onMark,
}: {
  message: ChatMessage;
  index: number;
  onSuggest?: (text: string) => void;
  onToggleNote?: (index: number) => void;
  saved: boolean;
  /** Cevap hâlâ yazılıyor */
  streaming: boolean;
  /** Soruyu yeniden sorar; metin verilirse soru önce onunla değiştirilir */
  onResend?: (id: string, text?: string) => void;
  fileName: string | null;
  book: string | null;
  onGoTo?: (page: number) => void;
  onMark?: (id: string, input: MarkInput) => void;
}) {
  const text = textOf(m);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  if (m.role !== "user") {
    const { body, suggestions } = splitSuggestions(text);
    const searching =
      streaming &&
      m.parts.some((p) => isWebSearchPart(p) && !("output" in p && p.output));
    const sources = [
      ...new Map(
        m.parts.flatMap((p) =>
          p.type === "source-url" ? [[p.url, p] as const] : [],
        ),
      ).values(),
    ];
    return (
      <div>
        <p className="mt-1.5 mb-1.5 text-[11px] tracking-[0.12em] text-accent uppercase">
          Cevap
        </p>
        {searching && (
          <p className="mb-2 animate-pulse font-mono text-xs text-muted">
            web&apos;de aranıyor…
          </p>
        )}
        {body && (
          <div
            ref={bodyRef}
            className="chat-md font-serif text-[17px] leading-[1.75]"
          >
            <ReactMarkdown>{body}</ReactMarkdown>
          </div>
        )}
        {/* Generative UI: model createQuiz aracını çağırdıysa test kartı, proposeWords çağırdıysa kelime önizlemesi çizilir */}
        {m.parts.map((p) =>
          p.type === "tool-createQuiz" ? (
            <div key={p.toolCallId} className={body ? "mt-3" : ""}>
              <Quiz
                id={p.toolCallId}
                input={p.input}
                ready={
                  p.state === "input-available" ||
                  p.state === "output-available"
                }
                error={p.state === "output-error" ? p.errorText : undefined}
                onGoTo={onGoTo}
              />
            </div>
          ) : p.type === "tool-proposeWords" ? (
            // Kelime önerisi: kullanıcı önizlemede seçip onaylayınca eklenir
            <div key={p.toolCallId} className={body ? "mt-3" : ""}>
              <WordProposal
                input={p.input}
                ready={
                  p.state === "input-available" ||
                  p.state === "output-available"
                }
                error={p.state === "output-error" ? p.errorText : undefined}
                fileName={fileName}
                onGoTo={onGoTo}
              />
            </div>
          ) : p.type === "tool-markQuestions" ? (
            // Yanlış soruları işaretleme: akış sırasında geldiyse sayfada kendiliğinden başlar
            <div key={p.toolCallId} className={body ? "mt-3" : ""}>
              <MarkCard
                id={p.toolCallId}
                input={p.input}
                ready={
                  p.state === "input-available" ||
                  p.state === "output-available"
                }
                streaming={streaming}
                book={book}
                error={p.state === "output-error" ? p.errorText : undefined}
                onRun={onMark}
                onGoTo={onGoTo}
              />
            </div>
          ) : p.type === "tool-writeNote" ? (
            // Sayfadaki nota ekleme: akış sırasında geldiyse not kendiliğinden yazılır
            <div key={p.toolCallId} className={body ? "mt-3" : ""}>
              <NoteCard
                id={p.toolCallId}
                input={p.input}
                ready={
                  p.state === "input-available" ||
                  p.state === "output-available"
                }
                streaming={streaming}
                book={book}
                error={p.state === "output-error" ? p.errorText : undefined}
                onGoTo={onGoTo}
              />
            </div>
          ) : null,
        )}
        {sources.length > 0 && !streaming && <Sources sources={sources} />}
        {!streaming && <MemoryNote changes={memoryChangesOf(m)} />}
        {body && !streaming && (
          <div className="mt-3 flex gap-4 text-xs">
            <CopyButton markdown={body} htmlRef={bodyRef} />
            {onToggleNote && (
              <button
                onClick={() => onToggleNote(index)}
                title={
                  saved
                    ? "Notlardan çıkar"
                    : "Bu cevabı kelime panelindeki Notlar'a ekle"
                }
                className={`transition-colors ${saved ? "text-accent hover:text-ink" : "text-muted hover:text-ink"}`}
              >
                {saved ? "✓ Notlarda" : "+ Nota ekle"}
              </button>
            )}
          </div>
        )}
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
  const images = m.parts.filter((p) => p.type === "file");
  const saveEdit = () => {
    const next = draft?.trim() ?? "";
    if (!onResend || (!next && !images.length)) return;
    setDraft(null);
    onResend(m.id, next);
  };
  // Her soru-cevap çifti ince bir çizgiyle ayrılır. Soru kâğıt zeminli, solda koyu şeritli bir
  // blokta düz yazıyla; cevap altında sayfa zemininde serif metinle akar. İkisi de küçük etiketli.
  return (
    <div className={`group ${index > 0 ? "border-t border-rule pt-8" : ""}`}>
      <div className="border-l-[3px] border-ink bg-paper px-4 pt-2 pb-3">
        <div className="mb-1.5 flex h-5 items-baseline gap-4 text-xs">
          <span className="flex-1 text-[11px] tracking-[0.12em] text-muted uppercase">
            Soru
            {m.metadata?.page &&
              !m.metadata.reference &&
              !m.metadata.skill &&
              (onGoTo ? (
                <button
                  onClick={() => onGoTo(m.metadata!.page!)}
                  title="Bu soru sorulurken açık olan sayfaya git"
                  className="ml-2 tracking-normal normal-case hover:text-ink"
                >
                  · s. {m.metadata.page}
                </button>
              ) : (
                <span className="ml-2 tracking-normal normal-case">
                  · s. {m.metadata.page}
                </span>
              ))}
          </span>
          {draft === null && onResend && (
            <span className="flex gap-4 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {/* Komutla başlatılan özet/test isteğinde metin komutun kendisi; yalnızca yeniden sorulur */}
              {!m.metadata?.skill && (
                <button
                  onClick={() => setDraft(text)}
                  title="Soruyu düzenleyip yeniden gönder"
                  className="text-muted hover:text-ink"
                >
                  Düzenle
                </button>
              )}
              <button
                onClick={() => onResend(m.id)}
                title="Aynı soruyu yeniden sor (sonraki cevaplar silinir)"
                className="text-muted hover:text-ink"
              >
                Yeniden sor
              </button>
            </span>
          )}
        </div>
        <div className="space-y-2">
          {m.metadata?.reference && (
            <ReferenceQuote reference={m.metadata.reference} />
          )}
          {m.metadata?.skill && <SkillNote skill={m.metadata.skill} />}
          <MessageImages images={images} />
          {draft !== null ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) =>
                e.currentTarget.setSelectionRange(draft.length, draft.length)
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDraft(null);
                } else if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  saveEdit();
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              className="w-full resize-none border border-rule bg-sheet px-2 py-1 text-[15px] font-medium leading-relaxed outline-none focus:border-muted"
            />
          ) : (
            text && (
              <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed">
                {text}
              </p>
            )
          )}
        </div>
      </div>
      {draft !== null && (
        <div className="mt-2 flex justify-end gap-4 text-xs">
          <button
            onClick={() => setDraft(null)}
            className="text-muted hover:text-ink"
          >
            Vazgeç <Kbd>Esc</Kbd>
          </button>
          <button
            onClick={saveEdit}
            disabled={!onResend}
            className="text-ink hover:text-accent disabled:opacity-40"
          >
            Gönder <Kbd>Enter</Kbd>
          </button>
        </div>
      )}
    </div>
  );
});

/** Markdown işaretlerini (##, **, `, [](), > …) temizleyip okunur düz metin yapar. */
function plainText(markdown: string) {
  return markdown
    .replace(/^```[^\n]*\n?/gm, "") // kod bloğu çitleri
    .replace(/^ {0,3}([-*_])( *\1){2,} *$/gm, "") // yatay çizgi (maddelerden önce)
    .replace(/^#{1,6}\s+/gm, "") // başlıklar
    .replace(/^\s*>\s?/gm, "") // alıntı
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ") // madde işaretleri
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // bağlantı / görsel: yalnızca metni
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // kalın
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, "$1$2") // italik
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cevabı panoya kopyalar: düz metin alanlarına işaretsiz metin, Word/Docs gibi editörlere
 * biçimiyle (kalın, liste…) yapışır.
 */
function CopyButton({
  markdown,
  htmlRef,
}: {
  markdown: string;
  htmlRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const html = htmlRef.current?.innerHTML;
    const text = plainText(markdown);
    try {
      if (html && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else await navigator.clipboard.writeText(text);
    } catch {
      // Zengin kopyalama desteklenmiyorsa düz metin
      await navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      title="Cevabı kopyala"
      className="text-muted transition-colors hover:text-ink"
    >
      {copied ? "✓ Kopyalandı" : "Kopyala"}
    </button>
  );
}

function History({
  sessions,
  current,
  onOpen,
  onDelete,
}: {
  sessions: ChatSession[];
  current: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const date = (t: number) =>
    t
      ? new Date(t).toLocaleString("tr-TR", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  return (
    <ul className="divide-y divide-rule">
      {sessions.map((s) => (
        <li key={s.id} className="group flex items-baseline gap-3 py-2">
          <button
            onClick={() => onOpen(s.id)}
            className="min-w-0 flex-1 text-left"
          >
            <span
              className={`block truncate ${s.id === current ? "text-accent" : "hover:text-accent"}`}
            >
              {s.title}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {[
                date(s.updatedAt),
                `${s.messages.length} mesaj`,
                s.id === current && "açık",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
          <button
            onClick={() => onDelete(s.id)}
            className="text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100"
          >
            Sil
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Cevapta modelin yaptığı hafıza değişiklikleri (araç sunucuda çalıştıysa). */
function memoryChangesOf(m: ChatMessage): MemoryChange[] {
  return m.parts.flatMap((p) =>
    p.type === "tool-updateMemory" && p.state === "output-available"
      ? p.output.applied
      : [],
  );
}

/** Cevabın altında: "Hafızaya eklendi: … · Geri al". */
function MemoryNote({ changes }: { changes: MemoryChange[] }) {
  const items = useMemory();
  if (!changes.length) return null;
  const active = changes.some((c) => isChangeActive(items, c));
  const label = {
    add: "Hafızaya eklendi",
    remove: "Hafızadan silindi",
    update: "Hafıza güncellendi",
  };
  return (
    <div className="mt-2 flex items-baseline gap-3 text-xs text-muted">
      <ul className="min-w-0 flex-1 space-y-0.5">
        {changes.map((c, i) => (
          <li key={i} className={active ? "" : "line-through opacity-60"}>
            🧠 {label[c.action]}: “{c.action === "remove" ? c.previous : c.text}
            ”
          </li>
        ))}
      </ul>
      {active ? (
        <button
          onClick={() => revertChanges(changes)}
          className="shrink-0 underline underline-offset-2 hover:text-ink"
        >
          Geri al
        </button>
      ) : (
        <span className="shrink-0">Geri alındı</span>
      )}
    </div>
  );
}

function MemoryPanel({ items }: { items: { id: string; text: string }[] }) {
  const enabled = useMemoryEnabled();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const full = items.length >= MEMORY_MAX_ITEMS;
  const add = () => {
    addMemory(draft);
    setDraft("");
  };
  const saveEdit = () => {
    if (editing) editMemory(editing.id, editing.text);
    setEditing(null);
  };
  return (
    <div className="text-sm">
      <div className="mb-3 flex items-baseline gap-3">
        <p className="flex-1 text-xs leading-relaxed text-muted">
          Sana dair hatırladıkları; tüm kitaplarda her soruya eklenir. Sohbette
          öğrendiklerini kendisi ekler, “bunu hatırla” / “bunu unut” da
          diyebilirsin.
        </p>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setMemoryEnabled(e.target.checked)}
          />
          Hafızayı kullan
        </label>
      </div>
      <ul className={`divide-y divide-rule ${enabled ? "" : "opacity-50"}`}>
        {items.map((m) => (
          <li key={m.id} className="group flex items-baseline gap-3 py-2">
            {editing?.id === m.id ? (
              <input
                autoFocus
                value={editing.text}
                maxLength={MEMORY_MAX_CHARS}
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onBlur={saveEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") {
                    e.stopPropagation(); // sohbeti kapatmasın
                    setEditing(null);
                  }
                }}
                className="min-w-0 flex-1 border-b border-accent/60 bg-transparent font-serif outline-none"
              />
            ) : (
              <button
                onClick={() => setEditing(m)}
                title="Düzenlemek için tıkla"
                className="min-w-0 flex-1 text-left font-serif hover:text-accent"
              >
                {m.text}
              </button>
            )}
            <button
              onClick={() => removeMemory(m.id)}
              className="text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100"
            >
              Sil
            </button>
          </li>
        ))}
      </ul>
      {!items.length && (
        <p className="py-2 font-serif text-muted">
          Henüz bir şey hatırlamıyor.
        </p>
      )}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-muted select-none">+</span>
        <input
          value={draft}
          maxLength={MEMORY_MAX_CHARS}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={
            full
              ? `Hafıza dolu (${MEMORY_MAX_ITEMS} madde)`
              : "Ekle: ör. “KPSS'ye hazırlanıyorum, cevaplar kısa olsun”"
          }
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
        <span className="font-mono text-[11px] text-muted">
          {items.length}/{MEMORY_MAX_ITEMS}
        </span>
      </div>
    </div>
  );
}

function Sources({ sources }: { sources: { url: string; title?: string }[] }) {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
      <span>Kaynaklar:</span>
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          title={s.title ?? s.url}
          className="underline decoration-rule underline-offset-2 hover:text-ink"
        >
          {host(s.url)}
        </a>
      ))}
    </div>
  );
}

function MessageImages({ images }: { images: FileUIPart[] }) {
  // Tıklayınca büyür / küçülür
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pl-4">
      {images.map((img, i) => (
        <button
          key={i}
          onClick={() => setOpen(open === i ? null : i)}
          className="block"
        >
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

type PagePreview = {
  page: number;
  chapter: string | null;
  /** Sayfanın başı; chip'in üzerine gelince görünür */
  excerpt: string;
  empty: boolean;
};

/** Açık sayfanın chip'te gösterilen özeti: bölüm adı ve metnin başı. */
function usePagePreview(
  open: boolean,
  pdf: PDFDocumentProxy | null,
  book: string | null,
  page: number,
) {
  const [preview, setPreview] = useState<PagePreview | null>(null);
  useEffect(() => {
    if (!open || !pdf || !book) return;
    let active = true;
    Promise.all([
      getPageText(pdf, page, book).catch(() => ""),
      getBookInfo(pdf).catch(() => null),
    ]).then(([text, info]) => {
      if (!active) return;
      const outline = info?.outline.length
        ? info.outline
        : (loadGeneratedToc(book) ?? []);
      const clean = text.replace(/\s+/g, " ").trim();
      setPreview({
        page,
        chapter: chapterAt(outline, page),
        excerpt: clean.slice(0, 400),
        empty: clean.length < MIN_PAGE_CHARS,
      });
    });
    return () => {
      active = false;
    };
  }, [open, pdf, book, page]);
  return preview;
}

/** Soruyla birlikte gidecek açık sayfa; kaldırılınca sayfa metni gönderilmez. */
function PageChip({
  page,
  preview,
  off,
  onToggle,
}: {
  page: number;
  preview: PagePreview | null;
  off: boolean;
  onToggle: () => void;
}) {
  if (off)
    return (
      <button
        onClick={onToggle}
        title="Açık sayfayı soruya yeniden ekle"
        className="border border-dashed border-rule px-2 py-0.5 text-muted hover:border-muted hover:text-ink"
      >
        + Sayfa {page}
      </button>
    );
  return (
    <span
      title={
        preview?.empty
          ? "Bu sayfada okunabilir metin yok (taranmış, OCR yapılmamış)"
          : preview?.excerpt
            ? `${preview.excerpt}…`
            : undefined
      }
      className="flex min-w-0 items-baseline gap-2 border border-rule bg-paper px-2 py-0.5"
    >
      <span className="shrink-0 text-ink">Sayfa {page}</span>
      {preview?.chapter && (
        <span className="min-w-0 truncate text-muted">{preview.chapter}</span>
      )}
      {preview?.empty && <span className="shrink-0 text-accent">metin yok</span>}
      <button
        onClick={onToggle}
        aria-label="Açık sayfayı bu sorudan çıkar"
        title="Bu soruda sayfayı gönderme"
        className="shrink-0 text-muted hover:text-accent"
      >
        ×
      </button>
    </span>
  );
}

function SkillNote({ skill }: { skill: SkillRequest }) {
  return (
    <p className="border-l-2 border-accent/60 pl-3 text-[11px] text-muted">
      {skillLabel(skill)}
      {skill.emptyPages.length > 0 &&
        ` · ${skill.emptyPages.length} sayfada metin yok (taranmış, OCR yapılmamış)`}
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-rule px-1 py-px font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

function explainPrompt(reference: Reference) {
  return reference.text.trim().split(/\s+/).length <= 3
    ? "Bunu geçtiği cümledeki anlamıyla açıkla; kullanımına birkaç kısa örnek ver."
    : "Bu bölümü açıkla.";
}

const textOf = (m: ChatMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
