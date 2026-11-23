"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { clearAiSettings, getAiSettings, setAiSettings, type AiProvider } from "@/lib/ai-settings";

const TEXT = {
  title: "Yapay zekâ ayarları",
  provider: "Sağlayıcı",
  google: "Google Gemini — ücretsiz anahtar",
  openai: "OpenAI",
  key: "API anahtarı",
  show: "Göster",
  hide: "Gizle",
  getGoogleKey: "Ücretsiz Gemini anahtarı al ↗",
  getOpenAiKey: "OpenAI anahtarı al ↗",
  model: "Model (isteğe bağlı)",
  modelPlaceholder: "default",
  modelHint: "Boş bırakırsanız sunucunun varsayılan modeli kullanılır.",
  privacy: "Anahtarınız yalnızca bu tarayıcıda saklanır ve her yapay zekâ isteğiyle gönderilir; sunucuda hiçbir zaman kaydedilmez.",
  save: "Kaydet",
  remove: "Anahtarı kaldır",
  close: "Kapat",
};

// Split view renders two toolbars. Elect one host so there is only one dialog.
const hosts = new Set<symbol>();
const hostListeners = new Set<() => void>();
const hostSnapshot = () => hosts.values().next().value ?? null;
const serverHostSnapshot = () => null;
const notifyHosts = () => hostListeners.forEach((listener) => listener());

export default function AiSettingsDialog() {
  const [host] = useState(() => Symbol());
  const subscribeHost = useCallback((listener: () => void) => {
    hosts.add(host);
    hostListeners.add(listener);
    notifyHosts();
    return () => {
      hosts.delete(host);
      hostListeners.delete(listener);
      notifyHosts();
    };
  }, [host]);
  const owner = useSyncExternalStore(subscribeHost, hostSnapshot, serverHostSnapshot);
  return owner === host ? <SettingsDialog /> : null;
}

function SettingsDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [provider, setProvider] = useState<AiProvider>("google");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const open = () => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.open) return;
      const settings = getAiSettings();
      setProvider(settings?.provider ?? "google");
      setKey(settings?.key ?? "");
      setModel(settings?.model ?? "");
      setShowKey(false);
      dialog.showModal();
    };
    window.addEventListener("ai-settings:open", open);
    return () => window.removeEventListener("ai-settings:open", open);
  }, []);

  const close = () => dialogRef.current?.close();
  const inputClass = "w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-privacy`}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto border border-rule bg-sheet p-6 text-ink shadow-[0_8px_30px_var(--shadow)] backdrop:bg-scrim"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
      onClose={() => {
        setKey("");
        setShowKey(false);
      }}
    >
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim()) return;
        setAiSettings({ provider, key, ...(model.trim() ? { model: model.trim() } : {}) });
        close();
      }}>
        <div className="flex items-baseline justify-between gap-4">
          <h2 id={`${id}-title`} className="font-serif text-xl">{TEXT.title}</h2>
          <button type="button" onClick={close} className="text-xs text-muted hover:text-ink">{TEXT.close}</button>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm">{TEXT.provider}</legend>
          {([ ["google", TEXT.google], ["openai", TEXT.openai] ] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="radio"
                name={`${id}-provider`}
                value={value}
                checked={provider === value}
                onChange={() => {
                  setProvider(value);
                  setKey("");
                  setModel("");
                  setShowKey(false);
                }}
                className="accent-accent"
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label htmlFor={`${id}-key`} className="mt-4 mb-2 block text-sm">{TEXT.key}</label>
        <div className="flex gap-2">
          <input
            id={`${id}-key`}
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            className={`${inputClass} min-w-0 flex-1 font-mono`}
          />
          <button type="button" aria-controls={`${id}-key`} aria-pressed={showKey} onClick={() => setShowKey((shown) => !shown)} className="border border-rule px-3 text-xs text-muted hover:text-ink">
            {showKey ? TEXT.hide : TEXT.show}
          </button>
        </div>
        <a
          href={provider === "google" ? "https://aistudio.google.com/apikey" : "https://platform.openai.com/api-keys"}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-accent underline underline-offset-2"
        >
          {provider === "google" ? TEXT.getGoogleKey : TEXT.getOpenAiKey}
        </a>

        <label htmlFor={`${id}-model`} className="mt-4 mb-2 block text-sm">{TEXT.model}</label>
        <input id={`${id}-model`} value={model} onChange={(event) => setModel(event.target.value)} placeholder={TEXT.modelPlaceholder} aria-describedby={`${id}-model-hint`} autoComplete="off" spellCheck={false} className={inputClass} />
        <p id={`${id}-model-hint`} className="mt-2 text-xs text-muted">{TEXT.modelHint}</p>
        <p id={`${id}-privacy`} className="mt-5 border-t border-rule pt-4 text-xs leading-relaxed text-muted">{TEXT.privacy}</p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" onClick={() => { clearAiSettings(); close(); }} className="text-xs text-muted hover:text-accent">{TEXT.remove}</button>
          <button type="submit" disabled={!key.trim()} className="border border-ink bg-ink px-4 py-2 text-sm text-sheet disabled:opacity-40">{TEXT.save}</button>
        </div>
      </form>
    </dialog>
  );
}
