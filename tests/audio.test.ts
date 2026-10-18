import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORDS } from '@/src/words';
import { wordClip, exampleClip, TEST_CLIP, TEST_PHRASE, ClipPlayer, makePronouncer, type AudioLike, type Player, type PlayOutcome } from '@/src/audio';
import { normalizeSettings } from '@/src/store';
import type { SpeakResult } from '@/src/speech';
// @ts-expect-error plain .mjs build script, no types
import { wordText, sentenceText, TEST_PHRASE as BUILD_TEST_PHRASE } from '../scripts/build-audio.mjs';

const ROOT = path.resolve(__dirname, '..');
const pub = (p: string) => path.join(ROOT, 'public', p);
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/audio-lock.json'), 'utf8')) as { clips: Record<string, { file: string; source: string; bytes: number }> };

/** Duration of an Ogg Opus file from its last page's granule position (48 kHz, minus pre-skip). */
function opusSeconds(buf: Buffer): number {
  expect(buf.subarray(0, 4).toString()).toBe('OggS');
  expect(buf.indexOf('OpusHead')).toBeGreaterThan(0);
  const preSkip = buf.readUInt16LE(buf.indexOf('OpusHead') + 10);
  const last = buf.lastIndexOf('OggS');
  return (Number(buf.readBigUInt64LE(last + 6)) - preSkip) / 48000;
}

describe('bundled audio', () => {
  it('every word in the pack has a clip that exists and is a real Ogg Opus file of word length', () => {
    const bad: string[] = [];
    for (const w of WORDS) {
      const c = wordClip(w);
      if (!c.path || !fs.existsSync(pub(c.path))) { bad.push(w.id); continue; }
      const s = opusSeconds(fs.readFileSync(pub(c.path)));
      if (s < 0.25 || s > 4) bad.push(`${w.id} (${s.toFixed(2)} s)`);
    }
    expect(bad).toEqual([]);
  });
  it('every example sentence has a clip', () => {
    const ex = WORDS.filter((w) => w.ex);
    expect(ex.length).toBeGreaterThan(250);
    const bad = ex.filter((w) => { const c = exampleClip(w); return !c.path || !fs.existsSync(pub(c.path)); }).map((w) => w.id);
    expect(bad).toEqual([]);
    for (const w of ex.slice(0, 40)) expect(opusSeconds(fs.readFileSync(pub(exampleClip(w).path!)))).toBeLessThan(15);
  });
  it('clips match the current text (run `npm run audio` after editing words)', () => {
    const stale: string[] = [];
    for (const w of WORDS) {
      if (lock.clips[`w:${w.id}`]?.source !== wordText(w)) stale.push(`w:${w.id}`);
      if (w.ex && lock.clips[`e:${w.id}`]?.source !== sentenceText(w.ex.fr)) stale.push(`e:${w.id}`);
    }
    expect(stale).toEqual([]);
    expect(TEST_PHRASE).toBe(BUILD_TEST_PHRASE);
  });
  it('the Settings test clip exists', () => expect(opusSeconds(fs.readFileSync(pub(TEST_CLIP.path!)))).toBeGreaterThan(1));
  it('no orphan clips, and the whole set stays under 10 MB', () => {
    const files = ['w', 'e'].flatMap((d) => fs.readdirSync(pub(`audio/${d}`)).map((f) => `${d}/${f}`));
    const known = new Set(Object.values(lock.clips).map((c) => c.file));
    expect(files.filter((f) => !known.has(f))).toEqual([]);
    const total = files.reduce((a, f) => a + fs.statSync(pub(`audio/${f}`)).size, 0);
    expect(total).toBeLessThan(10 * 1024 * 1024);
  });
  it('a word without a clip still has text for the system-voice fallback', () => {
    const c = wordClip({ ...WORDS[0], id: 'not-in-pack.n' });
    expect(c).toEqual({ path: null, text: WORDS[0].fr });
  });
});

/** HTMLAudioElement stand-in: 'playing' fires after `delay` ms unless told to fail or hang. */
class FakeAudio implements AudioLike {
  static made: FakeAudio[] = [];
  static mode: 'ok' | 'error' | 'hang' | 'blocked' = 'ok';
  src = ''; preload = ''; paused = true; startedAt = 0;
  private l: Record<string, (() => void)[]> = {};
  constructor(public delay = 5) { FakeAudio.made.push(this); }
  addEventListener(t: string, f: () => void) { (this.l[t] ??= []).push(f); }
  removeEventListener(t: string, f: () => void) { this.l[t] = (this.l[t] ?? []).filter((x) => x !== f); }
  emit(t: string) { [...(this.l[t] ?? [])].forEach((f) => f()); }
  play() {
    const mode = FakeAudio.mode, src = this.src;
    return new Promise<void>((res, rej) => {
      if (mode === 'blocked') return rej(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
      setTimeout(() => {
        if (this.src !== src) return rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (mode === 'error') { this.emit('error'); return rej(Object.assign(new Error('bad'), { name: 'NotSupportedError' })); }
        if (mode === 'hang') return;
        this.paused = false; this.startedAt = Date.now(); this.emit('playing'); res();
      }, this.delay);
    });
  }
  pause() { this.paused = true; }
  removeAttribute(n: string) { if (n === 'src') this.src = ''; }
  load() {}
}
const player = (timeout = 3000) => { FakeAudio.made = []; FakeAudio.mode = 'ok'; return new ClipPlayer(() => new FakeAudio(), (p) => `chrome-extension://x/${p}`, timeout); };

describe('ClipPlayer', () => {
  it('10 words in a row all play', async () => {
    const p = player();
    for (let i = 0; i < 10; i++) expect(await p.play(`audio/w/${i}.ogg`)).toBe('ok');
    expect(FakeAudio.made.map((a) => a.paused)).toEqual([...Array(9).fill(true), false]); // each click stopped the previous clip
  });
  it('rapid clicks: only the newest clip plays; older ones resolve "superseded"', async () => {
    const p = player();
    const outs = await Promise.all([0, 1, 2, 3, 4].map((i) => p.play(`audio/w/${i}.ogg`)));
    expect(outs).toEqual(['superseded', 'superseded', 'superseded', 'superseded', 'ok']);
    expect(FakeAudio.made.filter((a) => !a.paused)).toHaveLength(1);
    expect(FakeAudio.made.at(-1)!.src).toBe('chrome-extension://x/audio/w/4.ogg');
    expect(await p.play('audio/w/5.ogg')).toBe('ok'); // and the next calm click still works
  });
  it('a click while the previous clip is still playing stops it and plays the new one', async () => {
    const p = player();
    await p.play('audio/w/a.ogg');
    const first = FakeAudio.made[0];
    expect(await p.play('audio/w/b.ogg')).toBe('ok');
    expect(first.paused).toBe(true);
    expect(first.src).toBe('');
  });
  it('a broken file reports an error', async () => { const p = player(); FakeAudio.mode = 'error'; expect(await p.play('audio/w/x.ogg')).toBe('error'); });
  it('autoplay refusal reports an error (so the fallback can run)', async () => { const p = player(); FakeAudio.mode = 'blocked'; expect(await p.play('audio/w/x.ogg')).toBe('error'); });
  it('a clip that never starts times out instead of hanging', async () => {
    const p = player(100); FakeAudio.mode = 'hang';
    expect(await p.play('audio/w/x.ogg')).toBe('timeout');
    expect(FakeAudio.made[0].paused).toBe(true);
  });
});

describe('pronounce: built-in voice first, system voice as fallback', () => {
  const ok: SpeakResult = { ok: true, engine: 'tts', tried: ['tts:Paul:ok'] };
  function setup(play: (p: string) => Promise<PlayOutcome> = async () => 'ok', speak: () => Promise<SpeakResult> = async () => ok) {
    const calls: string[] = [];
    const pl: Player = { play: (p) => { calls.push(`play ${p}`); return play(p); }, stop: () => calls.push('stop') };
    const sp = vi.fn(async (t: string) => { calls.push(`speak ${t}`); return speak(); });
    const stopSpeech = () => calls.push('stopSpeech');
    return { calls, sp, pronounce: makePronouncer({ player: pl, speak: sp, stopSpeech }) };
  }
  const clip = { path: 'audio/w/chien-n.ogg', text: 'le chien' };
  const builtin = { voice: 'builtin' as const, voiceURI: null };
  it('plays the clip, silencing any system voice first, without touching TTS', async () => {
    const { pronounce, calls, sp } = setup();
    expect(await pronounce(clip, builtin)).toMatchObject({ ok: true, engine: 'clip' });
    expect(calls).toEqual(['stopSpeech', 'play audio/w/chien-n.ogg']);
    expect(sp).not.toHaveBeenCalled();
  });
  it('falls back to a system voice if the clip fails or times out', async () => {
    for (const out of ['error', 'timeout'] as const) {
      const { pronounce, calls } = setup(async () => out);
      expect(await pronounce(clip, builtin)).toMatchObject({ ok: true, engine: 'tts' });
      expect(calls).toContain('speak le chien');
    }
  });
  it('a word without a clip uses a system voice', async () => {
    const { pronounce, calls } = setup();
    await pronounce({ path: null, text: 'le chien' }, builtin);
    expect(calls).toEqual(['stop', 'speak le chien']);
  });
  it('system voice chosen: speaks with it, and plays the clip if it fails', async () => {
    const { pronounce, calls } = setup(async () => 'ok', async () => ({ ok: false, reason: 'failed', tried: ['tts:Google français:timeout'] }));
    expect(await pronounce(clip, { voice: 'system', voiceURI: 'Google français' })).toMatchObject({ ok: true, engine: 'clip' });
    expect(calls).toEqual(['stop', 'speak le chien', 'stopSpeech', 'play audio/w/chien-n.ogg']);
  });
  it('nothing works: a visible failure, not silence', async () => {
    const { pronounce } = setup(async () => 'error', async () => ({ ok: false, reason: 'no-french-voice', tried: [] }));
    expect(await pronounce(clip, builtin)).toMatchObject({ ok: false, reason: 'no-french-voice' });
  });
  it('rapid clicks: older requests bow out without falling back to TTS', async () => {
    const p = player();
    const { pronounce, sp } = (() => { const sp = vi.fn(async () => ok); return { sp, pronounce: makePronouncer({ player: p, speak: sp }) }; })();
    const rs = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => pronounce({ path: `audio/w/${x}.ogg`, text: x }, builtin)));
    expect(rs.slice(0, 4).every((r) => r.ok && r.superseded)).toBe(true);
    expect(rs[4]).toMatchObject({ ok: true, engine: 'clip' });
    expect(sp).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  it('everyone starts on the built-in voice (0.2.0), keeping any system voice they picked', () => {
    expect(normalizeSettings({ voiceURI: 'Google français' } as never)).toMatchObject({ voice: 'builtin', voiceURI: 'Google français' });
    expect(normalizeSettings(undefined).voice).toBe('builtin');
    expect(normalizeSettings({ voice: 'system' } as never).voice).toBe('system');
  });
});
