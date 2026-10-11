export const THEMES = [
  { id: "light", label: "Açık" },
  { id: "sepia", label: "Sepya" },
  { id: "dark", label: "Koyu" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "pdf-reader:theme";
