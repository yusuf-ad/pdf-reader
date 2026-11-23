"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useState } from "react";
import { openAiSettings } from "@/lib/ai-settings";

const TOUR_KEY = "pdf-reader:tour-done";
const TOUR_EVENT = "pdf-reader:tour-open";
let shownThisSession = false;

export function openOnboarding(firstVisit = false) {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { firstVisit } }));
}

/** Lives outside Reader so the tour also works with split panes. */
export default function Onboarding() {
  const t = useT("library");
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
  const tips = [
    { title: t("onboardingStep1Title"), body: t("onboardingStep1Body") },
    { title: t("onboardingStep2Title"), body: t("onboardingStep2Body") },
    { title: t("onboardingStep3Title"), body: t("onboardingStep3Body") },
    { title: t("onboardingStep4Title"), body: t("onboardingStep4Body") },
  ];
  const tip = tips[step];
  return (
    <aside
      aria-label={t("onboardingTitle")}
      className="fixed right-4 bottom-4 z-40 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border border-rule bg-sheet p-5 shadow-[0_4px_20px_var(--shadow)]"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{t("onboardingTitle")} · {step + 1}/{tips.length} {t("onboardingStep")}</span>
        <button onClick={() => setStep(null)} className="underline underline-offset-4 hover:text-ink">{t("onboardingSkip")}</button>
      </div>
      <div aria-live="polite">
        <h2 className="mt-4 font-serif text-xl">{tip.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{tip.body}</p>
      </div>
      {step === 2 && (
        <button onClick={openAiSettings} className="mt-3 text-sm underline underline-offset-4 hover:text-accent">{t("onboardingSettings")}</button>
      )}
      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <button disabled={step === 0} onClick={() => setStep(step - 1)} className="text-muted hover:text-ink disabled:invisible">{t("onboardingBack")}</button>
        <button
          onClick={() => setStep(step === tips.length - 1 ? null : step + 1)}
          className="border border-ink px-3 py-1.5 hover:bg-ink hover:text-sheet"
        >
          {step === tips.length - 1 ? t("onboardingDone") : t("onboardingNext")}
        </button>
      </div>
    </aside>
  );
}
