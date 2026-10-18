import { describe, it, expect } from 'vitest';
import { WORDS, frenchForm } from '@/src/words';
import over from '../scripts/data/overrides.json';

// Guards for the v0.1.1 word-quality audit. Every case here was a real defect in v0.1.
const byId = new Map(WORDS.map((w) => [w.id, w]));
const get = (id: string) => {
  const w = byId.get(id);
  if (!w) throw new Error(`missing ${id}`);
  return w;
};
const byKey = (k: string) => WORDS.find((w) => w.keys.includes(k));

describe('word quality: false friends and wrong senses', () => {
  it.each([
    ['sage.adj', /wise/, /cautious/],
    ['pièce.n', /room/, /^etc$/],
    ['argent.n', /money/, /^silver$/],
    ['journal.n', /newspaper/, /^diary$/],
    ['seul.adj', /alone/, /^lonely$/],
    ['essayer.v', /try/, /test/],
    ['passer.v', /pass/, /cross/],
    ['doux.adj', /soft/, /^sweet$/],
    ['hôtel.n', /hotel/, /mansion/],
    ['génial.adj', /awesome/, /ingenious/],
    ['bord.n', /edge/, /border/],
    ['conseil.n', /advice/, /council/],
    ['attraper.v', /catch/, /trap/],
    ['nerveux.adj', /nervous/, /^nerve$/],
    ['fond.n', /bottom/, /^back$/],
    ['angle.n', /corner/, /buildings/],
    ['madame.n', /madam/, /title/],
  ])('%s means %s, not %s', (id, good, bad) => {
    const w = get(id);
    expect(w.en).toMatch(good);
    expect(w.en).not.toMatch(bad);
    expect(w.keys.some((k) => bad.test(k))).toBe(false);
  });

  it('keeps correct glosses for classic false friends', () => {
    expect(get('large.adj').en).toBe('wide');
    expect(get('sensible.adj').en).toBe('sensitive');
    expect(get('cave.n').en).toBe('cellar');
    expect(get('lecture.n').en).toBe('reading');
    expect(get('attendre.v').en).toBe('wait');
    expect(get('rester.v').en).toBe('stay');
  });

  it('dropped false friends and broken entries are gone', () => {
    for (const id of ['simple.adj', 'supporter.v', 'fixer.v', 'prévenir.v', 'rentrer.v', 'emmener.v', 'travers.n', 'détacher.v', 'recouvrir.v', 'race.n', 'chair.n', 'mille.n', 'fonder.v', 'user.v']) {
      expect(byId.has(id), id).toBe(false);
    }
    for (const id of Object.keys(over.drop)) expect(byId.has(id), id).toBe(false);
  });

  it('no gloss is a parsing artifact', () => {
    const junk = new Set(['etc', 'out', 'something', 'completely', 'seen', 'stains', 'buildings', 'charge', 'procedure', 'score', 'socks', 'paste', 'stopping', 'upside', 'term']);
    for (const w of WORDS) {
      expect(junk.has(w.en), `${w.id} = ${w.en}`).toBe(false);
      for (const k of w.keys) expect(junk.has(k), `${w.id} key ${k}`).toBe(false);
    }
  });

  it('English triggers that are other words are not used (found = past of find)', () => {
    expect(byKey('found')).toBeUndefined();
    expect(byKey('user')).toBeUndefined();
  });
});

describe('word quality: grammar', () => {
  it('genders and plurals that v0.1 got wrong', () => {
    expect(get('bus.n')).toMatchObject({ g: 'm', art: 'le' });
    const plural = (id: string) => frenchForm({ word: get(id), form: 'plural' } as Parameters<typeof frenchForm>[0]);
    expect(plural('ours.n')).toBe('ours');
    expect(plural('héros.n')).toBe('héros');
    expect(plural('anglais.n')).toBe('anglais');
    expect(get('pomme de terre.n').pl).toBe('pommes de terre');
    expect(get('œil.n').pl).toBe('yeux');
    expect(get('cheval.n').pl).toBe('chevaux');
  });

  it('no noun has a feminine form posing as its plural', () => {
    const irregular = new Set(['yeux', 'cieux', 'mesdames', 'messieurs', 'mesdemoiselles', 'aïeux', 'bonshommes', 'gentilshommes', 'gentlemen']);
    for (const w of WORDS.filter((x) => x.pos === 'n' && x.pl)) {
      const fr = w.fr, pl = w.pl!;
      const ok = pl === fr + 's' || pl === fr + 'x' || pl.endsWith('aux') || irregular.has(pl) || (fr.includes('-') || fr.includes(' '));
      expect(ok, `${fr} -> ${pl}`).toBe(true);
    }
  });

  it('invariable nouns keep their form in the plural', () => {
    const m = (id: string) => frenchForm({ word: get(id), form: 'plural' } as Parameters<typeof frenchForm>[0]);
    expect(m('pays.n')).toBe('pays');
    expect(m('nez.n')).toBe('nez');
    expect(m('chien.n')).toBe('chiens');
  });

  it('days, months and languages are capitalised in English', () => {
    expect(get('dimanche.n').en).toBe('Sunday');
    expect(get('juillet.n').en).toBe('July');
    expect(get('français.adj').en).toBe('French');
    expect(get('anglais.n').en).toBe('English');
  });

  it('pronominal verbs are shown with their pronoun', () => {
    expect(get("s'asseoir.v").en).toBe('sit down');
    expect(get('se disputer.v').keys).toContain('argue');
  });
});

describe('word quality: examples are relevant and kid-appropriate', () => {
  it('known-bad examples are removed', () => {
    for (const id of ['nécessaire.adj', 'sueur.n', 'malin.adj', 'noir.adj', 'attaquer.v', 'envahir.v', 'facile.adj', 'chaussure.n']) {
      expect(get(id).ex, id).toBeUndefined();
    }
  });

  it('no example contains a blocked phrase', () => {
    for (const w of WORDS.filter((x) => x.ex)) {
      const t = `${w.ex!.fr} ${w.ex!.en}`.toLowerCase();
      for (const b of over.exampleBlock) expect(t.includes(b.toLowerCase()), `${w.id}: ${b}`).toBe(false);
    }
  });

  it('examples show the word: the English line contains the meaning (or was vouched for)', () => {
    const keep = new Set(over.keepExample);
    for (const w of WORDS.filter((x) => x.ex && !keep.has(x.id))) {
      const t = w.ex!.en.toLowerCase();
      const stems = [...w.keys, ...w.en.toLowerCase().split(/[^a-z]+/)].filter((k) => k.length >= 3).map((k) => k.slice(0, Math.max(3, k.length - 2)));
      expect(stems.some((s) => t.includes(s)), `${w.id}: ${w.ex!.en}`).toBe(true);
    }
  });
});
