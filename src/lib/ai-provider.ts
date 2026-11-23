import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, streamText, Tool } from "ai";

/**
 * Bring-your-own-key: istemci key'i her istekte header'la gönderir, sunucu onunla modeli kurar.
 * Key hiçbir yerde saklanmaz ya da loglanmaz. Header yoksa self-host için env key'e düşer.
 * Header adları istemciyle (src/lib/ai-settings.ts) sabit sözleşmedir.
 */
export const AI_HEADERS = {
  provider: "x-ai-provider",
  key: "x-ai-key",
  model: "x-ai-model",
} as const;

export const AI_PROVIDERS = ["openai", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

const DEFAULT_MODELS: Record<AiProvider, () => string> = {
  openai: () => process.env.OPENAI_MODEL || "gpt-6-luna",
  google: () => process.env.GOOGLE_MODEL || "gemini-3.8-flash",
};

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

export type Ai = {
  provider: AiProvider;
  model: LanguageModel;
  /** Sağlayıcının kendi web arama aracı; araç adı her sağlayıcıda `web_search` olarak verilmeli. */
  webSearch: () => Tool;
  /** streamText/generateText'e geçilecek sağlayıcıya özel ayarlar. */
  providerOptions: ProviderOptions;
};

const isProvider = (v: string | null): v is AiProvider =>
  v !== null && (AI_PROVIDERS as readonly string[]).includes(v);

// Model adı yalnızca harf, rakam ve birkaç ayraç; header'dan gelen değer doğrudan URL'e gidiyor
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,100}$/;

function build(provider: AiProvider, apiKey: string, modelId: string): Ai {
  if (provider === "google") {
    const google = createGoogleGenerativeAI({ apiKey });
    return {
      provider,
      model: google(modelId),
      webSearch: () => google.tools.googleSearch({}),
      providerOptions: {},
    };
  }
  const openai = createOpenAI({ apiKey });
  return {
    provider,
    model: openai(modelId),
    webSearch: () => openai.tools.webSearch({ searchContextSize: "medium" }),
    // Geçmiş mesajlar OpenAI'da saklanan kimlikle değil içerikle gönderilir
    providerOptions: { openai: { store: false } },
  };
}

/** İstekten modeli kurar; key yoksa (header da env de) null döner → `missingKeyResponse()`. */
export function getAi(req: Request): Ai | null {
  const headerKey = req.headers.get(AI_HEADERS.key)?.trim();
  const headerProvider = req.headers.get(AI_HEADERS.provider);
  const headerModel = req.headers.get(AI_HEADERS.model)?.trim();

  if (headerKey && headerKey.length <= 500 && isProvider(headerProvider)) {
    const modelId = headerModel && MODEL_RE.test(headerModel) ? headerModel : DEFAULT_MODELS[headerProvider]();
    return build(headerProvider, headerKey, modelId);
  }

  // Self-host: kullanıcı key girmediyse sunucunun env key'i (Vercel demosunda tanımlı değil)
  if (process.env.OPENAI_API_KEY) return build("openai", process.env.OPENAI_API_KEY, DEFAULT_MODELS.openai());
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    return build("google", process.env.GOOGLE_GENERATIVE_AI_API_KEY, DEFAULT_MODELS.google());
  return null;
}

export function missingKeyResponse() {
  return Response.json(
    { error: "missing_api_key", message: "Add your API key in AI settings to use AI features." },
    { status: 401 },
  );
}

/** Sağlayıcı hatasını istemcinin anlayacağı koda çevirir; key'i ya da ham hatayı dışarı vermez. */
export function aiErrorCode(err: unknown): "invalid_api_key" | "rate_limited" | "ai_error" {
  const status = (err as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  return "ai_error";
}
