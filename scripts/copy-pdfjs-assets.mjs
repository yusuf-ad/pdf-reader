// pdf.js'in çalışma zamanında ihtiyaç duyduğu dosyaları public/pdfjs altına kopyalar:
// wasm (taranmış PDF'lerdeki JBIG2/JPEG2000 görüntüleri), cmaps, standart fontlar, ICC profilleri.
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = path.dirname(require.resolve("pdfjs-dist/package.json"));
const dest = path.join(process.cwd(), "public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
for (const dir of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log("pdf.js dosyaları kopyalandı:", dest);
