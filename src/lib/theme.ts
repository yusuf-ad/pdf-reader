export const THEMES = [
  { id: "light", label: "Açık" },
  { id: "sepia", label: "Sepya" },
  { id: "baroque", label: "Barok" },
  { id: "night", label: "Gece" },
  { id: "dark", label: "Koyu" },
  { id: "monokai", label: "Monokai" },
  { id: "ristretto", label: "Ristretto" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "pdf-reader:theme";
