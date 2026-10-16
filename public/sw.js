// Service worker: uygulamanın kendisini (sayfa, betikler, pdf.js, ikonlar) önbelleğe alır;
// internet yokken de açılır. Kullanıcı verileri burada değil, IndexedDB'de durur.
// API istekleri (çeviri, sohbet) hiçbir zaman önbellekten verilmez.

const CACHE = "okuma-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/** Önce ağ (güncel sürüm), ağ yoksa önbellek. */
async function networkFirst(request) {
  try {
    return await put(request, await fetch(request));
  } catch (err) {
    const cached = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match("/") : null);
    if (cached) return cached;
    throw err;
  }
}

/** Önce önbellek; dosya adında sürüm özeti olanlar için (hiç değişmezler). */
async function cacheFirst(request) {
  return (await caches.match(request)) ?? put(request, await fetch(request));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
