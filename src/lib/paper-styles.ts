import { translate } from "./i18n";
import type { PaperStyle } from "./blank-book";

// Kâğıt türlerinin adları ayrı durur: blank-book pdf-lib'i yükler, yalnızca gerekince içe aktarılır
export function getPaperStyles(): [PaperStyle, string][] {
  return [
    ["blank", translate("library", "paperBlank")],
    ["lined", translate("library", "paperLined")],
    ["grid", translate("library", "paperGrid")],
  ];
}
