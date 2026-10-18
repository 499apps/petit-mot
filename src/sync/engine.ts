import type { Profile, XpLog } from '../types';
import type { Deck } from '../srs';
import { getSettings, normalizeSettings } from '../store';
import { canonical, mergeState, sharedSettings, type SyncState } from './model';
import { decodeState, planWrite, PREFIX, QUOTA_BYTES } from './codec';

/**
 * Keeps chrome.storage.local (what the app reads) and chrome.storage.sync (Chrome carries it
 * between the family's computers through their own Google account) in step. Petit Mot itself
 * makes no network calls: Chrome does the syncing.
 *
 * Loop-safe: local and sync are merged, each side gets only the keys that changed, and
 * re-running on the merged result writes nothing.
 */
export type SyncStateName = 'ok' | 'full' | 'off' | 'busy' | 'error';
export interface SyncStatus { state: SyncStateName; at: number; bytes?: number; quota?: number; items?: number; message?: string }

const local = () => browser.storage.local;
const sync = () => browser.storage.sync;

export async function readLocal(): Promise<SyncState> {
  const all = await local().get(null);
  const decks: Record<string, Deck> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('deck:')) decks[k.slice(5)] = v as Deck;
  const settings = normalizeSettings(all.settings as never);
  return {
    profiles: (all.profiles as Profile[] | undefined) ?? [],
    decks,
    xp: (all.xp as XpLog | undefined) ?? {},
    settings: all.settings ? sharedSettings(settings) : null,
    tombstones: (all.tombstones as Record<string, number> | undefined) ?? {},
  };
}

/** Write the merged state locally, touching only what changed. */
export async function writeLocal(next: SyncState, before: SyncState): Promise<string[]> {
  const set: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  if (!same(next.profiles, before.profiles)) set.profiles = next.profiles;
  if (!same(next.xp, before.xp)) set.xp = next.xp;
  if (!same(next.tombstones, before.tombstones)) set.tombstones = next.tombstones;
  for (const [id, deck] of Object.entries(next.decks)) if (!same(deck, before.decks[id] ?? {})) set[`deck:${id}`] = deck;
  if (next.settings && !same(next.settings, before.settings)) {
    const cur = await getSettings();
    set.settings = normalizeSettings({ ...cur, ...next.settings });
  }
  const remove = Object.keys(before.decks).filter((id) => !(id in next.decks)).map((id) => `deck:${id}`);
  if (Object.keys(set).length) await local().set(set);
  if (remove.length) await local().remove(remove);
  return [...Object.keys(set), ...remove];
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  return ((await local().get('syncStatus')).syncStatus as SyncStatus | undefined) ?? null;
}
const setStatus = (s: SyncStatus) => local().set({ syncStatus: s });

let running: Promise<SyncStatus> | null = null;
/** Pull, merge, push. Safe to call any time; concurrent calls share one run. */
export function syncNow(now = Date.now()): Promise<SyncStatus> {
  if (!running) running = run(now).finally(() => { running = null; });
  return running;
}

async function run(now: number): Promise<SyncStatus> {
  const settings = await getSettings();
  if (!settings.syncEnabled || !browser.storage.sync) {
    const st: SyncStatus = { state: 'off', at: now };
    await setStatus(st);
    return st;
  }
  try {
    const remoteItems = await sync().get(null);
    const mine = Object.fromEntries(Object.entries(remoteItems).filter(([k]) => k.startsWith(PREFIX)));
    const before = await readLocal();
    const merged = mergeState(before, decodeState(mine));
    await writeLocal(merged, before);
    const plan = planWrite(merged, mine);
    if (Object.keys(plan.set).length) await sync().set(plan.set);
    if (plan.remove.length) await sync().remove(plan.remove);
    const st: SyncStatus = { state: plan.full ? 'full' : 'ok', at: now, bytes: plan.bytes, quota: QUOTA_BYTES, items: plan.items };
    await setStatus(st);
    return st;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const st: SyncStatus = /QUOTA_BYTES|MAX_ITEMS/i.test(msg) ? { state: 'full', at: now, message: msg }
      : /MAX_WRITE_OPERATIONS|MAX_SUSTAINED/i.test(msg) ? { state: 'busy', at: now, message: msg }
        : { state: 'error', at: now, message: msg };
    await setStatus(st);
    return st;
  }
}

/** Local keys whose changes should be pushed. */
export const isSyncedKey = (k: string) => k === 'profiles' || k === 'xp' || k === 'settings' || k === 'tombstones' || k.startsWith('deck:');

let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced sync. Many quick answers become one write (sync allows 120 writes a minute). */
export function scheduleSync(delayMs = 3000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow().then((s) => { if (s.state === 'busy') scheduleSync(60_000); }); }, delayMs);
}

/** Remove Petit Mot's items from Chrome sync (used by "Delete everything"). */
export async function clearSync(): Promise<void> {
  if (!browser.storage.sync) return;
  const keys = Object.keys(await sync().get(null)).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await sync().remove(keys);
}

export function describeStatus(s: SyncStatus | null, enabled: boolean): string {
  if (!enabled) return 'Sync is off. Progress is saved on this computer only.';
  if (!s) return 'Waiting for the first sync…';
  const when = new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
  switch (s.state) {
    case 'ok': return `✓ Synced with Chrome at ${when} · ${kb(s.bytes ?? 0)} of ${kb(s.quota ?? QUOTA_BYTES)} used.`;
    case 'full': return `Chrome sync is full. Learners, XP, streak and settings still sync, but new word progress is saved on this computer only. Use “Back up to file” to move everything.`;
    case 'busy': return `Chrome asked us to slow down. We'll try again in a minute (last try ${when}).`;
    case 'off': return 'Sync is off. Progress is saved on this computer only.';
    default: return `Sync didn't work (${s.message ?? 'unknown error'}). Progress is safe on this computer.`;
  }
}
