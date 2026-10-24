// Kitaplıktaki PDF'in diskteki yerini dosya gezgininde gösterir. Tarayıcı dosyanın yolunu
// bilmez (PDF IndexedDB'ye kopyalanır); bu yüzden sunucu, kullanıcı klasöründe aynı ad ve
// boyuttaki dosyayı arar. Aynı ad ve boyutta birden çok dosya varsa içerik anahtarı karşılaştırılır.
// Uygulama yerelde (next dev) çalıştığı için gezgin bu bilgisayarda açılır.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const requestSchema = z.object({
  key: z.string(),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const SKIP = new Set(["AppData", "node_modules", "Library", "$Recycle.Bin", "Application Data"]);
const MAX_DEPTH = 8;
const MAX_DIRS = 30_000;

/** Kullanıcı klasöründe adı ve boyutu tutan dosyalar (yakın klasörler önce). */
async function findCandidates(name: string, size: number) {
  const found: string[] = [];
  const queue: [string, number][] = [[homedir(), 0]];
  let visited = 0;
  while (queue.length && visited < MAX_DIRS) {
    const [dir, depth] = queue.shift()!;
    visited++;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith(".") && !SKIP.has(entry.name)) queue.push([path, depth + 1]);
      } else if (entry.name.normalize("NFC") === name && (await stat(path).catch(() => null))?.size === size) {
        found.push(path);
      }
    }
  }
  return found;
}

/** file-store.ts'teki contentKey'in sunucu karşılığı (yalnızca SHA-256 anahtarları). */
async function contentKey(path: string) {
  const hash = createHash("sha256").update(await readFile(path)).digest();
  return "pdf:" + hash.subarray(0, 16).toString("hex");
}

function reveal(path: string) {
  const os = platform();
  // explorer.exe başarılı olsa da 1 döndürür; hata yok sayılır
  if (os === "win32") execFile("explorer.exe", ["/select,", path], () => {});
  else if (os === "darwin") execFile("open", ["-R", path], () => {});
  else execFile("xdg-open", [dirname(path)], () => {});
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Geçersiz istek." }, { status: 400 });
  const { key, size } = parsed.data;
  const name = parsed.data.name.normalize("NFC");

  const candidates = await findCandidates(name, size);
  let match = candidates[0];
  if (candidates.length > 1 && key.startsWith("pdf:")) {
    for (const path of candidates) {
      if ((await contentKey(path).catch(() => null)) === key) {
        match = path;
        break;
      }
    }
  }
  if (!match) return Response.json({ found: false });
  reveal(match);
  return Response.json({ found: true });
}
