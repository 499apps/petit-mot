export type Pos = 'n' | 'adj' | 'v';
export type Gender = 'm' | 'f' | 'mf';

/** One entry of the shipped word pack (src/data/words.json). */
export interface Word {
  id: string; // stable: `${fr}.${pos}`
  fr: string;
  en: string; // main English meaning (display)
  keys: string[]; // English words that can be swapped for this entry
  alt: string[]; // extra English meanings (display only)
  pos: Pos;
  g?: Gender;
  art?: 'le' | 'la' | "l'";
  pl?: string;
  ipa?: string;
  ex?: { fr: string; en: string };
  emoji?: string;
  topic?: string;
  freq: number;
  core?: boolean;
  ctx?: boolean; // only swap with clear grammatical context
  rank: number;
  level: 1 | 2 | 3 | 4;
}

export interface WordPack {
  schema: 'petit-mot/wordpack';
  version: number;
  lang: { from: string; to: string };
  license: string;
  sources: { name: string; url: string; license: string; authors: string }[];
  count: number;
  words: Word[];
}

export interface Profile {
  id: string;
  name: string;
  avatar: string; // emoji
  level: 1 | 2 | 3 | 4;
  createdAt: string;
  updatedAt?: number; // ms; last edit, used to merge edits from other computers
}

export interface Settings {
  density: number; // words swapped per page, 3-10
  huntWords: number; // words to find per Word Hunt round
  huntTimer: 0 | 60 | 120; // seconds, 0 = no timer
  graceDays: number; // missed days in a row that don't break the family streak
  voiceURI: string | null;
  autoSites: string[]; // origins with opt-in auto-sprinkle
  showEmoji: boolean;
  syncEnabled: boolean; // this computer: sync progress through the user's own Chrome sync
  updatedAt?: number; // ms; last change to the shared settings (density, hunt, grace, emoji)
}

export const DEFAULT_SETTINGS: Settings = {
  density: 5,
  huntWords: 5,
  huntTimer: 0,
  graceDays: 2,
  voiceURI: null,
  autoSites: [],
  showEmoji: true,
  syncEnabled: true,
};

/** XP earned per profile per local day: { '2026-10-18': { profileId: 25 } } */
export type XpLog = Record<string, Record<string, number>>;
