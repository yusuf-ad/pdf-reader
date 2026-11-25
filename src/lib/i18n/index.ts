"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ai } from "./messages/ai";
import { common } from "./messages/common";
import { library } from "./messages/library";
import { reader } from "./messages/reader";

/**
 * Arayüz dili. Varsayılan İngilizce; tarayıcı dili Türkçeyse Türkçe.
 * Kullanıcı seçimi localStorage'da. Metinler `messages/<alan>.ts` dosyalarında,
 * her alanın `en` ve `tr` sözlüğü aynı anahtarlara sahip olmak zorunda (derleyici denetler).
 *
 *   const t = useT("library");
 *   t("removeConfirm", { title })   // "{title}" yer tutucusu doldurulur
 */
export const LANGS = ["en", "tr"] as const;
export type Lang = (typeof LANGS)[number];
import { LANG_STORAGE_KEY } from "./lang-script";
export { LANG_STORAGE_KEY };
export const LANG_HEADER = "x-ui-lang";

const MESSAGES = { common, library, reader, ai };
export type Namespace = keyof typeof MESSAGES;
type Keys<N extends Namespace> = keyof (typeof MESSAGES)[N]["en"] & string;
export type Vars = Record<string, string | number>;

const listeners = new Set<() => void>();
let override: Lang | null = null;

const isLang = (v: unknown): v is Lang => v === "en" || v === "tr";

function detect(): Lang {
  if (typeof navigator === "undefined") return "en";
  return navigator.languages?.some((l) => l.toLowerCase().startsWith("tr")) ? "tr" : "en";
}

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  if (override) return override;
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {}
  return detect();
}

export function setLang(lang: Lang) {
  override = lang;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {}
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LANG_STORAGE_KEY) {
      override = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "en");
}

function format(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Hook dışından (lib fonksiyonları, alert/confirm) çeviri: o anki dili kullanır. */
export function translate<N extends Namespace>(ns: N, key: Keys<N>, vars?: Vars, lang: Lang = getLang()): string {
  const dict = MESSAGES[ns][lang] as Record<string, string>;
  const fallback = MESSAGES[ns].en as Record<string, string>;
  return format(dict[key] ?? fallback[key] ?? key, vars);
}

export function useT<N extends Namespace>(ns: N) {
  const lang = useLang();
  return useCallback((key: Keys<N>, vars?: Vars) => translate(ns, key, vars, lang), [ns, lang]);
}
