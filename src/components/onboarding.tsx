"use client";

import { useEffect, useState } from "react";
import { openAiSettings } from "@/lib/ai-settings";

const TEXT = {
  title: "Başlarken",
  skip: "Turu atla",
  back: "Geri",
  next: "Sonraki",
  done: "Okumaya başla",
  settings: "API anahtarı ekle",
  step: "adım",
  steps: [
    { title: "Bir cümleyi vurgula", body: "PDF’te bir cümleyi sürükleyerek seç ve H tuşuna bas. Vurguya tıklayarak rengini değiştirebilirsin." },
    { title: "Düşünceni not et", body: "Metni seçip “Nota ekle”ye tıkla. Kendi not kâğıdını açmak için N tuşuna bas; yazdıkların otomatik saklanır." },
    { title: "Yapay zekâya sor", body: "Bir metin seçip Ctrl + K ile sorunu sor. Önce AI ayarlarından kendi API anahtarını ekle; Gemini için ücretsiz anahtar alabilirsin. Okumak, vurgulamak ve not almak anahtar gerektirmez." },
    { title: "Kısayollar elinin altında", body: "? tuşuyla tüm kısayolları aç. L kitaplığı, ok tuşları sayfaları açar. Bu turu kısayollardaki “Başlarken” bölümünden yeniden başlatabilirsin." },
  ],
} as const;

const TOUR_KEY = "pdf-reader:tour-done";
const TOUR_EVENT = "pdf-reader:tour-open";
let shownThisSession = false;

export function openOnboarding(firstVisit = false) {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { firstVisit } }));
}

/** Lives outside Reader so the tour also works with split panes. */
export default function Onboarding() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    let observer: MutationObserver | undefined;
    const open = (event: Event) => {
      const firstVisit = (event as CustomEvent<{ firstVisit: boolean }>).detail?.firstVisit;
      if (firstVisit) {
        if (shownThisSession) return;
        try {
          if (localStorage.getItem(TOUR_KEY)) return;
        } catch {
          // The tour still works without localStorage.
        }
      }
      observer?.disconnect();
      const showWhenReady = () => {
        // Wait for actual selectable PDF text, rather than the loading screen.
        if (firstVisit && !document.querySelector(".react-pdf__Page__textContent span")) return;
        observer?.disconnect();
        shownThisSession = true;
        try {
          localStorage.setItem(TOUR_KEY, "true");
        } catch {
          // Keep the session fallback above.
        }
        setStep(0);
      };
      observer = new MutationObserver(showWhenReady);
      observer.observe(document.body, { childList: true, subtree: true });
      showWhenReady();
    };
    window.addEventListener(TOUR_EVENT, open);
    return () => {
      window.removeEventListener(TOUR_EVENT, open);
      observer?.disconnect();
    };
  }, []);

  if (step === null) return null;
  const tip = TEXT.steps[step];
  return (
    <aside
      aria-label={TEXT.title}
      className="fixed right-4 bottom-4 z-40 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border border-rule bg-sheet p-5 shadow-[0_4px_20px_var(--shadow)]"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{TEXT.title} · {step + 1}/{TEXT.steps.length} {TEXT.step}</span>
        <button onClick={() => setStep(null)} className="underline underline-offset-4 hover:text-ink">{TEXT.skip}</button>
      </div>
      <div aria-live="polite">
        <h2 className="mt-4 font-serif text-xl">{tip.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{tip.body}</p>
      </div>
      {step === 2 && (
        <button onClick={openAiSettings} className="mt-3 text-sm underline underline-offset-4 hover:text-accent">{TEXT.settings}</button>
      )}
      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <button disabled={step === 0} onClick={() => setStep(step - 1)} className="text-muted hover:text-ink disabled:invisible">{TEXT.back}</button>
        <button
          onClick={() => setStep(step === TEXT.steps.length - 1 ? null : step + 1)}
          className="border border-ink px-3 py-1.5 hover:bg-ink hover:text-sheet"
        >
          {step === TEXT.steps.length - 1 ? TEXT.done : TEXT.next}
        </button>
      </div>
    </aside>
  );
}
