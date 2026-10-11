"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, Reference } from "@/lib/chat";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Bir sonraki soruya eklenecek seçili metin */
  reference: Reference | null;
  onClearReference: () => void;
  /** Her dosyanın sohbeti ayrı tutulur */
  chatId: string;
  title: string | null;
};

export default function ChatModal(props: Props) {
  // Sohbet kapatılınca kaybolmasın diye bileşen hep bağlı kalır, yalnızca gizlenir
  return (
    <div
      className={`fixed inset-0 z-40 items-center justify-center bg-ink/25 ${props.open ? "flex" : "hidden"}`}
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <ChatWindow key={props.chatId} {...props} />
    </div>
  );
}

function ChatWindow({ open, onClose, reference, onClearReference, chatId, title }: Props) {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages } = useChat<ChatMessage>({
    id: chatId,
  });
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, reference]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (busy) stop();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, stop, onClose]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (text === "/clear") {
      setMessages([]);
      return;
    }
    sendMessage({ text, metadata: reference ? { reference } : undefined });
    onClearReference();
  };

  return (
    <div
      role="dialog"
      aria-label="Sohbet"
      className="flex h-[min(80vh,760px)] w-[min(760px,92vw)] flex-col border border-rule bg-sheet shadow-[0_12px_40px_var(--shadow)]"
    >
      <header className="flex items-baseline gap-3 border-b border-rule px-5 py-3">
        <h2 className="font-serif text-lg">Sor</h2>
        {title && <span className="min-w-0 flex-1 truncate text-xs text-muted">{title}</span>}
        <div className="ml-auto flex shrink-0 gap-4 text-xs text-muted">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="hover:text-ink" disabled={busy}>
              Yeni sohbet
            </button>
          )}
          <button onClick={onClose} className="hover:text-ink">
            Kapat <Kbd>Esc</Kbd>
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="py-8 text-sm leading-relaxed text-muted">
            <p>
              PDF&apos;te bir bölüm seç ve <Kbd>Ctrl K</Kbd> ile buraya ekle; o bölüm hakkında
              istediğini sor.
            </p>
            <ul className="mt-3 space-y-1 font-serif text-[15px] text-ink/80">
              <li>“Bu cümleyi daha sade anlatır mısın?”</li>
              <li>“Buradaki dilbilgisi yapısı ne?”</li>
              <li>“Bahsedilen kişi kim, ne zaman yaşamış?”</li>
            </ul>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="space-y-1.5">
                {m.metadata?.reference && <ReferenceQuote reference={m.metadata.reference} />}
                <div className="flex gap-2">
                  <span className="font-mono text-muted select-none">›</span>
                  <p className="whitespace-pre-wrap">{textOf(m)}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="chat-md font-serif text-[16px] leading-relaxed">
                <ReactMarkdown>{textOf(m)}</ReactMarkdown>
              </div>
            ),
          )}

          {status === "submitted" && (
            <p className="animate-pulse font-mono text-xs text-muted">düşünüyor…</p>
          )}
          {error && (
            <div className="text-sm text-accent">
              Cevap alınamadı: {error.message}{" "}
              <button onClick={() => regenerate()} className="underline underline-offset-2">
                Tekrar dene
              </button>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-rule px-5 pt-3 pb-2">
        {reference ? (
          <div className="mb-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ReferenceQuote reference={reference} />
            </div>
            <button
              onClick={onClearReference}
              className="text-xs text-muted hover:text-accent"
              aria-label="Seçili metni kaldır"
            >
              Kaldır
            </button>
          </div>
        ) : (
          <p className="mb-2 text-xs text-muted">
            Referans yok. PDF&apos;te seçip <Kbd>Ctrl K</Kbd> ile ekleyebilirsin.
          </p>
        )}
        <div className="flex items-end gap-2">
          <span className="pb-1.5 font-mono text-muted select-none">›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, input.split("\n").length)}
            placeholder={reference ? "Seçili metin hakkında sor…" : "Bir şey sor…"}
            className="flex-1 resize-none bg-transparent py-1 leading-relaxed outline-none placeholder:text-muted"
          />
          {busy && (
            <button onClick={stop} className="pb-1.5 text-xs text-muted hover:text-accent">
              Durdur
            </button>
          )}
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          enter gönder · shift+enter yeni satır · /clear sohbeti temizle · esc {busy ? "durdur" : "kapat"}
        </p>
      </div>
    </div>
  );
}

function ReferenceQuote({ reference }: { reference: Reference }) {
  const words = reference.text.split(/\s+/).length;
  return (
    <div className="border-l-2 border-accent/60 pl-3">
      <p className="text-[11px] text-muted">
        Seçili metin{reference.page && ` · s. ${reference.page}`}
        {words > 1 && ` · ${words} kelime`}
      </p>
      <p className="line-clamp-3 font-serif text-[15px] leading-snug text-ink/80">
        {reference.text}
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-rule px-1 py-px font-mono text-[11px] text-muted">{children}</kbd>
  );
}

const textOf = (m: ChatMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
