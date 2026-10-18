import { DEFAULT_SETTINGS, type Profile, type Settings, type XpLog } from './types';
import { review, type Answer, type Deck } from './srs';
import { dayKey } from './dates';
import { XP } from './family';

/**
 * The app reads and writes chrome.storage.local. When "Sync progress with Chrome" is on, the
 * background mirrors learners, decks, XP and shared settings to chrome.storage.sync
 * (see src/sync). No accounts of ours, no server.
 * Keys: profiles, active, settings, xp, deck:<profileId>, challenges, hunts, tombstones, syncStatus
 */
export interface LocalChallenge {
  id: string;
  createdAt: string;
  words: string[];
  seed: number;
  fromId: string | null; // local profile who created it (null = imported)
  fromName: string;
  fromAvatar: string;
  toId: string | null; // local recipient, or null for a code sent to another computer
  scores: { name: string; avatar: string; score: number; profileId?: string }[];
  total: number;
}
export interface HuntRecord { at: string; players: { id: string; score: number }[]; winner: string | null }

const area = () => browser.storage.local;

export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  const v = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  v.density = Math.min(10, Math.max(3, Math.round(Number(v.density) || DEFAULT_SETTINGS.density)));
  v.huntWords = Math.min(8, Math.max(3, Math.round(Number(v.huntWords) || DEFAULT_SETTINGS.huntWords)));
  v.huntTimer = ([0, 60, 120] as const).includes(v.huntTimer) ? v.huntTimer : 0;
  v.graceDays = Math.min(3, Math.max(0, Math.round(Number(v.graceDays))));
  v.autoSites = Array.isArray(v.autoSites) ? v.autoSites.filter((x) => typeof x === 'string') : [];
  v.showEmoji = v.showEmoji !== false;
  v.syncEnabled = v.syncEnabled !== false;
  return v;
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings((await area().get('settings')).settings as Partial<Settings>);
}
const SHARED: (keyof Settings)[] = ['density', 'huntWords', 'huntTimer', 'graceDays', 'showEmoji'];
export async function saveSettings(patch: Partial<Settings>, now = Date.now()): Promise<Settings> {
  const before = await getSettings();
  const s = normalizeSettings({ ...before, ...patch });
  if (SHARED.some((k) => s[k] !== before[k])) s.updatedAt = now; // shared settings: newest edit wins across computers
  await area().set({ settings: s });
  return s;
}

export async function getProfiles(): Promise<{ profiles: Profile[]; active: Profile | null }> {
  const r = await area().get(['profiles', 'active']);
  const profiles = (r.profiles as Profile[] | undefined) ?? [];
  const active = profiles.find((p) => p.id === r.active) ?? profiles[0] ?? null;
  return { profiles, active };
}
export async function saveProfiles(profiles: Profile[], activeId?: string | null, now = Date.now()): Promise<void> {
  const prev = new Map((((await area().get('profiles')).profiles as Profile[] | undefined) ?? []).map((p) => [p.id, p]));
  const strip = (p: Profile) => JSON.stringify({ ...p, updatedAt: undefined });
  const stamped = profiles.map((p) => { const old = prev.get(p.id); return !old || strip(old) !== strip(p) ? { ...p, updatedAt: now } : p; });
  await area().set({ profiles: stamped, ...(activeId !== undefined ? { active: activeId } : {}) });
}
export async function setActive(id: string): Promise<void> {
  await area().set({ active: id });
}
export function newProfile(name: string, avatar: string, level: Profile['level'] = 1): Profile {
  const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { id, name: name.trim().slice(0, 24) || 'Learner', avatar, level, createdAt: new Date().toISOString() };
}
export async function removeProfile(id: string): Promise<void> {
  const { profiles, active } = await getProfiles();
  const rest = profiles.filter((p) => p.id !== id);
  await area().remove(`deck:${id}`);
  // Remember the removal so Chrome sync doesn't bring this learner back from another computer.
  const tombstones = ((await area().get('tombstones')).tombstones as Record<string, number> | undefined) ?? {};
  const xp = await getXp();
  for (const row of Object.values(xp)) delete row[id];
  await area().set({ tombstones: { ...tombstones, [id]: Date.now() }, xp });
  await saveProfiles(rest, active?.id === id ? rest[0]?.id ?? null : active?.id ?? null);
}

export async function getDeck(profileId: string): Promise<Deck> {
  const k = `deck:${profileId}`;
  return ((await area().get(k))[k] as Deck | undefined) ?? {};
}
export async function getDecks(ids: string[]): Promise<Record<string, Deck>> {
  const keys = ids.map((id) => `deck:${id}`);
  const r = await area().get(keys);
  return Object.fromEntries(ids.map((id) => [id, (r[`deck:${id}`] as Deck | undefined) ?? {}]));
}

export async function getXp(): Promise<XpLog> {
  return ((await area().get('xp')).xp as XpLog | undefined) ?? {};
}
export async function addXp(profileId: string, amount: number, now = new Date()): Promise<void> {
  if (amount <= 0) return;
  const log = await getXp();
  const k = dayKey(now);
  log[k] = { ...(log[k] ?? {}), [profileId]: (log[k]?.[profileId] ?? 0) + amount };
  await area().set({ xp: log });
}

/** "Got it" / "Again" on a word card. Returns XP earned. */
export async function rate(profileId: string, wordId: string, answer: Answer, now = new Date()): Promise<number> {
  const k = `deck:${profileId}`;
  const deck = await getDeck(profileId);
  deck[wordId] = review(deck[wordId], answer, now);
  await area().set({ [k]: deck });
  const xp = answer === 'good' ? XP.got : XP.again;
  await addXp(profileId, xp, now);
  return xp;
}

export async function getChallenges(): Promise<LocalChallenge[]> {
  return ((await area().get('challenges')).challenges as LocalChallenge[] | undefined) ?? [];
}
export async function saveChallenge(c: LocalChallenge): Promise<void> {
  const list = (await getChallenges()).filter((x) => x.id !== c.id);
  list.unshift(c);
  await area().set({ challenges: list.slice(0, 40) });
}

export async function getHunts(): Promise<HuntRecord[]> {
  return ((await area().get('hunts')).hunts as HuntRecord[] | undefined) ?? [];
}
export async function addHunt(h: HuntRecord): Promise<void> {
  const list = await getHunts();
  list.unshift(h);
  await area().set({ hunts: list.slice(0, 50) });
}

export async function resetAll(): Promise<void> {
  await area().clear();
}
