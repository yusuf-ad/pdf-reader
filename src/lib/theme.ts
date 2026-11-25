import { translate } from "./i18n";

export const THEMES = [
  { id: "light", get label() { return translate("library", "themeLight"); } },
  { id: "sepia", get label() { return translate("library", "themeSepia"); } },
  { id: "baroque", get label() { return translate("library", "themeBaroque"); } },
  { id: "night", get label() { return translate("library", "themeNight"); } },
  { id: "dark", get label() { return translate("library", "themeDark"); } },
  { id: "monokai", get label() { return translate("library", "themeMonokai"); } },
  { id: "ristretto", get label() { return translate("library", "themeRistretto"); } },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "pdf-reader:theme";
