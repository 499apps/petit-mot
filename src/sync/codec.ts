import type { Profile, XpLog } from '../types';
import type { Deck, StoredCard } from '../srs';
import { SHARED_KEYS, type SharedSettings, type SyncState } from './model';

/**
 * Compact encoding for chrome.storage.sync, which allows 102,400 bytes in total, 8,192 bytes
 * per item (key plus JSON value) and 512 items.
 *
 * Items (all prefixed "pm."):
 *   pm.v               format version
 *   pm.s               shared settings
 *   pm.t               removed learners {id: ms}
 *   pm.p.<id>          a learner {n,a,l,c,u}
 *   pm.d.<id>.<n>      deck shard n: "wordId=card~wordId=card…"
 *   pm.x.<id>.<n>      XP shard n:   "day:xp;day:xp…" (day = days since 2020-01-01, base 36)
 * A card is "due,last,stability,difficulty,elapsed,scheduled,steps,reps,lapses,state":
 * times are minutes since the Unix epoch in base 36, and floats are rounded to 4 decimals.
 */
export const FORMAT = 1;
export const PREFIX = 'pm.';
export const QUOTA_BYTES = 102_400;
export const QUOTA_BYTES_PER_ITEM = 8_192;
export const MAX_ITEMS = 512;
export const SAFETY_BYTES = 2_048; // headroom for metadata and rounding
const SHARD_BYTES = QUOTA_BYTES_PER_ITEM - 256;

const enc = new TextEncoder();
export const bytes = (s: string) => enc.encode(s).length;
/** Bytes chrome.storage.sync charges for one item. */
export const itemBytes = (key: string, value: unknown) => bytes(key) + bytes(JSON.stringify(value));
export const totalBytes = (items: Record<string, unknown>) => Object.entries(items).reduce((n, [k, v]) => n + itemBytes(k, v), 0);

const b36 = (n: number) => Math.round(n).toString(36);
const unb36 = (s: string) => parseInt(s, 36);
const num = (n: number) => String(Number(n.toFixed(4)));
const minutes = (iso: string) => b36(Date.parse(iso) / 60000);
const fromMinutes = (s: string) => new Date(unb36(s) * 60000).toISOString();

export function encodeCard(c: StoredCard): string {
  return [minutes(c.due), c.last_review ? minutes(c.last_review) : '', num(c.stability), num(c.difficulty), c.elapsed_days, c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state].join(',');
}
export function decodeCard(s: string): StoredCard | null {
  const f = s.split(',');
  if (f.length !== 10) return null;
  const [due, last, stab, diff, el, sch, steps, reps, lapses, state] = f;
  const n = [stab, diff, el, sch, steps, reps, lapses, state].map(Number);
  if (n.some((x) => !Number.isFinite(x)) || !Number.isFinite(unb36(due))) return null;
  const card: StoredCard = { due: fromMinutes(due), stability: n[0], difficulty: n[1], elapsed_days: n[2], scheduled_days: n[3], learning_steps: n[4], reps: n[5], lapses: n[6], state: n[7] };
  if (last) card.last_review = fromMinutes(last);
  return card;
}

/** Split "a~b~c" style records into values that each fit one sync item. */
function shard(keyBase: string, records: string[], sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string[] = [], size = 0, n = 0;
  const flush = () => { if (cur.length) { out[`${keyBase}.${n++}`] = cur.join(sep); cur = []; size = 0; } };
  for (const r of records) {
    const b = bytes(r) + 1;
    if (size + b > SHARD_BYTES - bytes(keyBase) - 8) flush();
    cur.push(r); size += b;
  }
  flush();
  return out;
}

export function encodeDeck(profileId: string, deck: Deck): Record<string, string> {
  const recs = Object.keys(deck).sort().filter((id) => !/[=~,]/.test(id)).map((id) => `${id}=${encodeCard(deck[id])}`);
  return shard(`${PREFIX}d.${profileId}`, recs, '~');
}
export function decodeDeckShard(value: string): Deck {
  const deck: Deck = {};
  for (const rec of String(value).split('~')) {
    const i = rec.indexOf('=');
    if (i <= 0) continue;
    const card = decodeCard(rec.slice(i + 1));
    if (card) deck[rec.slice(0, i)] = card;
  }
  return deck;
}

const EPOCH = Date.UTC(2020, 0, 1);
const dayNum = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000); };
const dayKeyOf = (n: number) => new Date(EPOCH + n * 86_400_000).toISOString().slice(0, 10);
export function encodeXp(profileId: string, xp: XpLog): Record<string, string> {
  const recs = Object.keys(xp).sort().filter((d) => (xp[d][profileId] ?? 0) > 0).map((d) => `${b36(dayNum(d))}:${b36(xp[d][profileId])}`);
  return shard(`${PREFIX}x.${profileId}`, recs, ';');
}
export function decodeXpShard(profileId: string, value: string, into: XpLog): void {
  for (const rec of String(value).split(';')) {
    const [d, v] = rec.split(':');
    const day = unb36(d), amount = unb36(v);
    if (!Number.isFinite(day) || !Number.isFinite(amount) || amount <= 0) continue;
    const k = dayKeyOf(day);
    into[k] = { ...(into[k] ?? {}), [profileId]: Math.max(into[k]?.[profileId] ?? 0, amount) };
  }
}

const encProfile = (p: Profile) => ({ n: p.name, a: p.avatar, l: p.level, c: p.createdAt, u: p.updatedAt ?? 0 });
function decProfile(id: string, v: unknown): Profile | null {
  const o = v as { n?: unknown; a?: unknown; l?: unknown; c?: unknown; u?: unknown };
  if (!o || typeof o.n !== 'string' || typeof o.a !== 'string') return null;
  const level = [1, 2, 3, 4].includes(Number(o.l)) ? (Number(o.l) as Profile['level']) : 1;
  return { id, name: o.n.slice(0, 24), avatar: o.a.slice(0, 16), level, createdAt: typeof o.c === 'string' ? o.c : new Date(0).toISOString(), ...(Number(o.u) ? { updatedAt: Number(o.u) } : {}) };
}

/** What a full sync looks like, split into the profile/settings part and the bulky decks. */
export function encodeState(s: SyncState): { core: Record<string, unknown>; decks: Record<string, string> } {
  const core: Record<string, unknown> = { [`${PREFIX}v`]: FORMAT };
  if (s.settings) core[`${PREFIX}s`] = s.settings;
  if (Object.keys(s.tombstones).length) core[`${PREFIX}t`] = s.tombstones;
  for (const p of s.profiles) {
    core[`${PREFIX}p.${p.id}`] = encProfile(p);
    Object.assign(core, encodeXp(p.id, s.xp));
  }
  const decks: Record<string, string> = {};
  for (const p of s.profiles) if (s.decks[p.id] && Object.keys(s.decks[p.id]).length) Object.assign(decks, encodeDeck(p.id, s.decks[p.id]));
  return { core, decks };
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** Read whatever is in sync (possibly partial or from a newer version) into a state. */
export function decodeState(items: Record<string, unknown>): SyncState & { format: number | null } {
  const s: SyncState & { format: number | null } = { profiles: [], decks: {}, xp: {}, settings: null, tombstones: {}, format: null };
  for (const [k, v] of Object.entries(items)) {
    if (!k.startsWith(PREFIX)) continue;
    const parts = k.slice(PREFIX.length).split('.');
    const [kind, id] = parts;
    if (kind === 'v') s.format = Number(v) || null;
    else if (kind === 's' && v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (SHARED_KEYS.every((x) => x in o)) s.settings = { ...(o as unknown as SharedSettings), updatedAt: Number(o.updatedAt) || 0 };
    } else if (kind === 't' && v && typeof v === 'object') {
      for (const [pid, ms] of Object.entries(v as Record<string, unknown>)) if (ID.test(pid) && Number(ms) > 0) s.tombstones[pid] = Number(ms);
    } else if (kind === 'p' && id && ID.test(id)) {
      const p = decProfile(id, v);
      if (p) s.profiles.push(p);
    } else if (kind === 'd' && id && ID.test(id) && typeof v === 'string') {
      s.decks[id] = { ...(s.decks[id] ?? {}), ...decodeDeckShard(v) };
    } else if (kind === 'x' && id && ID.test(id) && typeof v === 'string') {
      decodeXpShard(id, v, s.xp);
    }
  }
  s.profiles.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return s;
}

export interface Plan { set: Record<string, unknown>; remove: string[]; bytes: number; items: number; full: boolean }
/**
 * Decide what to write. If everything fits, sync it all. If the decks don't fit, sync
 * learners, XP and settings only, leave the decks already in sync untouched, and report full.
 */
export function planWrite(next: SyncState, current: Record<string, unknown>): Plan {
  const { core, decks } = encodeState(next);
  const all = { ...core, ...decks };
  const fits = (o: Record<string, unknown>) => totalBytes(o) <= QUOTA_BYTES - SAFETY_BYTES && Object.keys(o).length <= MAX_ITEMS;
  const full = !fits(all);
  const keepOldDecks = Object.fromEntries(Object.entries(current).filter(([k]) => k.startsWith(`${PREFIX}d.`)));
  let target = full ? { ...core, ...keepOldDecks } : all;
  if (full && !fits(target)) target = core; // even old decks don't fit next to the new core
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(target)) if (JSON.stringify(current[k]) !== JSON.stringify(v)) set[k] = v;
  const remove = Object.keys(current).filter((k) => k.startsWith(PREFIX) && !(k in target));
  return { set, remove, bytes: totalBytes(target), items: Object.keys(target).length, full };
}
