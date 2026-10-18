import type { Profile, Settings, XpLog } from '../types';
import type { Deck, StoredCard } from '../srs';

/**
 * Everything that follows a family between computers. Challenges, Word Hunt history, the
 * active learner, the chosen voice and always-on sites stay on each computer.
 */
export interface SharedSettings { density: number; huntWords: number; huntTimer: Settings['huntTimer']; graceDays: number; showEmoji: boolean; updatedAt: number }
export interface SyncState {
  profiles: Profile[];
  decks: Record<string, Deck>; // profileId -> deck
  xp: XpLog;
  settings: SharedSettings | null;
  tombstones: Record<string, number>; // removed profileId -> ms
}
export const emptyState = (): SyncState => ({ profiles: [], decks: {}, xp: {}, settings: null, tombstones: {} });

export const SHARED_KEYS = ['density', 'huntWords', 'huntTimer', 'graceDays', 'showEmoji'] as const;
export function sharedSettings(s: Settings): SharedSettings {
  return { density: s.density, huntWords: s.huntWords, huntTimer: s.huntTimer, graceDays: s.graceDays, showEmoji: s.showEmoji, updatedAt: s.updatedAt ?? 0 };
}

const t = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);
/** Per card, the most recent review wins (ties: more reviews, then this computer's copy). */
export function newerCard(a: StoredCard | undefined, b: StoredCard | undefined): StoredCard | undefined {
  if (!a) return b;
  if (!b) return a;
  const ta = t(a.last_review), tb = t(b.last_review);
  if (tb !== ta) return tb > ta ? b : a;
  return b.reps > a.reps ? b : a;
}
export function mergeDeck(a: Deck = {}, b: Deck = {}): Deck {
  const out: Deck = { ...a };
  for (const [id, card] of Object.entries(b)) out[id] = newerCard(a[id], card)!;
  return out;
}
/** XP: union of days; for the same learner and day, the larger total wins (XP only ever grows). */
export function mergeXp(a: XpLog = {}, b: XpLog = {}): XpLog {
  const out: XpLog = {};
  for (const day of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = a[day] ?? {}, db = b[day] ?? {};
    const row: Record<string, number> = {};
    for (const id of new Set([...Object.keys(da), ...Object.keys(db)])) row[id] = Math.max(da[id] ?? 0, db[id] ?? 0);
    out[day] = row;
  }
  return out;
}
const stamp = (p: Profile) => p.updatedAt ?? t(p.createdAt);
export function mergeProfiles(a: Profile[], b: Profile[], tomb: Record<string, number>): Profile[] {
  const map = new Map<string, Profile>();
  for (const p of [...a, ...b]) {
    if (tomb[p.id]) continue;
    const cur = map.get(p.id);
    if (!cur || stamp(p) > stamp(cur)) map.set(p.id, p);
  }
  // Keep this computer's order, then newcomers by creation time.
  const order = [...a.map((p) => p.id), ...b.filter((p) => !a.some((x) => x.id === p.id)).sort((x, y) => t(x.createdAt) - t(y.createdAt)).map((p) => p.id)];
  return [...new Set(order)].map((id) => map.get(id)).filter((p): p is Profile => !!p);
}

/** Merge two copies of the family's data. Commutative for content; `a` (this computer) wins exact ties. */
export function mergeState(a: SyncState, b: SyncState): SyncState {
  const tombstones = { ...a.tombstones };
  for (const [id, ms] of Object.entries(b.tombstones)) tombstones[id] = Math.max(tombstones[id] ?? 0, ms);
  const profiles = mergeProfiles(a.profiles, b.profiles, tombstones);
  const alive = new Set(profiles.map((p) => p.id));
  const decks: Record<string, Deck> = {};
  for (const id of new Set([...Object.keys(a.decks), ...Object.keys(b.decks)])) {
    if (tombstones[id]) continue;
    if (!alive.has(id) && !a.decks[id]) continue; // a deck from elsewhere whose learner never arrived
    decks[id] = mergeDeck(a.decks[id], b.decks[id]);
  }
  const xp = mergeXp(a.xp, b.xp);
  for (const row of Object.values(xp)) for (const id of Object.keys(row)) if (tombstones[id]) delete row[id];
  for (const [day, row] of Object.entries(xp)) if (!Object.keys(row).length) delete xp[day];
  const settings = !a.settings ? b.settings : !b.settings ? a.settings : b.settings.updatedAt > a.settings.updatedAt ? b.settings : a.settings;
  return { profiles, decks, xp, settings, tombstones };
}

/** Stable JSON (sorted keys) for comparisons and checksums. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
