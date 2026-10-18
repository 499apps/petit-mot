import { DEFAULT_SETTINGS, type Profile, type Settings, type XpLog } from './types';
import { review, type Answer, type Deck } from './srs';
import { dayKey } from './dates';
import { XP } from './family';

/**
 * Everything lives in chrome.storage.local on this computer. No accounts, no sync, no server.
 * Keys: profiles, active, settings, xp, deck:<profileId>, challenges, hunts
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
  return v;
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings((await area().get('settings')).settings as Partial<Settings>);
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = normalizeSettings({ ...(await getSettings()), ...patch });
  await area().set({ settings: s });
  return s;
}

export async function getProfiles(): Promise<{ profiles: Profile[]; active: Profile | null }> {
  const r = await area().get(['profiles', 'active']);
  const profiles = (r.profiles as Profile[] | undefined) ?? [];
  const active = profiles.find((p) => p.id === r.active) ?? profiles[0] ?? null;
  return { profiles, active };
}
export async function saveProfiles(profiles: Profile[], activeId?: string | null): Promise<void> {
  await area().set({ profiles, ...(activeId !== undefined ? { active: activeId } : {}) });
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
