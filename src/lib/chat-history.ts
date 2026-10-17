"use client";

import { useMemo } from "react";
import type { ChatMessage } from "./chat";
import { skillLabel } from "./skills";
import { bookKey, get, set, useStored } from "./storage";

// Sohbet geçmişi (kitap başına, birden çok sohbet). "Yeni sohbet" eskisini silmez; eski
// sohbetler Geçmiş listesinden yeniden açılır. Açılışta en son konuşulan sohbet gelir.

export type ChatSession = {
  id: string;
  /** İlk sorudan çıkarılan başlık */
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

const EMPTY: ChatSession[] = [];

const key = (chatId: string) => bookKey("chat", chatId);

export const newSessionId = () => Math.random().toString(36).slice(2, 10);

/** Önceden tek sohbet (mesaj listesi) saklanıyordu; o da bir oturum olarak okunur. */
function normalize(value: unknown): ChatSession[] {
  if (!Array.isArray(value) || !value.length) return EMPTY;
  if ("role" in value[0]) {
    const messages = value as ChatMessage[];
    return [{ id: "eski", title: titleOf(messages), updatedAt: 0, messages }];
  }
  return value as ChatSession[];
}

const load = (chatId: string) => normalize(get(key(chatId)));

/** En yeni üstte. */
export function useChatSessions(chatId: string) {
  const raw = useStored<unknown>(key(chatId), EMPTY);
  return useMemo(() => [...normalize(raw)].sort((a, b) => b.updatedAt - a.updatedAt), [raw]);
}

export function latestSession(chatId: string): ChatSession | undefined {
  return load(chatId).reduce<ChatSession | undefined>((a, s) => (!a || s.updatedAt > a.updatedAt ? s : a), undefined);
}

export function loadSession(chatId: string, sessionId: string): ChatMessage[] {
  return load(chatId).find((s) => s.id === sessionId)?.messages ?? [];
}

function write(chatId: string, sessions: ChatSession[]) {
  set(key(chatId), sessions.length ? sessions : undefined);
}

export function saveSession(chatId: string, sessionId: string, messages: ChatMessage[]) {
  const others = load(chatId).filter((s) => s.id !== sessionId);
  if (!messages.length) return write(chatId, others);
  const last = messages.length - 1;
  const session: ChatSession = {
    id: sessionId,
    title: titleOf(messages),
    updatedAt: Date.now(),
    messages: messages.map((m, i) => {
      const skill = m.metadata?.skill;
      // Skill'in okuduğu sayfa metinleri (tüm kitap olabilir) yalnızca o istekte gönderilir;
      // sonrasında gerekmez. Son mesajsa "Tekrar dene" için kalır.
      if (!skill?.pages.length || i === last) return m;
      return { ...m, metadata: { ...m.metadata, skill: { ...skill, pages: [] } } };
    }),
  };
  write(chatId, [...others, session]);
}

export function deleteSession(chatId: string, sessionId: string) {
  write(chatId, load(chatId).filter((s) => s.id !== sessionId));
}

function titleOf(messages: ChatMessage[]) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Sohbet";
  const meta = first.metadata;
  const text = first.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
  const title = meta?.skill
    ? skillLabel(meta.skill)
    : text || meta?.reference?.text || (first.parts.some((p) => p.type === "file") ? "Görsel" : "Sohbet");
  return title.replace(/\s+/g, " ").slice(0, 120);
}
