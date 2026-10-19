// Notlu PDF'in nereye kaydedileceği. Destekleyen tarayıcılarda (Chrome, Edge) ilk kayıtta
// dosya seçtirilir, seçilen dosya kitap başına hatırlanır ve sonraki kayıtlar sormadan oraya
// yazılır. Diğerlerinde her seferinde indirilir.
//
// İzin isteme ve kayıt penceresi yalnızca kullanıcı bir tuşa/düğmeye bastıktan hemen sonra
// açılabilir; bu yüzden hedef, PDF hazırlanmadan önce belirlenir.
import { getSaveHandle, setSaveHandle } from "./file-store";

type Permissioned = FileSystemFileHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
};

type Picker = (o: object) => Promise<FileSystemFileHandle>;

const picker = () => (window as { showSaveFilePicker?: Picker }).showSaveFilePicker;

/** "download": tarayıcı dosya yazmayı desteklemiyor, indirilir. null: vazgeçildi. */
export type SaveTarget = FileSystemFileHandle | "download" | null;

async function writable(handle: Permissioned) {
  const opts = { mode: "readwrite" } as const;
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission?.(opts)) === "granted";
}

// Bu oturumda kayıt penceresiyle yeni oluşturulan dosyalar (henüz içi boş)
const fresh = new WeakSet<FileSystemFileHandle>();

async function pick(name: string): Promise<SaveTarget> {
  const show = picker();
  if (!show) return "download";
  try {
    const handle = await show({
      suggestedName: name,
      types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
    });
    fresh.add(handle);
    return handle;
  } catch (err) {
    if ((err as Error).name === "AbortError") return null;
    return "download"; // pencere açılamadı (ör. iframe)
  }
}

/** Kaydedilecek yer: hatırlanan dosya ya da (ilk kez / farklı kaydet) seçilen yeni dosya. */
export async function chooseTarget(book: string, name: string, saveAs: boolean): Promise<SaveTarget> {
  if (!saveAs && picker()) {
    const saved = await getSaveHandle(book).catch(() => null);
    if (saved && (await writable(saved).catch(() => false))) return saved;
  }
  return pick(name);
}

/**
 * Otomatik kayıt için: hatırlanan dosya, yalnızca yazma izni bu oturumda zaten verildiyse.
 * İzin istenemez (kullanıcı bir şeye basmadı), o yüzden hiçbir pencere açmaz.
 */
export async function autoTarget(book: string): Promise<FileSystemFileHandle | null> {
  if (!picker()) return null;
  const saved = (await getSaveHandle(book).catch(() => null)) as Permissioned | null;
  if (!saved?.queryPermission) return saved;
  const state = await saved.queryPermission({ mode: "readwrite" }).catch(() => "denied");
  return state === "granted" ? saved : null;
}

/**
 * Kayıt başarısız olduysa, kayıt penceresinin az önce oluşturduğu boş dosyayı siler.
 * Daha önce kaydedilmiş (içi dolu) dosyaya dokunmaz.
 */
export async function discardTarget(target: SaveTarget) {
  if (!target || target === "download" || !fresh.has(target)) return;
  fresh.delete(target);
  await (target as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => {});
}

/** PDF'i hedefe yazar ve hedefi hatırlar. */
export async function writeTarget(book: string, target: FileSystemFileHandle | "download", bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  if (target === "download") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  try {
    const stream = await target.createWritable();
    await stream.write(blob);
    await stream.close();
    fresh.delete(target);
  } catch (err) {
    // Dosya taşındı/silindi: bir dahaki kayıtta yeniden sorulsun
    await setSaveHandle(book, null).catch(() => {});
    throw err;
  }
  await setSaveHandle(book, target).catch(() => {});
}
