import { describe, it, expect } from 'vitest';
import { PACK, WORDS } from '@/src/words';
import block from '../scripts/data/blocklist.json';

const enBlock = new Set<string>(block.en);
const frBlock = new Set<string>(block.fr);
const tokens = (s: string) => s.toLowerCase().match(/[\p{L}']+/gu) ?? [];

describe('word pack integrity', () => {
  it('has ~1,500 words with license and sources', () => {
    expect(PACK.schema).toBe('petit-mot/wordpack');
    expect(PACK.count).toBe(WORDS.length);
    expect(WORDS.length).toBeGreaterThanOrEqual(1400);
    expect(WORDS.length).toBeLessThanOrEqual(1600);
    expect(PACK.license).toBe('CC BY-SA 4.0');
    expect(PACK.sources.map((s) => s.name).join()).toMatch(/Lexique/);
    expect(PACK.sources.map((s) => s.name).join()).toMatch(/Wiktionary/);
  });

  it('ids are unique and stable (fr.pos)', () => {
    const ids = WORDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of WORDS) expect(w.id).toBe(`${w.fr}.${w.pos}`);
  });

  it('each English trigger maps to exactly one French word', () => {
    const keys = WORDS.flatMap((w) => w.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]{3,}$/);
  });

  it('nouns have a gender and the right article (with elision)', () => {
    for (const w of WORDS.filter((x) => x.pos === 'n')) {
      expect(['m', 'f', 'mf']).toContain(w.g);
      expect(['le', 'la', "l'"]).toContain(w.art);
      if (/^[aeiouyàâéèêëîïôöùûüœæ]/i.test(w.fr)) expect(w.art).toBe("l'");
    }
    const get = (id: string) => WORDS.find((w) => w.id === id)!;
    expect(get('chien.n')).toMatchObject({ g: 'm', art: 'le', pl: 'chiens' });
    expect(get('maison.n')).toMatchObject({ g: 'f', art: 'la' });
    expect(get('eau.n')).toMatchObject({ g: 'f', art: "l'" });
    expect(get('œil.n').pl).toBe('yeux');
  });

  it('ranks and levels are consistent; the curated core comes first', () => {
    WORDS.forEach((w, i) => expect(w.rank).toBe(i + 1));
    for (let i = 1; i < WORDS.length; i++) expect(WORDS[i].level).toBeGreaterThanOrEqual(WORDS[i - 1].level);
    const lastCore = WORDS.findLastIndex((w) => w.core);
    expect(WORDS.slice(0, lastCore + 1).every((w) => w.core)).toBe(true);
    expect(WORDS.filter((w) => w.core).length).toBeGreaterThan(250);
  });

  it('contains no blocklisted word anywhere (kid-safety)', () => {
    for (const w of WORDS) {
      for (const t of tokens(w.fr)) expect(frBlock.has(t), `${w.id} fr`).toBe(false);
      for (const t of [...w.keys, ...w.alt, w.en].flatMap(tokens)) expect(enBlock.has(t), `${w.id} en ${t}`).toBe(false);
      if (w.ex) {
        for (const t of tokens(w.ex.fr)) expect(frBlock.has(t), `${w.id} ex.fr ${t}`).toBe(false);
        for (const t of tokens(w.ex.en)) expect(enBlock.has(t), `${w.id} ex.en ${t}`).toBe(false);
      }
      if (w.emoji) expect(block.emoji).not.toContain(w.emoji);
    }
  });

  it('verbs and homographs are marked for context-only swapping', () => {
    for (const w of WORDS.filter((x) => x.pos === 'v')) expect(w.ctx).toBe(true);
    expect(WORDS.find((w) => w.keys.includes('watch'))?.ctx).toBe(true);
  });

  it('examples are short and bilingual', () => {
    const ex = WORDS.filter((w) => w.ex);
    expect(ex.length).toBeGreaterThan(200);
    for (const w of ex) { expect(w.ex!.fr.length).toBeLessThanOrEqual(70); expect(w.ex!.en.length).toBeGreaterThan(0); }
  });
});
