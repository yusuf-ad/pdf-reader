export type Translation = {
  word: string;
  wordTranslation: string;
  partOfSpeech: string;
  sentenceTranslation: string;
};

export type SavedWord = Translation & {
  id: string;
  sentence: string;
  page: number | null;
  fileName: string | null;
  createdAt: number;
  /** Sohbetten eklenen kelimelerde eş anlamlılar */
  synonyms?: string[];
};
