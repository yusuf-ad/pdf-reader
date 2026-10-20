import type { PaperStyle } from "./blank-book";

// Kâğıt türlerinin adları ayrı durur: blank-book pdf-lib'i yükler, yalnızca gerekince içe aktarılır
export const PAPER_STYLES: [PaperStyle, string][] = [
  ["blank", "Düz"],
  ["lined", "Çizgili"],
  ["grid", "Kareli"],
];
