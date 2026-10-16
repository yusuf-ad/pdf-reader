"use client";

import { exportQuestions, importQuestions } from "./questions";
import { exportData, importData, type Backup } from "./storage";

// Tüm kullanıcı verilerinin (kelimeler, notlar, vurgular, okuma durumu, sorular) tek bir JSON
// dosyasına yedeklenmesi. PDF'lerin kendisi yedeğe girmez; notlar kitaba PDF'in içeriğinden
// üretilen anahtarla bağlı olduğu için aynı PDF yeniden eklenince notları da gelir.

type FullBackup = Backup & { questions?: Awaited<ReturnType<typeof exportQuestions>> };

export async function downloadBackup() {
  const backup: FullBackup = { ...exportData(), questions: await exportQuestions().catch(() => []) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `okuma-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Yedeği mevcut verilerle birleştirir; hiçbir şey silinmez. */
export async function restoreBackup(file: File) {
  let backup: FullBackup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("Dosya okunamadı; bir yedek dosyası seç.");
  }
  importData(backup);
  if (Array.isArray(backup.questions)) await importQuestions(backup.questions);
}
