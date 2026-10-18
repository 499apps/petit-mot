import type { Profile } from './types';
import type { StoredCard } from './srs';
import { canonical, emptyState, mergeState, SHARED_KEYS, type SharedSettings, type SyncState } from './sync/model';
import { readLocal, writeLocal } from './sync/engine';
import { getChallenges, getHunts, getProfiles, type HuntRecord, type LocalChallenge } from './store';

/**
 * Backup files: a JSON file the family saves themselves (no network involved).
 *   { format: "petit-mot-backup", version: 1, app, createdAt, data: {...}, checksum: "sha256:<hex>" }
 * The checksum covers the canonical JSON of `data`, so damaged or edited files are rejected.
 */
export const BACKUP_FORMAT = 'petit-mot-backup';
export const BACKUP_VERSION = 1;
const MAX_BYTES = 5 * 1024 * 1024;

export interface BackupData extends SyncState { challenges: LocalChallenge[]; hunts: HuntRecord[] }
export interface Backup { format: typeof BACKUP_FORMAT; version: number; app: string; createdAt: string; data: BackupData; checksum: string }
export interface BackupPreview {
  createdAt: string;
  app: string;
  learners: { id: string; name: string; avatar: string; cards: number; xp: number }[];
  xpDays: number;
  challenges: number;
}

export async function sha256(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeBackup(data: BackupData, app: string, now = new Date()): Promise<{ text: string; filename: string; backup: Backup }> {
  const backup: Backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, app, createdAt: now.toISOString(), data, checksum: `sha256:${await sha256(canonical(data))}` };
  const d = now.toISOString().slice(0, 10);
  return { text: JSON.stringify(backup, null, 1), filename: `petit-mot-backup-${d}.json`, backup };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCard = (c: unknown): c is StoredCard => isObj(c) && typeof c.due === 'string' && !Number.isNaN(Date.parse(c.due))
  && ['stability', 'difficulty', 'reps', 'lapses', 'state'].every((k) => Number.isFinite(c[k] as number));
const isProfile = (p: unknown): p is Profile => isObj(p) && typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.id)
  && typeof p.name === 'string' && typeof p.avatar === 'string' && typeof p.createdAt === 'string';

function validate(d: unknown): string | null {
  if (!isObj(d)) return 'The file has no data.';
  if (!Array.isArray(d.profiles) || !d.profiles.every(isProfile)) return 'The learner list is damaged.';
  if (!isObj(d.decks) || !Object.values(d.decks).every((deck) => isObj(deck) && Object.values(deck).every(isCard))) return 'Word progress is damaged.';
  if (!isObj(d.xp) || !Object.values(d.xp).every((row) => isObj(row) && Object.values(row).every((n) => Number.isFinite(n as number) && (n as number) >= 0))) return 'XP history is damaged.';
  if (d.settings !== null && !(isObj(d.settings) && SHARED_KEYS.every((k) => k in (d.settings as object)))) return 'Settings are damaged.';
  if (!isObj(d.tombstones) || !Array.isArray(d.challenges) || !Array.isArray(d.hunts)) return 'The file is incomplete.';
  return null;
}

export type ParseResult = { ok: true; backup: Backup; preview: BackupPreview } | { ok: false; error: string };
export async function parseBackup(text: string): Promise<ParseResult> {
  if (text.length > MAX_BYTES) return { ok: false, error: 'That file is too big to be a Petit Mot backup.' };
  let b: Partial<Backup>;
  try { b = JSON.parse(text); } catch { return { ok: false, error: 'That isn’t a Petit Mot backup file (it isn’t valid JSON).' }; }
  if (!isObj(b) || b.format !== BACKUP_FORMAT) return { ok: false, error: 'That isn’t a Petit Mot backup file.' };
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) return { ok: false, error: 'This backup was made by a newer Petit Mot. Update the extension, then try again.' };
  const bad = validate(b.data);
  if (bad) return { ok: false, error: bad };
  const sum = `sha256:${await sha256(canonical(b.data))}`;
  if (b.checksum !== sum) return { ok: false, error: 'This backup was changed or damaged (checksum mismatch), so it wasn’t restored.' };
  const data = b.data as BackupData;
  const preview: BackupPreview = {
    createdAt: String(b.createdAt ?? ''), app: String(b.app ?? ''),
    learners: data.profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, cards: Object.keys(data.decks[p.id] ?? {}).length,
      xp: Object.values(data.xp).reduce((n, row) => n + (row[p.id] ?? 0), 0) })),
    xpDays: Object.keys(data.xp).length,
    challenges: data.challenges.length,
  };
  return { ok: true, backup: b as Backup, preview };
}

// ---------- reading and applying (extension storage) ----------

export async function collectBackupData(): Promise<BackupData> {
  const [state, challenges, hunts] = await Promise.all([readLocal(), getChallenges(), getHunts()]);
  return { ...state, challenges, hunts };
}

const byId = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...b, ...a].map((x) => [x.id, x])).values()];
/** Merge (keep everything, newest review per word wins) or replace this computer's data. */
export async function applyBackup(data: BackupData, mode: 'merge' | 'replace', now = Date.now()): Promise<void> {
  const before = await readLocal();
  const incoming: SyncState = { profiles: data.profiles, decks: data.decks, xp: data.xp, settings: data.settings as SharedSettings | null, tombstones: data.tombstones };
  let next: SyncState;
  if (mode === 'merge') {
    next = mergeState(before, incoming);
  } else {
    const keep = new Set(data.profiles.map((p) => p.id));
    const tombstones = { ...before.tombstones, ...data.tombstones };
    for (const p of before.profiles) if (!keep.has(p.id)) tombstones[p.id] = now; // so sync doesn't bring them back
    for (const id of keep) delete tombstones[id];
    next = { ...emptyState(), ...incoming, profiles: data.profiles.map((p) => ({ ...p, updatedAt: now })), settings: incoming.settings ? { ...incoming.settings, updatedAt: now } : before.settings, tombstones };
  }
  await writeLocal(next, before);
  const [challenges, hunts] = await Promise.all([getChallenges(), getHunts()]);
  const huntKey = (h: HuntRecord) => h.at;
  const mergedHunts = mode === 'replace' ? data.hunts : [...new Map([...data.hunts, ...hunts].map((h) => [huntKey(h), h])).values()].sort((a, b) => b.at.localeCompare(a.at));
  await browser.storage.local.set({
    challenges: (mode === 'replace' ? data.challenges : byId(challenges, data.challenges)).slice(0, 40),
    hunts: mergedHunts.slice(0, 50),
  });
  const { profiles, active } = await getProfiles();
  if (!active || !profiles.some((p) => p.id === active.id)) await browser.storage.local.set({ active: profiles[0]?.id ?? null });
}
