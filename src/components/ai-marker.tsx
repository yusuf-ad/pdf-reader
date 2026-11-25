"use client";

import { translate, useT } from "@/lib/i18n";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  addAnnotation,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  newId,
  getBookAnnotations,
  removeAnnotations,
  type Annotation,
} from "@/lib/annotations";
import { pageLayout } from "@/lib/marks";
import type { MarkInput } from "@/lib/page-marks";
import { locateQuestion } from "@/lib/question-locate";
import { bookKey, get, set, useStored } from "@/lib/storage";

// Asistanın sayfada yanlış soruları işaretlemesi: kendine ait bir imleç sayfada gezer, soru
// numarasını sarı, doğru şıkkı yeşil vurgular ve yanına not yazar. İşaretler kullanıcının
// kendi işaretleriyle aynı türdendir (Ctrl Z, dışa aktarma, sohbetin işaretleri görmesi aynen çalışır).

const YELLOW = HIGHLIGHT_COLORS[0].color;
const GREEN = HIGHLIGHT_COLORS[1].color;
const NOTE_COLOR = INK_COLORS[3];
const NOTE_SIZE = 0.014;
// İmlecin bir yerden diğerine kayma süresi (CSS geçişiyle aynı)
const MOVE_MS = 520;
const TYPE_MS = 16;

// --- İmleç ----------------------------------------------------------------------

type Cursor = {
  page: number;
  x: number;
  y: number;
  /** Yazılmakta olan not (bitince gerçek not olarak eklenir) */
  typing?: { text: string; x: number; y: number; width: number };
};

let cursor: Cursor | null = null;
const listeners = new Set<() => void>();
const setCursor = (next: Cursor | null) => {
  cursor = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Sayfanın üstünde asistanın imleci; yalnızca imleç bu sayfadayken çizilir. */
export function AiCursor({ page, width }: { page: number; width: number }) {
  const t = useT("ai");
  const c = useSyncExternalStore(
    subscribe,
    () => cursor,
    () => null,
  );
  if (!c || c.page !== page) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {c.typing && (
        <div
          style={{
            left: `${c.typing.x * 100}%`,
            top: `${c.typing.y * 100}%`,
            maxWidth: c.typing.width * width,
            fontSize: NOTE_SIZE * width,
            color: NOTE_COLOR,
          }}
          className="absolute font-sans leading-[1.3] break-words whitespace-pre-wrap"
        >
          {c.typing.text}
          <span className="ml-px inline-block h-[1em] w-px animate-pulse bg-current align-[-0.15em]" />
        </div>
      )}
      <div
        style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, transitionDuration: `${MOVE_MS}ms` }}
        className="absolute transition-[left,top] ease-in-out"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="-translate-x-px -translate-y-px drop-shadow">
          <path d="M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.6 10 L13 10 Z" fill="var(--accent)" stroke="var(--sheet)" strokeWidth="1.2" />
        </svg>
        <span className="absolute top-4 left-3.5 bg-accent px-1.5 py-px font-sans text-[10px] whitespace-nowrap text-sheet">
          {t("markerAssistant")}
        </span>
      </div>
    </div>
  );
}

// --- Kayıt ----------------------------------------------------------------------

/** Bir işaretleme (araç çağrısı) sonucu: eklenen işaretler ve bulunamayan sorular. */
export type MarkRecord = {
  page: number;
  ids: string[];
  missing: string[];
  /** Doğru şıkkın üstünde kullanıcının kendi işareti olduğu için yanlış sayılmayan sorular */
  kept?: string[];
  error?: string;
  undone?: boolean;
};
type MarkRecords = Record<string, MarkRecord>;

const recordsKey = (book: string) => bookKey("ai-marks", book);
const EMPTY: MarkRecords = {};

function saveRecord(book: string, id: string, rec: MarkRecord) {
  set(recordsKey(book), { ...(get<MarkRecords>(recordsKey(book)) ?? {}), [id]: rec });
}

/** Asistanın eklediği işaretleri kaldırır (kayıt kalır; tekrar uygulanabilir). */
export function undoMarks(book: string, id: string) {
  const rec = get<MarkRecords>(recordsKey(book))?.[id];
  if (!rec) return;
  removeAnnotations(book, rec.page, rec.ids);
  saveRecord(book, id, { ...rec, ids: [], undone: true });
}

// --- Kullanıcının işareti -------------------------------------------------------------

// Şık kutusunun çevresinde bu kadar pay (sayfaya oranla) içindeki işaretler o şıkka sayılır
const OPTION_PAD = 0.008;

/**
 * Kullanıcının kendi kalem/vurgu işareti şıkkın kutusuna değiyor mu. Model, seçilen şıkkı
 * görselden okurken yanılabilir (ör. tikin kolu başka bir şıkkın yanından geçer); doğru şık
 * işaretliyse soru yanlış diye işaretlenmez. Asistanın kendi işaretleri sayılmaz.
 */
function userMarked(book: string, page: number, rects: number[]) {
  const own = new Set(Object.values(get<MarkRecords>(recordsKey(book)) ?? {}).flatMap((r) => r.ids));
  const boxes: [number, number, number, number][] = [];
  for (let i = 0; i < rects.length; i += 4) {
    boxes.push([rects[i] - OPTION_PAD, rects[i + 1] - OPTION_PAD, rects[i] + rects[i + 2] + OPTION_PAD, rects[i + 1] + rects[i + 3] + OPTION_PAD]);
  }
  const inside = (x: number, y: number) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  return (getBookAnnotations(book)[page] ?? []).some((a) => {
    if (own.has(a.id)) return false;
    if (a.type === "ink") {
      const p = a.points;
      for (let i = 0; i < p.length; i += 2) {
        if (inside(p[i], p[i + 1])) return true;
        // Hızlı çizilen çizgide noktalar seyrek olabilir: ara noktalara da bak
        if (i + 3 < p.length) {
          for (const t of [0.25, 0.5, 0.75]) if (inside(p[i] + (p[i + 2] - p[i]) * t, p[i + 1] + (p[i + 3] - p[i + 1]) * t)) return true;
        }
      }
      return false;
    }
    if (a.type === "highlight") {
      for (let i = 0; i < a.rects.length; i += 4) {
        const [x, y, w, h] = a.rects.slice(i, i + 4);
        if (boxes.some(([x0, y0, x1, y1]) => x < x1 && x + w > x0 && y < y1 && y + h > y0)) return true;
      }
    }
    return false;
  });
}

// --- Uygulama ---------------------------------------------------------------------

export type MarkStatus =
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; id: string; count: number; missing: string[]; kept: string[] }
  | { kind: "error"; text: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kuyruktaki işaretlemeyi imleçle adım adım uygular. Okuyucu düzeyinde bir kez kullanılır. */
export function useAiMarker(
  pdf: PDFDocumentProxy | null,
  book: string | null,
  scrollRef: RefObject<HTMLDivElement | null>,
  goTo: (page: number) => void,
) {
  const [status, setStatus] = useState<MarkStatus | null>(null);
  // Birden çok sayfa (çok sayfalı kontrol) sırayla işaretlenir; Durdur sıradakileri de iptal eder
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const stopGenRef = useRef(0);
  const stopRef = useRef(false);
  const latest = useRef({ pdf, book, goTo });
  useEffect(() => {
    latest.current = { pdf, book, goTo };
  });

  // Bitti bildirimi bir süre sonra kaybolur
  useEffect(() => {
    if (status?.kind === "running") return;
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 8000);
    return () => clearTimeout(timer);
  }, [status]);

  /** Sayfadaki yeri (0–1) ekranın üst üçte birine getirir. */
  const scrollTo = useCallback(
    (page: number, y: number) => {
      const root = scrollRef.current;
      const fig = root?.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
      const frame = fig?.querySelector<HTMLElement>(".page-frame");
      if (!root || !fig || !frame) return;
      root.scrollTo({ top: fig.offsetTop + y * frame.offsetHeight - root.clientHeight * 0.35, behavior: "smooth" });
    },
    [scrollRef],
  );

  const runOne = useCallback(
    async (id: string, input: MarkInput) => {
      const { pdf, book, goTo } = latest.current;
      if (!pdf || !book) return;
      stopRef.current = false;
      const page = Math.min(pdf.numPages, Math.max(1, input.page));
      const questions = input.questions;
      const ids: string[] = [];
      const missing: string[] = [];
      const kept: string[] = [];
      setStatus({ kind: "running", done: 0, total: questions.length });
      try {
        const p = await pdf.getPage(page);
        const vp = p.getViewport({ scale: 1 });
        const aspect = vp.width / vp.height;
        const layout = await pageLayout(pdf, book, page);
        if (!layout.pieces.length) {
          const error = translate("ai", "markerNoText");
          saveRecord(book, id, { page, ids, missing: questions.map((q) => q.number), error });
          setStatus({ kind: "error", text: error });
          return;
        }
        goTo(page);
        await wait(300);

        const add = (item: Annotation) => {
          addAnnotation(book, page, item);
          ids.push(item.id);
        };
        const moveTo = async (x: number, y: number, typing?: Cursor["typing"]) => {
          setCursor({ page, x, y, typing });
          await wait(MOVE_MS + 120);
        };

        for (const [i, q] of questions.entries()) {
          if (stopRef.current) break;
          const spot = locateQuestion(layout, q, NOTE_SIZE, aspect);
          if (!spot || !spot.number.length) {
            missing.push(q.number);
            continue;
          }
          // Kontrolde: kullanıcı doğru şıkkı işaretlemişse model seçimi yanlış okumuştur
          if (q.chosen && spot.option.length && userMarked(book, page, spot.option)) {
            kept.push(q.number);
            continue;
          }
          const [nx, ny, nw, nh] = spot.number;
          scrollTo(page, ny);
          await moveTo(nx + nw, ny + nh);
          add({ id: newId(), type: "highlight", color: YELLOW, rects: spot.number, text: spot.numberText, createdAt: Date.now() });
          await wait(200);

          if (spot.option.length && !stopRef.current) {
            const r = spot.option;
            await moveTo(r[0] + r[2], r[1] + r[3]);
            add({ id: newId(), type: "highlight", color: GREEN, rects: r, text: spot.optionText, createdAt: Date.now() });
            await wait(200);
          }

          if (!stopRef.current) {
            const text = translate("ai", "markerCorrectNote", { answer: q.correct.trim().toLocaleUpperCase("tr"), note: q.note.trim() });
            const { x, y, width } = spot.note;
            await moveTo(x, y);
            // Not harf harf yazılır; bitince gerçek not olarak eklenir
            const step = Math.max(1, Math.ceil(text.length / 90));
            for (let n = step; n < text.length + step && !stopRef.current; n += step) {
              setCursor({ page, x, y, typing: { text: text.slice(0, n), x, y, width } });
              await wait(TYPE_MS);
            }
            add({ id: newId(), type: "text", color: NOTE_COLOR, x, y, size: NOTE_SIZE, text, width });
            setCursor({ page, x, y });
          }
          setStatus({ kind: "running", done: i + 1, total: questions.length });
        }
        saveRecord(book, id, { page, ids, missing, kept });
        setStatus({ kind: "done", id, count: questions.length - missing.length - kept.length, missing, kept });
      } catch (e) {
        saveRecord(book, id, { page, ids, missing, error: String(e) });
        setStatus({ kind: "error", text: translate("ai", "markerPageError") });
      } finally {
        await wait(600);
        setCursor(null);
      }
    },
    [scrollTo],
  );

  const run = useCallback(
    (id: string, input: MarkInput) => {
      const gen = stopGenRef.current;
      queueRef.current = queueRef.current.then(() =>
        gen === stopGenRef.current ? runOne(id, input) : undefined,
      );
      return queueRef.current;
    },
    [runOne],
  );

  const stop = useCallback(() => {
    stopRef.current = true;
    stopGenRef.current++;
  }, []);
  const dismiss = useCallback(() => setStatus(null), []);
  return { status, run, stop, dismiss };
}

/** Sağ altta işaretleme durumu: sürerken ilerleme ve Durdur, bitince Geri al. */
export function AiMarkerStatus({
  status,
  book,
  onStop,
  onDismiss,
}: {
  status: MarkStatus | null;
  book: string | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const t = useT("ai");
  if (!status) return null;
  return (
    <div className="fixed right-5 bottom-5 z-30 flex items-baseline gap-4 border border-rule bg-sheet px-4 py-2 text-xs shadow-[0_4px_16px_var(--shadow)]">
      {status.kind === "running" ? (
        <>
          <span className="flex items-baseline gap-2">
            <span className="inline-block h-2 w-2 animate-pulse bg-accent" />
            {t("markerRunning")}<span className="tabular-nums text-muted">
              {status.done}/{status.total}
            </span>
          </span>
          <button onClick={onStop} className="text-muted hover:text-accent">
            {t("chatStop")}
          </button>
        </>
      ) : status.kind === "done" ? (
        <>
          <span>
            {t("markerCount", { n: status.count })}
            {status.missing.length > 0 && (
              <span className="text-muted">{t("markerMissingNumbers", { numbers: status.missing.join(", ") })}</span>
            )}
            {status.kept.length > 0 && (
              <span className="text-muted">{t("markerKeptNumbers", { numbers: status.kept.join(", ") })}</span>
            )}
          </span>
          {book && status.count > 0 && (
            <button
              onClick={() => {
                undoMarks(book, status.id);
                onDismiss();
              }}
              className="text-muted hover:text-accent"
            >
              {t("chatUndo")}
            </button>
          )}
          <button onClick={onDismiss} aria-label={t("actionClose")} className="text-muted hover:text-ink">
            ×
          </button>
        </>
      ) : (
        <>
          <span className="text-accent">{status.text}</span>
          <button onClick={onDismiss} aria-label={t("actionClose")} className="text-muted hover:text-ink">
            ×
          </button>
        </>
      )}
    </div>
  );
}

// --- Sohbet kartı -----------------------------------------------------------------

type PartialMark = {
  page?: number;
  checked?: number | null;
  questions?: (Partial<MarkInput["questions"][number]> | undefined)[];
};

/**
 * Sohbette markQuestions aracının kartı: çözülen sorular, işaretlerin durumu, Geri al / Tekrar uygula.
 * Cevap akarken gelen kart işaretlemeyi kendiliğinden başlatır; geçmişten yüklenen kart başlatmaz.
 */
export function MarkCard({
  id,
  input,
  ready,
  streaming,
  book,
  error,
  onRun,
  onGoTo,
}: {
  id: string;
  input: PartialMark | undefined;
  ready: boolean;
  streaming: boolean;
  book: string | null;
  error?: string;
  onRun?: (id: string, input: MarkInput) => void;
  onGoTo?: (page: number) => void;
}) {
  const t = useT("ai");
  const records = useStored(book && recordsKey(book), EMPTY);
  const rec = records[id] as MarkRecord | undefined;
  // Kart akış sırasında mı geldi (yeni istek), yoksa kayıtlı sohbetten mi yüklendi
  const [live] = useState(streaming);
  const startedRef = useRef(false);
  const complete = ready && input?.page && input.questions ? (input as MarkInput) : null;

  useEffect(() => {
    if (!live || !complete?.questions.length || rec || startedRef.current || !onRun) return;
    startedRef.current = true;
    onRun(id, complete);
  }, [live, complete, rec, onRun, id]);

  if (error) return <p className="text-sm text-accent">{t("markerErrorPrefix")}{error}</p>;
  const questions = (input?.questions ?? []).filter((q) => q?.number);
  // Kontrolde kaç sorunun cevaplandığı bilinir (yanlışlarını kullanıcı söylediyse null)
  const checked = typeof input?.checked === "number" ? input.checked : null;
  // Doğru şıkkı işaretli çıkanlar yanlış sayılmaz
  const wrong = questions.length - (rec?.kept?.length ?? 0);
  const title = !ready
    ? t("markerSolving")
    : checked === 0
      ? t("markerNoAnswers")
      : checked !== null
        ? wrong
          ? t("markerScore", { n: checked, correct: Math.max(0, checked - wrong), wrong })
          : t("markerAllCorrect", { n: checked })
        : t("markerMarked");
  return (
    <section className="border border-rule bg-sheet px-5 py-4 font-sans">
      <div className="flex items-baseline gap-3">
        <p className="flex-1 text-[11px] tracking-[0.12em] text-muted uppercase">
          {title}
          {input?.page && (
            <>
              {" · "}
              {onGoTo ? (
                <button onClick={() => onGoTo(input.page!)} className="tracking-normal normal-case hover:text-ink">
                  {t("pageReference", { page: input.page! })}
                </button>
              ) : (
                <span className="tracking-normal normal-case">{t("pageReference", { page: input.page! })}</span>
              )}
            </>
          )}
        </p>
        {complete && complete.questions.length > 0 && book && (
          <span className="flex gap-4 text-xs">
            {rec && !rec.undone && rec.ids.length > 0 ? (
              <button onClick={() => undoMarks(book, id)} className="text-muted hover:text-accent">
                {t("chatUndo")}
              </button>
            ) : (
              onRun && (
                <button onClick={() => onRun(id, complete)} className="text-muted hover:text-ink">
                  {rec ? t("markerReapply") : t("markerApply")}
                </button>
              )
            )}
          </span>
        )}
      </div>
      {questions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {questions.map((q, i) => {
            const lost = rec?.missing.includes(q!.number!);
            const kept = rec?.kept?.includes(q!.number!);
            return (
              <li key={i} className="flex gap-3 text-sm leading-snug">
                <span className="w-24 shrink-0 font-mono tabular-nums">
                  <span className="bg-[#f5c518]/50 px-0.5 text-ink">{q!.number}</span>
                  {q!.chosen && (
                    <span className="ml-1.5 text-muted line-through" title={t("markerYourAnswer")}>
                      {q!.chosen}
                    </span>
                  )}
                  {q!.correct && <span className="text-muted"> → </span>}
                  {q!.correct && <span className="bg-[#7bc96f]/50 px-0.5 text-ink">{q!.correct}</span>}
                </span>
                <span className={`font-serif ${lost || kept ? "text-muted line-through" : "text-ink/85"}`}>
                  {q!.note}
                  {lost && <span className="ml-2 font-sans text-xs text-accent no-underline">{t("markerMissing")}</span>}
                  {kept && (
                    <span className="ml-2 font-sans text-xs text-good no-underline">
                      {t("markerKept", { answer: q!.correct! })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rec?.error && <p className="mt-3 text-xs text-accent">{rec.error}</p>}
    </section>
  );
}
