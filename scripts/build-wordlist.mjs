#!/usr/bin/env node
// Builds the curated, kid-safe EN->FR word pack shipped in src/data/words.json.
//
// Inputs (download once; see README "Rebuilding the word pack"):
//   data/raw/Lexique383.tsv       Lexique 3.83, CC BY-SA 4.0  (http://www.lexique.org)
//   data/raw/kaikki-French.jsonl  Wiktextract dump of English Wiktionary French entries,
//                                 CC BY-SA 4.0 + GFDL          (https://kaikki.org/dictionary/French/)
//   data/raw/en_50k.txt           English word frequencies (hermitdave/FrequencyWords, CC BY-SA 4.0),
//                                 used only to drop rare English glosses
//   scripts/data/core.txt         hand-curated beginner core (ranked first)
//   scripts/data/emoji.json       hand-picked picture hints for the core
// The output is a derivative of both and is licensed CC BY-SA 4.0 (see NOTICE).
//
// Deterministic: same inputs -> byte-identical output.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'src/data/words.json');
const TARGET = Number(process.env.PM_TARGET || 1500);

const block = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/blocklist.json'), 'utf8'));
const hAspire = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/h-aspire.json'), 'utf8')));
const emojiData = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/unicode-emoji-json/data-by-emoji.json'), 'utf8'));

const enBlock = new Set(block.en.map((w) => w.toLowerCase()));
const frBlock = new Set(block.fr.map((w) => w.toLowerCase()));
const lemmaTags = new Set(block.lemmaTags);
const skipTags = new Set(block.senseSkipTags);
const topicSubs = block.topicSubstrings;
const enExclude = new Set(block.englishExclude);
const homographs = new Set(block.homographs);

// English frequency rank (1 = most common)
const enRank = new Map();
fs.readFileSync(path.join(RAW, 'en_50k.txt'), 'utf8').split('\n').forEach((l, i) => {
  const w = l.split(' ')[0];
  if (w && !enRank.has(w)) enRank.set(w, i + 1);
});
const EN_MAX_RANK = 12000;

// Hand-curated core: english=french:pos, grouped by @topic
const core = [];
{
  let topic = null;
  for (const raw of fs.readFileSync(path.join(ROOT, 'scripts/data/core.txt'), 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('@')) { topic = l.slice(1); continue; }
    const m = /^([a-z]+)=(.+):(n|adj|v)$/.exec(l);
    if (!m) throw new Error(`bad core line: ${l}`);
    core.push({ en: m[1], fr: m[2].normalize('NFC'), pos: m[3], topic });
  }
}
const coreFr = new Set(core.map((c) => `${c.fr}|${c.pos}`));

const words = (s) => s.toLowerCase().normalize('NFC').match(/[\p{L}']+/gu) ?? [];
const blockedEn = (s) => words(s).some((w) => enBlock.has(w) || enBlock.has(w.replace(/'s$/, '')));
const blockedFr = (s) => words(s).some((w) => frBlock.has(w) || w.split("'").some((p) => frBlock.has(p)));

// ---------- 1. Lexique ----------
// Lexique spells œ as "oe" (oeuf, coeur, soeur). Words listed here are re-spelled with œ.
const lexOe = new Set(['oeuf', 'oeufs', 'coeur', 'coeurs', 'soeur', 'soeurs', 'oeil', 'oeuvre', 'oeuvres', 'noeud', 'noeuds', 'voeu', 'voeux', 'boeuf', 'boeufs', 'moeurs', 'oeillet', 'choeur', 'choeurs', 'manoeuvre', 'rancoeur', 'oesophage']);
const POS = { NOM: 'n', ADJ: 'adj', VER: 'v' };
const lex = new Map(); // key `${lemma}|${pos}`
{
  const lines = fs.readFileSync(path.join(RAW, 'Lexique383.tsv'), 'utf8').split('\n');
  const head = lines[0].split('\t');
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < head.length) continue;
    const pos = POS[c[col.cgram]];
    if (!pos) continue;
    const oe = (x) => x.normalize('NFC').replace(/oe(?=[uiil])/g, (m, off, str) => (lexOe.has(str) ? 'œ' : m));
    const lemma = oe(c[col.lemme]);
    if (!/^[a-zàâäçéèêëîïôöùûüÿœæ]{2,}$/.test(lemma) && !coreFr.has(`${lemma}|${pos}`)) continue;
    const k = `${lemma}|${pos}`;
    let e = lex.get(k);
    if (!e) lex.set(k, (e = { lemma, pos, freq: 0, genders: {}, plural: null, pluralFreq: -1, phon: '' }));
    // Blend film-subtitle and book frequencies so the list is less skewed to TV drama.
    e.freq = Math.max(e.freq, ((parseFloat(c[col.freqlemfilms2]) || 0) + (parseFloat(c[col.freqlemlivres]) || 0)) / 2);
    const ortho = oe(c[col.ortho]);
    const g = c[col.genre], n = c[col.nombre];
    if (ortho === lemma) {
      if (g) e.genders[g] = (e.genders[g] || 0) + 1 + (parseFloat(c[col.freqfilms2]) || 0);
      if (!e.phon) e.phon = c[col.phon];
    }
    if (pos === 'n' && n === 'p' && ortho !== lemma && ortho.slice(0, 2) === lemma.slice(0, 2)) {
      const f = parseFloat(c[col.freqfilms2]) || 0;
      if (f > e.pluralFreq) { e.plural = ortho; e.pluralFreq = f; }
    }
  }
}
console.log(`lexique: ${lex.size} lemma/pos pairs`);

// ---------- 2. Wiktionary (kaikki) ----------
const KPOS = { noun: 'n', adj: 'adj', verb: 'v' };
const wik = new Map(); // same key -> { senses: [], unsafe, gender, ipa, plural }
{
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RAW, 'kaikki-French.jsonl')), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (!line.includes('"lang_code": "fr"')) continue;
    const d = JSON.parse(line);
    const w = String(d.word ?? '').normalize('NFC');
    const pos = KPOS[d.pos];
    if (!pos || d.lang_code !== 'fr') continue;
    const k = `${w}|${pos}`;
    if (!lex.has(k) && !coreFr.has(k)) continue;
    let e = wik.get(k);
    if (!e) wik.set(k, (e = { senses: [], unsafe: false, gender: null, ipa: null, plural: null }));
    for (const s of d.senses ?? []) {
      const tags = s.tags ?? [];
      const topics = (s.topics ?? []).join(' ').toLowerCase();
      if (tags.some((t) => lemmaTags.has(t))) e.unsafe = true;
      const gloss = (s.glosses ?? []).at(-1);
      if (!gloss) continue;
      e.senses.push({ gloss, tags, topics, examples: s.examples ?? [] });
    }
    for (const t of d.head_templates ?? []) {
      const g = t.args?.['1'];
      if (!e.gender && (g === 'm' || g === 'f' || g === 'mf')) e.gender = g;
    }
    for (const s of d.sounds ?? []) {
      if (!e.ipa && s.ipa && (!s.tags || s.tags.includes('France') || s.tags.includes('Paris'))) e.ipa = s.ipa;
    }
    for (const f of d.forms ?? []) {
      if (!e.plural && f.tags?.includes('plural') && !f.tags.includes('feminine') && /^[\p{L}-]+$/u.test(f.form)) e.plural = f.form.normalize('NFC');
    }
  }
  console.log(`kaikki: scanned ${n} lines, matched ${wik.size}`);
}

// ---------- 3. Emoji ----------
const emojiByName = new Map();
for (const [emoji, info] of Object.entries(emojiData)) {
  if (info.group === 'Flags' || info.group === 'Symbols') continue;
  if (!emojiByName.has(info.name)) emojiByName.set(info.name, emoji);
}
const emojiBlock = new Set(block.emoji);
const emojiManual = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/emoji.json'), 'utf8'));
const emojiFor = (key) => { const e = emojiByName.get(`${key} face`) ?? emojiByName.get(key) ?? null; return e && !emojiBlock.has(e) ? e : null; };

// ---------- 4. Merge ----------
function englishCandidates(gloss, pos) {
  const g = gloss.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\.$/, '');
  return g.split(/[,;]| or /).map((x) => {
    let t = x.trim().toLowerCase();
    if (pos === 'v') t = t.replace(/^to /, '');
    if (pos === 'n') t = t.replace(/^(a|an|the) /, '');
    return t.trim();
  }).filter((t) => /^[a-z]{3,}$/.test(t));
}
const vowel = /^[aàâäeéèêëiîïoôöuùûüyœæ]/;
function article(fr, g) {
  if (vowel.test(fr) || (fr.startsWith('h') && !hAspire.has(fr))) return "l'";
  return g === 'f' ? 'la' : 'le'; // 'mf' nouns (enfant, élève) default to le
}
const usableSense = (s) => !s.tags.some((t) => skipTags.has(t));
const warnings = [];

function build({ L, W, pos, fr, sense, en, keys, alt, topic, curated }) {
  let gender = null;
  if (pos === 'n') {
    const gs = Object.entries(L?.genders ?? {}).sort((a, b) => b[1] - a[1]);
    gender = W?.gender === 'mf' ? 'mf' : gs[0]?.[0] ?? (W?.gender === 'm' || W?.gender === 'f' ? W.gender : null);
    if (!gender && curated) gender = 'mf';
    if (!gender) return null;
  }
  let ex = null;
  for (const e of sense?.examples ?? []) {
    const tr = e.english ?? e.translation;
    if (!e.text || !tr || e.text.length > 70 || tr.length > 90) continue;
    if (blockedFr(e.text) || blockedEn(tr)) continue;
    ex = { fr: e.text.trim(), en: tr.trim() };
    break;
  }
  const entry = { id: `${fr}.${pos}`, fr, en, keys, alt: alt.filter((a) => !keys.includes(a) && !blockedEn(a) && (enRank.get(a) ?? Infinity) <= 6000).slice(0, 2), pos };
  if (pos === 'n') {
    entry.g = gender;
    entry.art = article(fr, gender);
    const pl = W?.plural ?? L?.plural;
    if (pl && pl !== fr) entry.pl = pl;
  }
  if (W?.ipa) entry.ipa = W.ipa;
  if (ex) entry.ex = ex;
  const emo = keys.map((k) => emojiManual[k]).find(Boolean) ?? (pos !== 'v' ? keys.map(emojiFor).find(Boolean) : null);
  if (emo) entry.emoji = emo;
  if (topic) entry.topic = topic;
  entry.freq = Math.round((L?.freq ?? 0) * 100) / 100;
  if (curated) entry.core = true;
  return entry;
}

// 4a. curated core
const coreEntries = new Map(); // id -> entry
for (const c of core) {
  const k = `${c.fr}|${c.pos}`;
  const L = lex.get(k), W = wik.get(k);
  if (!L && !W) { warnings.push(`core: no data for ${c.fr} (${c.pos}), skipped`); continue; }
  if (W?.unsafe) warnings.push(`core: ${c.fr} has a flagged secondary sense; kept (curated sense "${c.en}")`);
  if (blockedEn(c.en) || blockedFr(c.fr)) { warnings.push(`core: ${c.fr}/${c.en} hits blocklist, skipped`); continue; }
  const id = `${c.fr}.${c.pos}`;
  const existing = coreEntries.get(id);
  if (existing) { existing.keys.push(c.en); continue; }
  const senses = (W?.senses ?? []).filter(usableSense);
  const sense = senses.find((s) => englishCandidates(s.gloss, c.pos).includes(c.en)) ?? senses[0];
  if (W && !senses.some((s) => englishCandidates(s.gloss, c.pos).includes(c.en))) warnings.push(`core: "${c.en}" not in Wiktionary glosses of ${c.fr} (kept, curated)`);
  const e = build({ L, W, pos: c.pos, fr: c.fr, sense, en: c.en, keys: [c.en], alt: sense ? englishCandidates(sense.gloss, c.pos) : [], topic: c.topic, curated: true });
  if (!e) { warnings.push(`core: ${c.fr} has no gender, skipped`); continue; }
  coreEntries.set(id, e);
}
const coreKeys = new Set([...coreEntries.values()].flatMap((e) => e.keys));

// 4b. automatic tail, by frequency
const stats = { noWik: 0, unsafe: 0, noGloss: 0, blocked: 0, excluded: 0, rareEnglish: 0 };
const auto = [];
for (const [k, L] of lex) {
  if (L.freq < 2) continue;
  const id = `${L.lemma}.${L.pos}`;
  if (coreEntries.has(id)) continue;
  const W = wik.get(k);
  if (!W) { stats.noWik++; continue; }
  if (W.unsafe || blockedFr(L.lemma)) { stats.unsafe++; continue; }
  const sense = W.senses.find((s) => usableSense(s) && englishCandidates(s.gloss, L.pos).length);
  if (!sense) { stats.noGloss++; continue; }
  if (sense.tags.includes('plural-only') || sense.tags.includes('in-plural')) { stats.noGloss++; continue; }
  if (topicSubs.some((t) => sense.topics.includes(t)) || blockedEn(sense.gloss)) { stats.blocked++; continue; }
  const en = englishCandidates(sense.gloss, L.pos);
  const key = en[0];
  if (enExclude.has(key)) { stats.excluded++; continue; }
  if ((enRank.get(key) ?? Infinity) > EN_MAX_RANK) { stats.rareEnglish++; continue; }
  const e = build({ L, W, pos: L.pos, fr: L.lemma, sense, en: key, keys: [key], alt: en.slice(1), topic: null, curated: false });
  if (e) auto.push(e);
}
console.log('auto filter', stats, 'candidates', auto.length);

// One French word per English trigger key; core wins, then most frequent.
const keyPos = new Map();
for (const e of [...coreEntries.values(), ...auto]) for (const k of e.keys) {
  if (!keyPos.has(k)) keyPos.set(k, new Set());
  keyPos.get(k).add(e.pos);
}
const byFreq = (a, b) => b.freq - a.freq || a.id.localeCompare(b.id);
const picked = [...coreEntries.values()].sort(byFreq);
const usedKeys = new Set(coreKeys);
for (const e of auto.sort(byFreq)) {
  if (picked.length >= TARGET) break;
  if (usedKeys.has(e.en)) continue;
  usedKeys.add(e.en);
  picked.push(e);
}
for (const e of picked) {
  if (e.pos === 'v' || e.keys.some((k) => homographs.has(k) || keyPos.get(k).size > 1)) e.ctx = true; // swap only with grammatical context
}
picked.forEach((c, i) => { c.rank = i + 1; c.level = i < 250 ? 1 : i < 600 ? 2 : i < 1000 ? 3 : 4; });

const out = {
  schema: 'petit-mot/wordpack',
  version: 1,
  lang: { from: 'en', to: 'fr' },
  license: 'CC BY-SA 4.0',
  sources: [
    { name: 'Lexique 3.83', url: 'http://www.lexique.org', license: 'CC BY-SA 4.0', authors: 'Boris New, Christophe Pallier et al.' },
    { name: 'Wiktionary (via Wiktextract / kaikki.org)', url: 'https://kaikki.org/dictionary/French/', license: 'CC BY-SA 4.0 and GFDL', authors: 'Wiktionary contributors; Tatu Ylonen (Wiktextract)' },
    { name: 'FrequencyWords (English 2018)', url: 'https://github.com/hermitdave/FrequencyWords', license: 'CC BY-SA 4.0', authors: 'Hermit Dave (from OpenSubtitles)' },
    { name: 'unicode-emoji-json', url: 'https://github.com/muan/unicode-emoji-json', license: 'MIT', authors: 'Mu-An Chiou' },
  ],
  count: picked.length,
  words: picked,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
fs.writeFileSync(path.join(ROOT, 'data/build-report.txt'), warnings.join('\n') + '\n');
const by = (p) => picked.filter((w) => w.pos === p).length;
console.log(`${warnings.length} warnings -> data/build-report.txt`);
console.log(`wrote ${picked.length} words (${coreEntries.size} core; ${by('n')} nouns, ${by('adj')} adj, ${by('v')} verbs; ${picked.filter((w) => w.ex).length} examples, ${picked.filter((w) => w.emoji).length} emoji) -> ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
