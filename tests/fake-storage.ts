import { itemBytes, MAX_ITEMS, QUOTA_BYTES, QUOTA_BYTES_PER_ITEM } from '@/src/sync/codec';

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;
export interface FakeArea {
  mem: Record<string, unknown>;
  writes: number;
  get(k?: string | string[] | null): Promise<Record<string, unknown>>;
  set(o: Record<string, unknown>): Promise<void>;
  remove(k: string | string[]): Promise<void>;
  clear(): Promise<void>;
}
/** In-memory chrome.storage area; `quota` makes it behave like storage.sync. */
export function fakeArea(name: string, listeners: Listener[], quota = false): FakeArea {
  const mem: Record<string, unknown> = {};
  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => { if (Object.keys(changes).length) listeners.forEach((l) => l(changes, name)); };
  const a: FakeArea = {
    mem, writes: 0,
    get: async (k) => {
      if (k === undefined || k === null) return structuredClone(mem);
      const ks = Array.isArray(k) ? k : [k];
      return Object.fromEntries(ks.filter((x) => x in mem).map((x) => [x, structuredClone(mem[x])]));
    },
    set: async (o) => {
      if (quota) {
        const next = { ...mem, ...o };
        for (const [k, v] of Object.entries(o)) if (itemBytes(k, v) > QUOTA_BYTES_PER_ITEM) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        if (Object.keys(next).length > MAX_ITEMS) throw new Error('MAX_ITEMS quota exceeded');
        if (Object.entries(next).reduce((n, [k, v]) => n + itemBytes(k, v), 0) > QUOTA_BYTES) throw new Error('QUOTA_BYTES quota exceeded');
      }
      a.writes++;
      const ch: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: mem[k], newValue: v }; mem[k] = structuredClone(v); }
      emit(ch);
    },
    remove: async (k) => {
      a.writes++;
      const ch: Record<string, { oldValue?: unknown }> = {};
      for (const x of [k].flat()) if (x in mem) { ch[x] = { oldValue: mem[x] }; delete mem[x]; }
      emit(ch);
    },
    clear: async () => { for (const x of Object.keys(mem)) delete mem[x]; },
  };
  return a;
}

/** A "computer": its own local area, sharing one sync area with the family's other computers. */
export function device(sync: FakeArea) {
  const listeners: Listener[] = [];
  const local = fakeArea('local', listeners);
  return {
    local, sync,
    use() {
      (globalThis as unknown as { browser: unknown }).browser = {
        storage: { local, sync, onChanged: { addListener: (l: Listener) => listeners.push(l) } },
        runtime: { getManifest: () => ({ version: '0.1.2' }) },
      };
    },
  };
}
