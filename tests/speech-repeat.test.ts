/**
 * Regression: with a Google online voice, the first 🔊 played and later ones were silent.
 *
 * FakeChrome models Chrome's TTS controller plus a Google-like network engine:
 *  - the engine sends 'start' but never 'end', so Chrome keeps the utterance as "speaking";
 *  - stopping is asynchronous: for a moment after a stop, a new utterance is dropped with no
 *    event at all. Chrome's enqueue:false stops and speaks back-to-back, so it hits that window.
 * The old code then waited, asked isSpeaking() (true: the stale utterance), and reported success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as Speech from '@/src/speech';

type Ev = { type: string };
interface Utt { text: string; onEvent?: (e: Ev) => void; dropped?: boolean }
class FakeChrome {
  started: string[] = [];
  dropped: string[] = [];
  current: Utt | null = null;
  queue: Utt[] = [];
  busy = false;
  tearUntil = 0;
  constructor(public teardownMs = 120, public startDelay = 5, public neverStart = false, public voices = [{ voiceName: 'Google français', lang: 'fr-FR', remote: true }]) {}
  private engineStop() { this.busy = false; this.tearUntil = Date.now() + this.teardownMs; }
  private engineSpeak(u: Utt) {
    this.current = u;
    if (this.neverStart || this.busy || Date.now() < this.tearUntil) { u.dropped = true; this.dropped.push(u.text); return; }
    this.busy = true;
    setTimeout(() => { if (this.current === u) { this.started.push(u.text); u.onEvent?.({ type: 'start' }); } }, this.startDelay);
    // never 'end'
  }
  tts = {
    speak: (text: string, o: { enqueue?: boolean; onEvent?: (e: Ev) => void }, cb?: () => void) => {
      const u: Utt = { text, onEvent: o.onEvent };
      if (!o.enqueue && this.current) this.tts.stop(); // Chrome only stops when something is current
      if (this.current) this.queue.push(u); // waits for an 'end' that never comes
      else this.engineSpeak(u);
      cb?.();
    },
    stop: () => {
      if (!this.current && !this.queue.length) return; // nothing to stop: the engine isn't told
      const old = [this.current, ...this.queue].filter((x): x is Utt => !!x);
      this.current = null; this.queue = [];
      this.engineStop();
      old.forEach((u) => u.onEvent?.({ type: 'interrupted' }));
    },
    isSpeaking: (cb: (b: boolean) => void) => cb(!!this.current),
    getVoices: (cb: (v: unknown[]) => void) => cb(this.voices),
  };
}

/** Google-like Web Speech: never fires 'end', and speak() right after cancel() is dropped. */
class FakeWebSpeech {
  started: string[] = [];
  speaking = false; pending = false; paused = false;
  private cancelledAt = -1e9;
  private cur: { text: string; onstart?: () => void; onerror?: (e: { error: string }) => void } | null = null;
  getVoices = () => [{ name: 'Google français', lang: 'fr-FR', localService: false, voiceURI: 'Google français' }];
  addEventListener() {}
  resume() { this.paused = false; }
  cancel() { const c = this.cur; this.cur = null; this.speaking = false; this.cancelledAt = Date.now(); c?.onerror?.({ error: 'interrupted' }); }
  speak(u: { text: string; onstart?: () => void }) {
    if (this.speaking || Date.now() - this.cancelledAt < 100) return; // stuck or too soon: silently dropped
    this.cur = u; this.speaking = true;
    setTimeout(() => { if (this.cur === u) { this.started.push(u.text); u.onstart?.(); } }, 5);
  }
}
class Utterance { voice: unknown = null; lang = ''; rate = 1; onstart?: () => void; onend?: () => void; onerror?: () => void; onboundary?: () => void; constructor(public text: string) {} }

/** Fresh copy of the module, like a separate page or worker. */
async function load(): Promise<typeof Speech> { vi.resetModules(); return import('@/src/speech'); }
const WORDS = ['le chien', 'le chat', 'la maison', 'le livre', "l'arbre"];
const g = globalThis as Record<string, unknown>;

let chrome: FakeChrome;
beforeEach(() => { chrome = new FakeChrome(); g.chrome = { tts: chrome.tts, runtime: {} }; });
afterEach(() => { delete g.chrome; delete g.speechSynthesis; delete g.SpeechSynthesisUtterance; vi.useRealTimers(); });

describe('the fake reproduces the bug', () => {
  it('back-to-back enqueue:false speaks: only the first word starts, yet Chrome says it is speaking', async () => {
    for (const w of WORDS) { chrome.tts.speak(w, { enqueue: false }); await new Promise((r) => setTimeout(r, 20)); }
    expect(chrome.started).toEqual(['le chien']);
    let speaking = false; chrome.tts.isSpeaking((b) => (speaking = b));
    expect(speaking).toBe(true); // this is what used to be mistaken for success
  });
});

describe('Google-like engine that never sends end', () => {
  it('5 consecutive speaks all start (side panel and background path)', async () => {
    const s = await load();
    const results = [];
    for (const w of WORDS) results.push(await s.speakWith([s.ttsEngine()!], w, 'Google français'));
    expect(chrome.started).toEqual(WORDS);
    expect(results.every((r) => r.ok && !r.superseded && r.voice?.name === 'Google français')).toBe(true);
    expect(results.every((r) => r.tried.length === 1)).toBe(true); // first try each time, no retries needed
  });
  it('resolves on start without waiting for end', async () => {
    const s = await load();
    const t = Date.now();
    await s.speakWith([s.ttsEngine()!], 'le chien', 'Google français');
    expect(Date.now() - t).toBeLessThan(1000);
  });
  it('a word that does not start is a failure, not silent "success"', async () => {
    vi.useFakeTimers();
    chrome.neverStart = true;
    const s = await load();
    const p = s.speakWith([s.ttsEngine()!], 'le chien', 'Google français');
    await vi.advanceTimersByTimeAsync(20000);
    const r = await p;
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(r.tried).toEqual(['tts:Google français:timeout', 'tts:Google français:timeout']);
    expect(s.friendlyError(r, true)).toMatch(/didn’t play/);
  });
  it('a slow-to-recover engine gets a clean retry and plays', async () => {
    vi.useFakeTimers();
    chrome.teardownMs = 300; // longer than the first settle, shorter than the retry settle
    const s = await load();
    const tts = s.ttsEngine()!;
    const first = s.speakWith([tts], 'le chien', 'Google français');
    await vi.advanceTimersByTimeAsync(500); await first;
    const p = s.speakWith([tts], 'le chat', 'Google français');
    await vi.advanceTimersByTimeAsync(10000);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.tried).toEqual(['tts:Google français:timeout', 'tts:Google français:ok']);
    expect(chrome.started).toEqual(['le chien', 'le chat']);
  });
  it('a stuck Google voice falls back to a local French voice', async () => {
    vi.useFakeTimers();
    chrome.neverStart = true;
    chrome.voices.push({ voiceName: 'Microsoft Paul', lang: 'fr-FR', remote: false });
    const s = await load();
    const tts = s.ttsEngine()!;
    // Paul is a different engine in real Chrome; model it by letting the 3rd attempt start.
    let n = 0; const real = chrome.tts.speak;
    chrome.tts.speak = (t, o, cb) => { if (++n === 3) chrome.neverStart = false; real(t, o, cb); };
    const p = s.speakWith([tts], 'le chien', 'Google français');
    await vi.advanceTimersByTimeAsync(20000);
    const r = await p;
    expect(r).toMatchObject({ ok: true, voice: { name: 'Microsoft Paul' } });
  });
  it('Web Speech fallback: 5 consecutive speaks all start', async () => {
    const ws = new FakeWebSpeech();
    g.speechSynthesis = ws; g.SpeechSynthesisUtterance = Utterance;
    const s = await load();
    for (const w of WORDS) expect((await s.speakWith([s.webEngine()!], w, 'Google français')).ok).toBe(true);
    expect(ws.started).toEqual(WORDS);
  });
});

describe('rapid clicks', () => {
  it('side panel: 5 quick 🔊 clicks; the last word plays, older ones bow out without errors or fallbacks', async () => {
    const ws = new FakeWebSpeech();
    g.speechSynthesis = ws; g.SpeechSynthesisUtterance = Utterance;
    const s = await load();
    const rs = await Promise.all(WORDS.map((w) => s.speak(w, 'Google français')));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs.slice(0, 4).every((r) => r.superseded)).toBe(true);
    expect(rs[4]).toMatchObject({ ok: true, engine: 'tts' });
    expect(rs[4].superseded).toBeFalsy();
    expect(chrome.started.at(-1)).toBe("l'arbre");
    expect(ws.started).toEqual([]); // no Web Speech fallback fighting the newer word
    // …and the next calm click still works.
    expect((await s.speak('le chat', 'Google français')).ok).toBe(true);
    expect(chrome.started.at(-1)).toBe('le chat');
  });

  /** Page (in-page card, Word Hunt) → background worker, each with its own module copy. */
  async function pageAndBackground() {
    const bg = await load();
    const ask = (t: string) => bg.speakWith([bg.ttsEngine()!], t, 'Google français');
    const ws = new FakeWebSpeech();
    g.speechSynthesis = ws; g.SpeechSynthesisUtterance = Utterance;
    const page = await load();
    return { ws, say: (t: string) => page.speakViaBackground(ask, page.webEngine(), t, 'Google français') };
  }
  it('in-page card: 5 consecutive 🔊 clicks all start', async () => {
    const { say, ws } = await pageAndBackground();
    for (const w of WORDS) expect(await say(w)).toMatchObject({ ok: true, engine: 'tts' });
    expect(chrome.started).toEqual(WORDS);
    expect(ws.started).toEqual([]);
  });
  it('in-page card: rapid clicks end on the newest word with no page fallback', async () => {
    const { say, ws } = await pageAndBackground();
    const rs = await Promise.all(WORDS.map((w) => say(w)));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(chrome.started.at(-1)).toBe("l'arbre");
    expect(ws.started).toEqual([]);
  });
  it('Word Hunt: finds in quick succession (fire-and-forget) each start, newest last', async () => {
    const { say, ws } = await pageAndBackground();
    const pending: Promise<unknown>[] = [];
    for (const w of WORDS) { pending.push(say(w)); await new Promise((r) => setTimeout(r, 400)); }
    await Promise.all(pending);
    expect(chrome.started).toEqual(WORDS);
    expect(ws.started).toEqual([]);
  });
  it('a background that never answers still falls back on the page', async () => {
    const ws = new FakeWebSpeech();
    g.speechSynthesis = ws; g.SpeechSynthesisUtterance = Utterance;
    const page = await load();
    const r = await page.speakViaBackground(() => new Promise(() => {}), page.webEngine(), 'le chien', 'Google français', 200);
    expect(r).toMatchObject({ ok: true, engine: 'web' });
  });
  it('side panel and page clicking over each other: the newest wins, nobody retries over it', async () => {
    const panel = await load();
    const bg = await load();
    const a = panel.speakWith([panel.ttsEngine()!], 'le chien', 'Google français');
    await new Promise((r) => setTimeout(r, 30));
    const b = bg.speakWith([bg.ttsEngine()!], 'le chat', 'Google français');
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok && rb.ok).toBe(true);
    expect(chrome.started.at(-1)).toBe('le chat');
    expect(chrome.started.filter((x) => x === 'le chien').length).toBeLessThanOrEqual(1);
  }, 15000);
});
