"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "./theme";

const listeners = new Set<() => void>();

function current(): Theme {
  return (document.documentElement.dataset.theme as Theme) ?? "light";
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  return { theme, setTheme };
}
