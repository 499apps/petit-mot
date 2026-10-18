import { BY_ID, PACK, WORDS } from './words';
import type { Word } from './types';

/**
 * Challenge codes let family members on different computers challenge each other with no
 * server: a short text you copy and paste (chat, a note, read it aloud...). It carries a
 * nickname, an emoji, the word list, a quiz seed and a score; nothing else.
 */
export interface Challenge {
  kind: 'challenge' | 'reply';
  id: string; // short id derived from the original challenge
  from: { name: string; avatar: string; score: number | null };
  words: string[]; // word ids
  seed: number;
  replyTo?: { name: string; avatar: string; score: number | null }; // reply only: the original challenger
}

const PREFIX = 'PM1';
export const MIN_WORDS = 3;
export const MAX_WORDS = 12;

function crc32(s: string): number {
  let c = ~0;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i);
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));

export function cleanName(n: string): string {
  return [...n].filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>').join('').trim().slice(0, 24) || 'Someone';
}
export function cleanAvatar(a: string): string {
  const seg = [...a.trim()].slice(0, 4).join('');
  return seg || '🙂';
}

export function newChallengeId(seed: number): string {
  return (seed >>> 0).toString(36).padStart(6, '0').slice(-6);
}

export function encode(c: Challenge): string {
  const body = {
    k: c.kind === 'reply' ? 'r' : 'c', i: c.id, v: PACK.version,
    f: [cleanName(c.from.name), cleanAvatar(c.from.avatar), c.from.score],
    w: c.words, s: c.seed >>> 0,
    ...(c.replyTo ? { t: [cleanName(c.replyTo.name), cleanAvatar(c.replyTo.avatar), c.replyTo.score] } : {}),
  };
  const payload = b64url(JSON.stringify(body));
  const sum = crc32(payload).toString(36);
  return `${PREFIX}-${payload}-${sum}`;
}

export class CodeError extends Error {}

export function decode(code: string): Challenge {
  const clean = code.replace(/\s+/g, '');
  const m = /^PM1-([A-Za-z0-9_-]+)-([0-9a-z]+)$/.exec(clean);
  if (!m) throw new CodeError("That doesn't look like a Petit Mot code. It should start with PM1-.");
  if (crc32(m[1]).toString(36) !== m[2]) throw new CodeError('This code is incomplete or has a typo. Ask for it again and copy all of it.');
  let body: { k: string; i: string; v: number; f: [string, string, number | null]; w: string[]; s: number; t?: [string, string, number | null] };
  try { body = JSON.parse(unb64url(m[1])); } catch { throw new CodeError('This code could not be read.'); }
  if (!Array.isArray(body.w) || body.w.length < MIN_WORDS || body.w.length > MAX_WORDS) throw new CodeError('This code has the wrong number of words.');
  const unknown = body.w.filter((id) => !BY_ID.has(id));
  if (unknown.length) throw new CodeError('This code was made with a different version of Petit Mot. Update both computers and try again.');
  const score = (x: unknown) => (typeof x === 'number' && x >= 0 && x <= body.w.length ? Math.round(x) : null);
  if (!Array.isArray(body.f) || typeof body.i !== 'string' || !/^[0-9a-z]{1,8}$/.test(body.i)) throw new CodeError('This code could not be read.');
  return {
    kind: body.k === 'r' ? 'reply' : 'challenge',
    id: body.i,
    from: { name: cleanName(String(body.f[0] ?? '')), avatar: cleanAvatar(String(body.f[1] ?? '')), score: score(body.f[2]) },
    words: body.w,
    seed: Number(body.s) >>> 0,
    ...(body.t ? { replyTo: { name: cleanName(String(body.t[0] ?? '')), avatar: cleanAvatar(String(body.t[1] ?? '')), score: score(body.t[2]) } } : {}),
  };
}

/** Small deterministic PRNG so both computers build the exact same quiz. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Question { word: Word; options: string[]; answer: number }

/** Four-choice quiz: French word -> pick the English meaning. Same seed, same quiz. */
export function buildQuiz(wordIds: string[], seed: number, pool: Word[] = WORDS): Question[] {
  const rand = rng(seed);
  return wordIds.map((id) => {
    const word = BY_ID.get(id)!;
    const same = pool.filter((w) => w.pos === word.pos && w.en !== word.en && !word.keys.includes(w.en) && Math.abs(w.level - word.level) <= 1);
    const picks = new Set<string>();
    let guard = 0;
    while (picks.size < 3 && guard++ < 200) picks.add(same[Math.floor(rand() * same.length)].en);
    const options = [...picks, word.en];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { word, options, answer: options.indexOf(word.en) };
  });
}
