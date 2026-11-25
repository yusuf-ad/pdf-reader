import { translate } from "./i18n";

export const THEMES = [
  { id: "light", get label() { return translate("library", "themeLight"); } },
  { id: "sepia", get label() { return translate("library", "themeSepia"); } },
  { id: "baroque", get label() { return translate("library", "themeBaroque"); } },
  { id: "night", get label() { return translate("library", "themeNight"); } },
  { id: "dark", get label() { return translate("library", "themeDark"); } },
  { id: "plum", get label() { return translate("library", "themePlum"); } },
  { id: "espresso", get label() { return translate("library", "themeEspresso"); } },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "pdf-reader:theme";

// Themes that were renamed: an old saved value opens its new theme
export const THEME_RENAMES: Record<string, Theme> = { monokai: "plum", ristretto: "espresso" };
