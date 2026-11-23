"use client";

import { useSyncExternalStore } from "react";

export type AiProvider = "openai" | "google";
export type AiSettings = { provider: AiProvider; key: string; model?: string };

const STORAGE_KEY = "pdf-reader:ai-settings";
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSettings: AiSettings | null = null;
// A blocked write must still leave the settings usable for this tab's session.
let sessionOnly = false;

function parseSettings(value: unknown): AiSettings | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<AiSettings>;
  if ((s.provider !== "google" && s.provider !== "openai") || typeof s.key !== "string") {
    return null;
  }
  const model = typeof s.model === "string" ? s.model.trim() : "";
  return { provider: s.provider, key: s.key.trim(), ...(model ? { model } : {}) };
}

export function getAiSettings(): AiSettings | null {
  if (typeof window === "undefined") return null;
  if (sessionOnly) return cachedSettings;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedSettings = null;
      if (raw) cachedSettings = parseSettings(JSON.parse(raw));
    }
  } catch {
    // Storage can be blocked, or a stored value may contain invalid JSON.
  }
  // Keep the same object while storage is unchanged (useSyncExternalStore contract).
  return cachedSettings;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function setAiSettings(settings: AiSettings): void {
  if (typeof window === "undefined") return;
  cachedSettings = parseSettings(settings);
  cachedRaw = JSON.stringify(cachedSettings);
  try {
    window.localStorage.setItem(STORAGE_KEY, cachedRaw);
    sessionOnly = false;
  } catch {
    sessionOnly = true;
  }
  notify();
}

export function clearAiSettings(): void {
  if (typeof window === "undefined") return;
  cachedSettings = null;
  cachedRaw = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    sessionOnly = false;
  } catch {
    sessionOnly = true;
  }
  notify();
}

export function hasAiKey(): boolean {
  return Boolean(getAiSettings()?.key);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    sessionOnly = false;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => null;

export function useAiSettings(): AiSettings | null {
  return useSyncExternalStore(subscribe, getAiSettings, serverSnapshot);
}

export function aiHeaders(): Record<string, string> {
  const settings = getAiSettings();
  if (!settings?.key) return {};
  return {
    "x-ai-provider": settings.provider,
    "x-ai-key": settings.key,
    ...(settings.model ? { "x-ai-model": settings.model } : {}),
  };
}

export function openAiSettings(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ai-settings:open"));
  }
}
