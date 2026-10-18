import { describe, it, expect, beforeEach, vi } from 'vitest';
import { device, fakeArea } from './fake-storage';
import { encodeCard, decodeCard, encodeDeck, decodeDeckShard, encodeXp, decodeXpShard, decodeState, planWrite, itemBytes, QUOTA_BYTES, QUOTA_BYTES_PER_ITEM, MAX_ITEMS } from '@/src/sync/codec';
import { mergeState, mergeDeck, mergeXp, emptyState, type SyncState } from '@/src/sync/model';
import { review, type Deck } from '@/src/srs';
import { WORDS } from '@/src/words';
import { familyStreak } from '@/src/family';
import type { Profile } from '@/src/types';

const at = (d: string) => new Date(`${d}T10:00:00Z`);
function deckOf(n: number, start = at('2026-10-01'), answers = 1): Deck {
  const d: Deck = {};
  WORDS.slice(0, n).forEach((w, i) => {
    let c = review(undefined, i % 3 ? 'good' : 'again', new Date(start.getTime() + i * 60_000));
    for (let k = 1; k < answers; k++) c = review(c, 'good', new Date(start.getTime() + k * 86_400_000 + i * 60_000));
    d[w.id] = c;
  });
  return d;
}
const prof = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({ id, name, avatar: '🦊', level: 1, createdAt: '2026-10-01T00:00:00.000Z', ...extra });

describe('compact encoding', () => {
  it('cards round-trip (minute and 4-decimal precision)', () => {
    const c = review(review(undefined, 'good', at('2026-10-10')), 'good', at('2026-10-12'));
    const back = decodeCard(encodeCard(c))!;
    expect(back.reps).toBe(c.reps);
    expect(back.state).toBe(c.state);
    expect(Math.abs(Date.parse(back.due) - Date.parse(c.due))).toBeLessThan(60_000);
    expect(back.stability).toBeCloseTo(c.stability, 3);
    expect(encodeCard(back)).toBe(encodeCard(c)); // stable after one round trip
    expect(decodeCard('garbage')).toBeNull();
  });

  it('a full 1,500-word deck shards into items under 8,192 bytes and decodes intact', () => {
    const deck = deckOf(1500);
    const items = encodeDeck('p1', deck);
    const keys = Object.keys(items);
    expect(keys.length).toBeGreaterThan(1);
    for (const [k, v] of Object.entries(items)) expect(itemBytes(k, v)).toBeLessThanOrEqual(QUOTA_BYTES_PER_ITEM);
    const back: Deck = Object.assign({}, ...Object.values(items).map(decodeDeckShard));
    expect(Object.keys(back).sort()).toEqual(Object.keys(deck).sort());
    const bytesPerCard = Object.entries(items).reduce((n, [k, v]) => n + itemBytes(k, v), 0) / 1500;
    expect(bytesPerCard).toBeLessThan(55);
  });

  it('XP round-trips per learner', () => {
    const xp = { '2026-10-17': { a: 12, b: 3 }, '2026-10-18': { a: 30 } };
    const into = {};
    for (const v of Object.values(encodeXp('a', xp))) decodeXpShard('a', v, into);
    expect(into).toEqual({ '2026-10-17': { a: 12 }, '2026-10-18': { a: 30 } });
  });

  it('a typical family (2 learners, 400 words each, a year of XP) fits with lots of room', () => {
    const xp: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 365; i++) xp[new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)] = { a: 40, b: 25 };
    const s: SyncState = { ...emptyState(), profiles: [prof('a', 'Dad'), prof('b', 'Léo')], decks: { a: deckOf(400), b: deckOf(400) }, xp };
    const plan = planWrite(s, {});
    expect(plan.full).toBe(false);
    expect(plan.bytes).toBeLessThan(QUOTA_BYTES / 2);
    expect(plan.items).toBeLessThan(MAX_ITEMS);
  });

  it('when decks are too big, learners/XP/settings still sync and the plan reports full', () => {
    const s: SyncState = { ...emptyState(), profiles: ['a', 'b', 'c'].map((x) => prof(x, x)), decks: { a: deckOf(1500), b: deckOf(1500), c: deckOf(1500) } };
    const plan = planWrite(s, {});
    expect(plan.full).toBe(true);
    expect(plan.bytes).toBeLessThanOrEqual(QUOTA_BYTES);
    expect(Object.keys(plan.set).some((k) => k.startsWith('pm.p.'))).toBe(true);
    expect(Object.keys(plan.set).some((k) => k.startsWith('pm.d.'))).toBe(false);
  });

  it('writing the same state again changes nothing (no wasted write quota)', () => {
    const s: SyncState = { ...emptyState(), profiles: [prof('a', 'Dad')], decks: { a: deckOf(50) }, xp: { '2026-10-18': { a: 9 } } };
    const first = planWrite(s, {});
    const again = planWrite(mergeState(s, decodeState(first.set)), first.set);
    expect(again.set).toEqual({});
    expect(again.remove).toEqual([]);
  });

  it('ignores other extensions’ keys and garbage', () => {
    const s = decodeState({ other: 1, 'pm.p.a': { n: 'Dad', a: '🐼', l: 2, c: '2026-01-01T00:00:00Z' }, 'pm.p.bad id': { n: 'x', a: 'y' }, 'pm.d.a.0': 'chien.n=nope~chat.n=' + encodeCard(review(undefined, 'good', at('2026-10-01'))), 'pm.s': { density: 5 } });
    expect(s.profiles.map((p) => p.name)).toEqual(['Dad']);
    expect(Object.keys(s.decks.a)).toEqual(['chat.n']);
    expect(s.settings).toBeNull();
  });
});

describe('merge across computers', () => {
  it('per word, the most recent review wins', () => {
    const old = review(undefined, 'good', at('2026-10-01'));
    const newer = review(old, 'again', at('2026-10-05'));
    expect(mergeDeck({ 'chat.n': newer }, { 'chat.n': old })['chat.n']).toBe(newer);
    expect(mergeDeck({ 'chat.n': old }, { 'chat.n': newer })['chat.n']).toBe(newer);
    expect(Object.keys(mergeDeck({ 'a.n': old }, { 'b.n': old }))).toEqual(['a.n', 'b.n']);
  });

  it('XP: union of days, max per learner per day, so the family streak never shrinks', () => {
    const a = { '2026-10-16': { dad: 10 }, '2026-10-17': { dad: 5 } };
    const b = { '2026-10-17': { dad: 8, kid: 4 }, '2026-10-18': { kid: 12 } };
    const m = mergeXp(a, b);
    expect(m).toEqual({ '2026-10-16': { dad: 10 }, '2026-10-17': { dad: 8, kid: 4 }, '2026-10-18': { kid: 12 } });
    const today = new Date(2026, 9, 18, 12);
    expect(familyStreak(m, today, 0).days).toBeGreaterThanOrEqual(Math.max(familyStreak(a, today, 0).days, familyStreak(b, today, 0).days));
    expect(familyStreak(m, today, 0).days).toBe(3);
  });

  it('learner edits: newest wins; removed learners stay removed', () => {
    const a = { ...emptyState(), profiles: [prof('p1', 'Leo', { updatedAt: 100 }), prof('p2', 'Dad')], tombstones: {} };
    const b = { ...emptyState(), profiles: [prof('p1', 'Léo', { updatedAt: 200 }), prof('p2', 'Dad')], tombstones: { p2: 300 }, decks: { p2: deckOf(3) } };
    const m = mergeState(a, b);
    expect(m.profiles.map((p) => p.name)).toEqual(['Léo']);
    expect(m.decks.p2).toBeUndefined();
    expect(mergeState(b, a).profiles.map((p) => p.name)).toEqual(['Léo']);
  });

  it('content is the same whichever side merges', () => {
    const a: SyncState = { ...emptyState(), profiles: [prof('a', 'A')], decks: { a: deckOf(20, at('2026-10-01')) }, xp: { '2026-10-01': { a: 3 } } };
    const b: SyncState = { ...emptyState(), profiles: [prof('a', 'A'), prof('b', 'B')], decks: { a: deckOf(30, at('2026-10-03')), b: deckOf(5) }, xp: { '2026-10-02': { b: 9 } } };
    const ab = mergeState(a, b), ba = mergeState(b, a);
    expect(ab.decks).toEqual(ba.decks);
    expect(ab.xp).toEqual(ba.xp);
    expect(new Set(ab.profiles.map((p) => p.id))).toEqual(new Set(ba.profiles.map((p) => p.id)));
  });
});

describe('sync engine (two computers, one Chrome account)', () => {
  let sync: ReturnType<typeof fakeArea>;
  let home: ReturnType<typeof device>, laptop: ReturnType<typeof device>;
  beforeEach(() => {
    vi.resetModules();
    sync = fakeArea('sync', [], true);
    home = device(sync);
    laptop = device(sync);
  });
  const load = async () => ({ engine: await import('@/src/sync/engine'), store: await import('@/src/store') });

  it('upgrade from v0.1: existing local data is pushed to sync without loss', async () => {
    home.use();
    const { engine, store } = await load();
    // v0.1 data: no updatedAt, no tombstones, no syncEnabled
    home.local.mem.profiles = [{ id: 'dad', name: 'Dad', avatar: '🐼', level: 1, createdAt: '2026-10-01T00:00:00.000Z' }];
    home.local.mem.settings = { density: 7, huntWords: 5, huntTimer: 0, graceDays: 2, voiceURI: null, autoSites: [], showEmoji: true };
    await store.rate('dad', 'chien.n', 'good', at('2026-10-17'));
    await store.rate('dad', 'chat.n', 'again', at('2026-10-18'));
    const before = structuredClone(home.local.mem);
    const st = await engine.syncNow();
    expect(st.state).toBe('ok');
    expect(Object.keys(sync.mem)).toEqual(expect.arrayContaining(['pm.v', 'pm.p.dad', 'pm.d.dad.0', 'pm.x.dad.0', 'pm.s']));
    for (const k of ['profiles', 'xp', 'deck:dad']) expect(home.local.mem[k]).toEqual(before[k]);
    expect((await store.getSettings()).density).toBe(7);
  });

  it('two computers converge, and a second sync writes nothing', async () => {
    home.use();
    let { engine, store } = await load();
    await store.saveProfiles([prof('dad', 'Dad'), prof('kid', 'Léo')], 'dad');
    await store.rate('dad', 'chien.n', 'good', at('2026-10-17'));
    await engine.syncNow();

    laptop.use(); vi.resetModules(); ({ engine, store } = await load());
    await engine.syncNow(); // first run on the laptop pulls the family
    expect((await store.getProfiles()).profiles.map((p) => p.name)).toEqual(['Dad', 'Léo']);
    await store.rate('kid', 'chat.n', 'good', at('2026-10-18'));
    await store.rate('dad', 'chien.n', 'again', at('2026-10-18')); // newer than home's review
    await engine.syncNow();

    home.use(); vi.resetModules(); ({ engine, store } = await load());
    await engine.syncNow();
    expect(Object.keys(await store.getDeck('kid'))).toEqual(['chat.n']);
    expect((await store.getDeck('dad'))['chien.n'].last_review).toBe(new Date(Math.floor(at('2026-10-18').getTime() / 60000) * 60000).toISOString());
    const xp = await store.getXp();
    expect(xp['2026-10-18'].kid).toBeGreaterThan(0);
    expect(xp['2026-10-17'].dad).toBeGreaterThan(0);
    const writes = sync.writes;
    await engine.syncNow();
    expect(sync.writes).toBe(writes);
  });

  it('a learner removed on one computer does not come back from another', async () => {
    home.use();
    let { engine, store } = await load();
    await store.saveProfiles([prof('dad', 'Dad'), prof('kid', 'Léo')], 'dad');
    await engine.syncNow();
    laptop.use(); vi.resetModules(); ({ engine, store } = await load());
    await engine.syncNow();
    await store.removeProfile('kid');
    await engine.syncNow();
    home.use(); vi.resetModules(); ({ engine, store } = await load());
    await engine.syncNow();
    expect((await store.getProfiles()).profiles.map((p) => p.name)).toEqual(['Dad']);
    expect(Object.keys(sync.mem).some((k) => k.includes('.kid'))).toBe(false);
  });

  it('over quota: stays on this computer and reports “full”', async () => {
    home.use();
    const { engine, store } = await load();
    await store.saveProfiles(['a', 'b', 'c'].map((x) => prof(x, x)), 'a');
    for (const x of ['a', 'b', 'c']) home.local.mem[`deck:${x}`] = deckOf(1500);
    const st = await engine.syncNow();
    expect(st.state).toBe('full');
    expect(Object.keys(sync.mem).some((k) => k.startsWith('pm.p.'))).toBe(true);
    expect(Object.keys(home.local.mem['deck:a'] as object)).toHaveLength(1500); // nothing lost locally
    expect(engine.describeStatus(st, true)).toMatch(/sync is full/i);
  });

  it('quota errors from Chrome are caught and reported', async () => {
    home.use();
    const { engine, store } = await load();
    await store.saveProfiles([prof('a', 'A')], 'a');
    sync.set = async () => { throw new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.'); };
    expect((await engine.syncNow()).state).toBe('busy');
  });

  it('sync off: nothing is written to sync', async () => {
    home.use();
    const { engine, store } = await load();
    await store.saveSettings({ syncEnabled: false });
    await store.saveProfiles([prof('a', 'A')], 'a');
    expect((await engine.syncNow()).state).toBe('off');
    expect(sync.writes).toBe(0);
  });

  it('shared settings follow the newest edit; voice and always-on sites stay per computer', async () => {
    home.use();
    let { engine, store } = await load();
    await store.saveSettings({ density: 8, voiceURI: 'Microsoft Paul', autoSites: ['https://a.example'] }, 1000);
    await engine.syncNow();
    laptop.use(); vi.resetModules(); ({ engine, store } = await load());
    await engine.syncNow();
    const s = await store.getSettings();
    expect(s.density).toBe(8);
    expect(s.voiceURI).toBeNull();
    expect(s.autoSites).toEqual([]);
  });

  it('many quick answers become one debounced sync', async () => {
    vi.useFakeTimers();
    home.use();
    const { engine } = await load();
    const spy = vi.spyOn(sync, 'get');
    for (let i = 0; i < 20; i++) engine.scheduleSync(3000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
