import pack from './data/words.json';
import type { Word, WordPack } from './types';

export const PACK = pack as unknown as WordPack;
export const WORDS: Word[] = PACK.words;
export const BY_ID = new Map(WORDS.map((w) => [w.id, w]));

export type Form = 'base' | 'plural';
export interface Match { word: Word; form: Form }

/** English regular/irregular plurals for noun keys. */
const IRREGULAR: Record<string, string> = {
  man: 'men', woman: 'women', child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice',
  person: 'people', goose: 'geese', leaf: 'leaves', knife: 'knives', wolf: 'wolves', life: 'lives',
  wife: 'wives', half: 'halves', shelf: 'shelves', loaf: 'loaves', sheep: 'sheep', fish: 'fish',
};
export function englishPlural(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (/[^aeiou]o$/.test(w) && ['potato', 'tomato', 'hero', 'echo'].includes(w)) return w + 'es';
  return w + 's';
}

/** Lower-case English token -> match. Built once. */
export function buildIndex(words: Word[] = WORDS): Map<string, Match> {
  const idx = new Map<string, Match>();
  for (const word of words) {
    for (const k of word.keys) {
      if (!idx.has(k)) idx.set(k, { word, form: 'base' });
      if (word.pos === 'n') {
        const p = englishPlural(k);
        if (p !== k && !idx.has(p)) idx.set(p, { word, form: 'plural' });
      }
    }
  }
  return idx;
}

/** The French form to show for a match. */
export function frenchForm(m: Match): string {
  if (m.form === 'plural' && m.word.pos === 'n') return m.word.pl ?? (/[sxz]$/.test(m.word.fr) ? m.word.fr : m.word.fr + 's');
  return m.word.fr;
}

/** "le chien", "l'eau", "manger", "rouge" */
export function withArticle(w: Word): string {
  if (!w.art) return w.fr;
  return w.art === "l'" ? `l'${w.fr}` : `${w.art} ${w.fr}`;
}

export function indefinite(w: Word): string | null {
  if (w.pos !== 'n' || !w.g) return null;
  return `${w.g === 'f' ? 'une' : 'un'} ${w.fr}`;
}

export const GENDER_LABEL = { m: 'masculine', f: 'feminine', mf: 'masculine or feminine' } as const;
export const POS_LABEL = { n: 'noun', adj: 'describing word', v: 'action word' } as const;
