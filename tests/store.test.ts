import { describe, it, expect, beforeEach } from 'vitest';

// Minimal in-memory chrome.storage.local for the storage layer.
const mem: Record<string, unknown> = {};
const local = {
  get: async (k?: string | string[]) => {
    if (k === undefined) return { ...mem };
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in mem).map((x) => [x, structuredClone(mem[x])]));
  },
  set: async (o: Record<string, unknown>) => { for (const [a, b] of Object.entries(o)) mem[a] = structuredClone(b); },
  remove: async (k: string | string[]) => { for (const x of [k].flat()) delete mem[x]; },
  clear: async () => { for (const x of Object.keys(mem)) delete mem[x]; },
};
(globalThis as unknown as { browser: unknown }).browser = { storage: { local } };

const store = await import('@/src/store');

describe('storage layer', () => {
  beforeEach(() => local.clear());

  it('normalises settings into safe ranges', () => {
    const s = store.normalizeSettings({ density: 99, huntWords: 1, huntTimer: 45 as never, graceDays: -4 });
    expect(s).toMatchObject({ density: 10, huntWords: 3, huntTimer: 0, graceDays: 0 });
  });

  it('profiles: add, pick active, remove with their deck', async () => {
    const a = store.newProfile('Dad', '🐼');
    const b = store.newProfile('  Léo  ', '🦊', 1);
    await store.saveProfiles([a, b], b.id);
    expect((await store.getProfiles()).active?.name).toBe('Léo');
    await store.rate(b.id, 'chien.n', 'good');
    expect(Object.keys(await store.getDeck(b.id))).toEqual(['chien.n']);
    await store.removeProfile(b.id);
    const after = await store.getProfiles();
    expect(after.profiles.map((p) => p.name)).toEqual(['Dad']);
    expect(after.active?.id).toBe(a.id);
    expect(await store.getDeck(b.id)).toEqual({});
  });

  it('rating a word updates only that learner and earns XP for today', async () => {
    const now = new Date(2026, 9, 18, 9);
    await store.rate('kid', 'chat.n', 'good', now);
    await store.rate('kid', 'chien.n', 'again', now);
    const xp = await store.getXp();
    expect(xp['2026-10-18']).toEqual({ kid: 7 });
    expect(await store.getDeck('dad')).toEqual({});
  });

  it('keeps challenge history newest-first and de-duplicated', async () => {
    const c = { id: 'x1', createdAt: '', words: ['chien.n'], seed: 1, fromId: null, fromName: 'A', fromAvatar: '🙂', toId: null, scores: [], total: 1 };
    await store.saveChallenge(c);
    await store.saveChallenge({ ...c, id: 'x2' });
    await store.saveChallenge({ ...c, total: 2 });
    const list = await store.getChallenges();
    expect(list.map((x) => x.id)).toEqual(['x1', 'x2']);
    expect(list[0].total).toBe(2);
  });
});
