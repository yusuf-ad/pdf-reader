# Launch Plan — GitHub + LinkedIn

Kararlar (grill oturumu, 2026-11-23):

- Hedef: önce ilk izlenim (canlı demo + GIF), sonra gerçek kullanım.
- Vercel'de public demo. Vercel env'de **OPENAI_API_KEY olmayacak**.
- BYOK: key tarayıcıda (localStorage), her istekte header ile `/api/*`'ye gider; sunucu key'i saklamaz/loglamaz. Env key sadece self-host fallback'i.
- Provider v1: **OpenAI + Google Gemini** (Gemini = ücretsiz key, varsayılan öneri). OpenRouter / Anthropic / Ollama → v2.
- Key yoksa: okuma, highlight, not, export çalışır; AI butonları "API key ekle" CTA'sı gösterir.
- İlk açılış: örnek PDF + atlanabilir 3–4 adımlık ipucu turu.
- Dil: README İngilizce. UI: İngilizce varsayılan + Türkçe (i18n sözlük, tarayıcı diline göre). AI cevap dili UI diline göre.
- Mobil: "en iyi masaüstünde" uyarısı + temel okuma kırılmasın. Tam mobil → v2.
- Veri: "verilerin bu tarayıcıda" uyarısı + görünür "Yedeği indir" butonu.
- Güvenlik: key'siz istek route'un ilk satırında 401; rate limit Vercel Firewall'dan.
- Lisans: MIT. Video: en son, kullanıcı çeker.

## Ortak sözleşme (paralel çalışma için — değiştirme)

İstemci → sunucu header'ları:

| Header | Değer |
|---|---|
| `x-ai-provider` | `openai` \| `google` |
| `x-ai-key` | kullanıcının key'i |
| `x-ai-model` | opsiyonel; yoksa provider varsayılanı |
| `x-ui-lang` | `en` \| `tr` (Wave 3'te eklenir) |

Key'siz ve env fallback'siz istek → `401 { error: "missing_api_key" }`. İstemci bu kodu görünce ayarlar diyaloğunu açar.

## Sıfırıncı adım (kullanıcı)

- [ ] Şu anki uncommitted değişiklikleri commit'le, `upgrade/next-16.4.6`'yı `main`'e merge et. Paralel ajanlar temiz bir tabandan başlamalı.

## Wave 1 — paralel, dosyaları çakışmaz

| ID | Görev | Dosyalar (sahiplik) | Ajan |
|---|---|---|---|
| **T1** | `src/lib/ai-provider.ts`: request header'larından model oluştur (`@ai-sdk/openai`, `@ai-sdk/google`), env fallback, 401 helper, provider'a göre web search tool (OpenAI `webSearch` / Google `googleSearch`), provider başına varsayılan model. Key asla loglanmaz. | `src/lib/ai-provider.ts`, `package.json` | Claude |
| **T3** | İstemci ayarları: `src/lib/ai-settings.ts` (localStorage, try/catch), `useAiSettings` hook, `aiHeaders()` helper; `src/components/ai-settings-dialog.tsx` (provider seç, key gir, model dropdown, "Gemini ücretsiz key al" linki, "key sadece bu tarayıcıda" notu, key'i sil). Toolbar'a açma butonu. | yeni dosyalar + `toolbar.tsx` | Codex |
| **T8** | Veri uyarısı + "Yedeği indir/yükle" butonu (`backup.ts`'i kullan), ilk açılışta bir kez gösterilen bilgi notu. | `storage-gate.tsx`, `library.tsx`, `backup.ts` | Codex |
| **T9a** | `LICENSE` (MIT, yusuf), `.env.example` yorumları (self-host için), `package.json`'a `description`, `repository`, `license`. | `LICENSE`, `.env.example` | Codex (T1 bitince `package.json`) |

## Wave 2 — Wave 1'e bağlı

| ID | Görev | Bağımlılık | Dosyalar | Ajan |
|---|---|---|---|---|
| **T2** | 4 route'u (`chat`, `translate`, `toc`, `book-profile`) T1'e geçir; `openai(...)` ve `process.env` doğrudan kullanımı kalmasın. | T1 | `src/app/api/**` | Claude |
| **T4** | İstemci tüm AI fetch'lerine `aiHeaders()` eklesin (`useChat` transport dahil). Key yoksa AI butonları CTA göstersin; 401 `missing_api_key` gelirse ayarlar açılsın. | T3 (+T2 test için) | `chat-modal.tsx`, `translation-popover.tsx`, `src/lib/chat.ts`, `generated-toc.ts`, `book-context.ts`, `questions.ts`, `quiz.ts` vb. AI çağıran yerler | Codex |
| **T6** | Onboarding: `public/samples/` altına telif sorunsuz örnek PDF (public domain), ilk açılışta kütüphaneye otomatik ekle (bir kere); `shortcuts-dialog`'a "Getting started" sekmesi / 3–4 adımlık atlanabilir ipucu. | T3 (tur "key ekle" adımını gösterir) | `library.tsx` dışında yeni `onboarding.tsx`, `shortcuts-dialog.tsx`, `public/samples/` | Codex |
| **T7** | Mobil: dar ekranda "Best on desktop" bandı; kütüphane ve okuyucu 375px'te yatay scroll/kırık layout olmasın. | — (ama `globals.css` çakışmasın diye Wave 2) | `globals.css`, `reader.tsx` layout kısmı | Codex |

## Wave 3 — i18n (UI stabil olunca)

| ID | Görev | Ajan |
|---|---|---|
| **T5a** | i18n altyapısı: `src/lib/i18n/{en,tr}.ts`, `useT()` hook, tarayıcı diline göre seçim + ayarlarda dil seçici, `x-ui-lang` header'ı; route'larda sistem prompt'una cevap dili. | Claude |
| **T5b** | String taşıma: `library`, `toolbar`, `left-panel`, `storage-gate`, `shortcuts-dialog`, `onboarding` | Codex |
| **T5c** | String taşıma: `reader`, `pdf-viewer`, `annotation-layer`, `highlight-*`, `sticky-note`, `notes-list`, `note-writer`, `crop-layer` | Codex |
| **T5d** | String taşıma: `chat-modal`, `questions`, `quiz`, `word-list`, `word-proposal`, `translation-popover`, `ai-settings-dialog` | Codex |

T5b/c/d paralel çalışır, her biri sadece kendi anahtar grubunu (`library.*`, `reader.*`, `ai.*`) sözlüğe ekler.

## Wave 4 — yayın

| ID | Görev | Kim |
|---|---|---|
| **T9b** | README (EN): GIF, tek cümle + Live Demo butonu, özellikler + ekran görüntüleri, "Get a free Gemini key in 3 steps", gizlilik notu, self-host kurulumu, tech stack, lisans. | Claude |
| **T10** | QA: `npm run lint` + `npm run build` temiz; key'siz / OpenAI / Gemini ile her AI özelliği elle test; production'da service worker kontrolü. | Claude |
| **T11** | Vercel: projeyi bağla, env'e **key koyma**, Firewall rate-limit kuralı (`/api/*`, IP başına ~20 istek/dk), domain. | Kullanıcı (adımları Claude hazırlar) |
| **T12** | Repo: description, topics, social preview görseli, public yap. | Kullanıcı |
| **T13** | 30–60 sn video + README GIF'i + LinkedIn postu (TR + EN). Senaryo Claude'dan. | Kullanıcı |

## v2 (şimdilik yapılmayacak)

OpenRouter, Anthropic, Ollama/lokal model; tam mobil uyum; cihazlar arası senkron; testler.
