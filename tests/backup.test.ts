import { describe, it, expect, beforeEach, vi } from 'vitest';
import { device, fakeArea } from './fake-storage';
import { makeBackup, parseBackup, BACKUP_FORMAT } from '@/src/backup';
import { review } from '@/src/srs';
import type { Profile } from '@/src/types';

const prof = (id: string, name: string): Profile => ({ id, name, avatar: '🦊', level: 1, createdAt: '2026-10-01T00:00:00.000Z' });
const data = () => ({
  profiles: [prof('dad', 'Dad'), prof('kid', 'Léo')],
  decks: { kid: { 'chien.n': review(undefined, 'good', new Date('2026-10-18T10:00:00Z')) } },
  xp: { '2026-10-18': { kid: 12, dad: 4 } },
  settings: { density: 6, huntWords: 5, huntTimer: 0 as const, graceDays: 2, showEmoji: true, updatedAt: 5 },
  tombstones: {},
  challenges: [],
  hunts: [],
});

describe('backup files', () => {
  it('round-trips with a checksum and a preview', async () => {
    const { text, filename } = await makeBackup(data(), '0.1.2', new Date('2026-10-18T19:00:00Z'));
    expect(filename).toBe('petit-mot-backup-2026-10-18.json');
    const r = await parseBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data).toEqual(data());
    expect(r.preview.learners).toEqual([
      { id: 'dad', name: 'Dad', avatar: '🦊', cards: 0, xp: 4 },
      { id: 'kid', name: 'Léo', avatar: '🦊', cards: 1, xp: 12 },
    ]);
  });

  it('rejects an edited file (checksum)', async () => {
    const { text } = await makeBackup(data(), '0.1.2');
    const tampered = JSON.parse(text);
    tampered.data.xp['2026-10-18'].kid = 99999;
    const r = await parseBackup(JSON.stringify(tampered));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/checksum/) });
  });

  it('rejects other files, newer versions and damaged data with friendly errors', async () => {
    expect(await parseBackup('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/valid JSON/) });
    expect(await parseBackup('{"format":"something-else"}')).toMatchObject({ ok: false });
    const { text } = await makeBackup(data(), '0.1.2');
    const newer = { ...JSON.parse(text), version: 99 };
    expect(await parseBackup(JSON.stringify(newer))).toMatchObject({ ok: false, error: expect.stringMatching(/newer/) });
    const bad = JSON.parse(text);
    bad.data.decks.kid['chien.n'].due = 'yesterday';
    expect(await parseBackup(JSON.stringify(bad))).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
    const badProfile = JSON.parse(text);
    badProfile.data.profiles[0].id = '../evil';
    expect(await parseBackup(JSON.stringify(badProfile))).toMatchObject({ ok: false });
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
  });
});

describe('restoring', () => {
  let home: ReturnType<typeof device>;
  beforeEach(() => { vi.resetModules(); home = device(fakeArea('sync', [], true)); home.use(); });

  it('merge keeps this computer’s learners and adds the backup’s progress', async () => {
    const store = await import('@/src/store');
    const { applyBackup } = await import('@/src/backup');
    await store.saveProfiles([prof('mom', 'Mom')], 'mom');
    await store.rate('mom', 'chat.n', 'good', new Date('2026-10-18T09:00:00Z'));
    await applyBackup(data(), 'merge');
    const { profiles } = await store.getProfiles();
    expect(profiles.map((p) => p.name).sort()).toEqual(['Dad', 'Léo', 'Mom']);
    expect(Object.keys(await store.getDeck('kid'))).toEqual(['chien.n']);
    expect(Object.keys(await store.getDeck('mom'))).toEqual(['chat.n']);
    expect((await store.getXp())['2026-10-18']).toMatchObject({ kid: 12, dad: 4 });
  });

  it('replace makes this computer match the backup and tombstones the rest', async () => {
    const store = await import('@/src/store');
    const { applyBackup } = await import('@/src/backup');
    await store.saveProfiles([prof('mom', 'Mom')], 'mom');
    await store.rate('mom', 'chat.n', 'good');
    await applyBackup(data(), 'replace');
    const { profiles, active } = await store.getProfiles();
    expect(profiles.map((p) => p.name)).toEqual(['Dad', 'Léo']);
    expect(active?.id).toBe('dad');
    expect(await store.getDeck('mom')).toEqual({});
    expect((home.local.mem.tombstones as Record<string, number>).mom).toBeGreaterThan(0);
    expect((await store.getSettings()).density).toBe(6);
  });
});
