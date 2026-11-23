"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { shuffledOrder, type QuizInput } from "@/lib/quiz";

// Akış sırasında gelen yarım girdi (alanlar eksik olabilir)
type PartialQuestion = Partial<Omit<QuizInput["questions"][number], "options">> & {
  options?: (string | undefined)[];
};
type PartialQuiz = { title?: string; questions?: (PartialQuestion | undefined)[] };

type Props = {
  /** Aracın çağrı kimliği: şıklar buna göre sabit bir sırayla karıştırılır */
  id: string;
  input: PartialQuiz | undefined;
  /** Test tamamen geldi; ancak o zaman başlanır */
  ready: boolean;
  error?: string;
  onGoTo?: (page: number) => void;
};

type Question = { question: string; options: string[]; answer: number; explanation?: string; page: number | null };

const LETTERS = "ABCDEF";
// Doğru cevap rengi (annotations'daki yeşil mürekkep); yanlış için temanın vurgu rengi
const GREEN = "var(--good)";

/**
 * Sohbette çizilen test kartı (generative UI). Sorular tek tek, ilerlemeli gelir; cevaplayınca
 * açıklama görünür, sonda skor ve yanlışları tekrar çözme. Klavye: 1-4 / A-D seç, Enter/→ ileri, ← geri.
 */
export default function Quiz({ id, input, ready, error, onGoTo }: Props) {
  const t = useT("ai");
  const questions = useMemo<Question[]>(
    () =>
      (input?.questions ?? []).flatMap((q) => {
        if (!q?.question || typeof q.answer !== "number" || !Array.isArray(q.options)) return [];
        const options = q.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
        if (options.length < 2 || !options[q.answer]) return [];
        return [{ question: q.question, options, answer: q.answer, explanation: q.explanation, page: q.page ?? null }];
      }),
    [input],
  );

  if (error) return <p className="text-sm text-accent">{t("quizErrorPrefix")}{error}</p>;
  if (!ready) return <Preparing title={input?.title} count={input?.questions?.length ?? 0} />;
  if (!questions.length) {
    return <p className="border border-rule px-5 py-4 text-sm text-muted">{t("quizEmpty")}</p>;
  }
  return <Runner id={id} title={input?.title || t("quizTitle")} questions={questions} onGoTo={onGoTo} />;
}

function Preparing({ title, count }: { title?: string; count: number }) {
  const t = useT("ai");
  return (
    <section className="border border-rule bg-sheet px-5 py-6 font-sans">
      <p className="text-xs tracking-wide text-muted uppercase">{t("quizPreparing")}</p>
      <p className="mt-1 font-serif text-xl leading-snug">{title || "…"}</p>
      <div className="mt-5 flex gap-1" aria-hidden>
        {Array.from({ length: Math.max(5, count) }, (_, i) => (
          <span key={i} className={`h-1 flex-1 ${i < count ? "bg-ink/40" : "animate-pulse bg-rule"}`} />
        ))}
      </div>
      <p className="mt-2 text-xs tabular-nums text-muted">{count ? t("quizWritten", { n: count }) : t("quizReading")}</p>
    </section>
  );
}

function Runner({
  id,
  title,
  questions,
  onGoTo,
}: {
  id: string;
  title: string;
  questions: Question[];
  onGoTo?: (page: number) => void;
}) {
  const t = useT("ai");
  // Her soru için ekrandaki şık sırası (doğru cevap hep ilk şıklarda kalmasın)
  const orders = useMemo(
    () => questions.map((q, i) => shuffledOrder(`${id}:${i}`, q.options.length)),
    [questions, id],
  );
  // Soru sırası → seçilen orijinal şık
  const [answers, setAnswers] = useState<Record<number, number>>({});
  // Çözülen sorular (hepsi ya da yalnızca yanlışlar)
  const [queue, setQueue] = useState<number[]>(() => questions.map((_, i) => i));
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Test hazır olunca klavyeyle çözülebilsin
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const qi = queue[step];
  const q = questions[qi];
  const chosen = answers[qi];
  const isAnswered = chosen !== undefined;
  const last = step === queue.length - 1;

  const correctCount = questions.filter((qq, i) => answers[i] === qq.answer).length;
  const wrong = questions.flatMap((qq, i) => (answers[i] !== undefined && answers[i] !== qq.answer ? [i] : []));

  const choose = (original: number) => {
    if (isAnswered || finished) return;
    setAnswers((a) => ({ ...a, [qi]: original }));
    // Açıklama ve "Sonraki" görünür olsun (gerekirse kaydırılır), Enter "Sonraki"ye bassın
    requestAnimationFrame(() => {
      nextRef.current?.focus({ preventScroll: true });
      nextRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };
  const next = () => (last ? setFinished(true) : setStep((s) => s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));
  const restart = (indices: number[]) => {
    setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([i]) => !indices.includes(+i))));
    setQueue(indices);
    setStep(0);
    setFinished(false);
    rootRef.current?.focus({ preventScroll: true });
  };
  const review = (i: number) => {
    setQueue(questions.map((_, j) => j));
    setStep(i);
    setFinished(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (finished) return;
    const key = e.key.toLowerCase();
    const byNumber = Number(key) - 1;
    const byLetter = LETTERS.toLowerCase().indexOf(key);
    const pick = key.length === 1 && byNumber >= 0 ? byNumber : byLetter;
    if (pick >= 0 && pick < q.options.length) {
      e.preventDefault();
      choose(orders[qi][pick]);
    } else if ((e.key === "Enter" || e.key === "ArrowRight") && isAnswered) {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft" && step > 0) {
      e.preventDefault();
      prev();
    }
  };

  const status = (i: number) =>
    answers[i] === undefined ? "empty" : answers[i] === questions[i].answer ? "right" : "wrong";

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label={t("quizAriaLabel", { title })}
      className="border border-rule bg-sheet font-sans outline-none"
    >
      <header className="px-5 pt-4">
        <div className="flex items-baseline gap-3">
          <h3 className="min-w-0 flex-1 truncate font-serif text-[15px] text-muted" title={title}>
            {title}
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {finished ? t("quizResult") : `${step + 1} / ${queue.length}`}
          </span>
        </div>
        {/* İlerleme: her parça bir soru; tıklayınca o soruya gidilir */}
        <div className="mt-3 flex gap-1">
          {queue.map((i, s) => {
            const st = status(i);
            return (
              <button
                key={i}
                onClick={() => {
                  setFinished(false);
                  setStep(s);
                }}
                aria-label={t("quizQuestionAria", { n: s + 1, status: st === "right" ? t("quizStatusRight") : st === "wrong" ? t("quizStatusWrong") : "" })}
                className="group flex-1 py-1.5"
              >
                <span
                  style={st === "right" ? { background: GREEN } : undefined}
                  className={`block transition-all ${!finished && s === step ? "h-1.5" : "h-1"} ${
                    st === "wrong"
                      ? "bg-accent"
                      : st === "right"
                        ? ""
                        : !finished && s === step
                          ? "bg-ink/70"
                          : "bg-rule group-hover:bg-muted"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </header>

      {finished ? (
        <Result
          questions={questions}
          answers={answers}
          correct={correctCount}
          wrong={wrong}
          onReview={review}
          onRetryWrong={() => restart(wrong)}
          onRestart={() => restart(questions.map((_, i) => i))}
        />
      ) : (
        <div className="px-5 pt-3 pb-5">
          <p className="min-h-[3.5rem] font-serif text-[19px] leading-snug whitespace-pre-wrap">{q.question}</p>

          <ul className="mt-4 space-y-2">
            {orders[qi].map((original, shown) => {
              const isRight = original === q.answer;
              const isChosen = original === chosen;
              const look = !isAnswered
                ? "border-rule hover:border-ink hover:bg-ink/[0.03]"
                : isRight
                  ? "border-transparent"
                  : isChosen
                    ? "border-accent bg-accent/10"
                    : "border-rule opacity-45";
              return (
                <li key={original}>
                  <button
                    onClick={() => choose(original)}
                    disabled={isAnswered}
                    style={isAnswered && isRight ? { borderColor: GREEN, background: `color-mix(in srgb, ${GREEN} 10%, transparent)` } : undefined}
                    className={`group flex w-full items-start gap-3 border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${look}`}
                  >
                    <span
                      style={isAnswered && isRight ? { background: GREEN, borderColor: GREEN } : undefined}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center border font-mono text-xs ${
                        isAnswered && isRight
                          ? "text-sheet"
                          : isAnswered && isChosen
                            ? "border-accent bg-accent text-sheet"
                            : "border-rule text-muted group-hover:border-ink group-hover:text-ink"
                      }`}
                    >
                      {isAnswered && isRight ? "✓" : isAnswered && isChosen ? "✕" : LETTERS[shown]}
                    </span>
                    <span className="min-w-0 flex-1 pt-0.5 text-[15px] leading-snug">{q.options[original]}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {isAnswered && (
            <div
              style={chosen === q.answer ? { borderColor: GREEN } : undefined}
              className={`mt-4 border-l-2 py-1 pl-3 text-sm leading-relaxed ${chosen === q.answer ? "" : "border-accent"}`}
            >
              <p
                style={chosen === q.answer ? { color: GREEN } : undefined}
                className={`font-medium ${chosen === q.answer ? "" : "text-accent"}`}
              >
                {chosen === q.answer ? t("quizCorrect") : t("quizIncorrect", { answer: LETTERS[orders[qi].indexOf(q.answer)] })}
              </p>
              {q.explanation && <p className="mt-0.5 text-ink/80">{q.explanation}</p>}
              {q.page && onGoTo && (
                <button
                  onClick={() => onGoTo(q.page!)}
                  className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink"
                >
                  {t("quizGoToPage", { page: q.page! })}
                </button>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={prev}
              disabled={step === 0}
              className="px-1 text-sm text-muted hover:text-ink disabled:invisible"
            >
              {t("quizPrevious")}
            </button>
            <span className="mx-auto hidden text-[11px] text-muted sm:inline">
              {isAnswered ? t("quizContinue") : t("quizChooseShortcut", { n: q.options.length, letter: LETTERS[q.options.length - 1] })}
            </span>
            <button
              ref={nextRef}
              onClick={next}
              className={`ml-auto border px-4 py-1.5 text-sm transition-colors ${
                isAnswered
                  ? "border-ink bg-ink text-sheet hover:bg-ink/85"
                  : "border-rule text-muted hover:border-ink hover:text-ink"
              }`}
            >
              {last ? (isAnswered ? t("quizSeeResult") : t("quizFinish")) : isAnswered ? t("quizNext") : t("quizSkip")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Result({
  questions,
  answers,
  correct,
  wrong,
  onReview,
  onRetryWrong,
  onRestart,
}: {
  questions: Question[];
  answers: Record<number, number>;
  correct: number;
  wrong: number[];
  onReview: (i: number) => void;
  onRetryWrong: () => void;
  onRestart: () => void;
}) {
  const t = useT("ai");
  const total = questions.length;
  const empty = total - Object.keys(answers).length;
  const ratio = correct / total;
  const verdict =
    ratio === 1 ? t("quizPerfect") : ratio >= 0.7 ? t("quizGood") : ratio >= 0.4 ? t("quizPractice") : t("quizReread");

  return (
    <div className="px-5 pt-4 pb-5">
      <div className="flex items-end gap-4">
        <p className="font-serif text-5xl leading-none tabular-nums">
          {correct}
          <span className="text-2xl text-muted">/{total}</span>
        </p>
        <div className="pb-1 text-sm">
          <p>{verdict}</p>
          <p className="text-xs text-muted tabular-nums">
            {t("quizScore", { percent: Math.round(ratio * 100), n: wrong.length })}{empty ? t("quizUnanswered", { n: empty }) : ""}
          </p>
        </div>
      </div>

      <ol className="mt-5 divide-y divide-rule border-y border-rule">
        {questions.map((q, i) => {
          const a = answers[i];
          const mark = a === undefined ? "—" : a === q.answer ? "✓" : "✕";
          return (
            <li key={i}>
              <button
                onClick={() => onReview(i)}
                className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:bg-ink/[0.03]"
              >
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{q.question}</span>
                <span
                  style={mark === "✓" ? { color: GREEN } : undefined}
                  className={`w-4 shrink-0 text-center ${mark === "✕" ? "text-accent" : mark === "—" ? "text-muted" : ""}`}
                >
                  {mark}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {wrong.length > 0 && (
          <button
            onClick={onRetryWrong}
            className="border border-ink bg-ink px-4 py-1.5 text-sheet transition-colors hover:bg-ink/85"
          >
            {t("quizRetryWrong", { n: wrong.length })}
          </button>
        )}
        <button
          onClick={onRestart}
          className="border border-rule px-4 py-1.5 transition-colors hover:border-ink"
        >
          {t("quizRestart")}
        </button>
      </div>
    </div>
  );
}
