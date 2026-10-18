/**
 * The built-in "Petit Mot voice": pre-recorded clips shipped inside the extension
 * (public/audio, made by `npm run audio`). Works offline, on every computer, with or without a
 * French system voice, and sends nothing anywhere. System voices (chrome.tts / Web Speech) are
 * an option in Settings and the fallback for any text without a clip.
 */
import map from './data/audio.json';
import { withArticle } from './words';
import type { Word } from './types';
import type { SpeakResult } from './speech';

export const BUILTIN_LABEL = 'Petit Mot voice (built-in, offline)';
export const TEST_PHRASE = 'Bonjour ! Je m’appelle Petit Mot.';
const CLIPS = (map as unknown as { clips: Record<string, [string] | [string, number]> }).clips;

/** Something to say: a bundled clip if there is one, and the text for a system voice. */
export interface Clip { path: string | null; text: string }
export function wordClip(w: Word): Clip {
  const c = CLIPS[w.id];
  return { path: c ? `audio/w/${c[0]}.ogg` : null, text: withArticle(w) };
}
export function exampleClip(w: Word): Clip {
  const c = CLIPS[w.id];
  return { path: c && c[1] && w.ex ? `audio/e/${c[0]}.ogg` : null, text: w.ex?.fr ?? '' };
}
export const TEST_CLIP: Clip = { path: 'audio/test.ogg', text: TEST_PHRASE };
export const hasClip = (id: string) => !!CLIPS[id];

// ---------------- playback ----------------

export type PlayOutcome = 'ok' | 'error' | 'timeout' | 'superseded';
/** The bits of HTMLAudioElement we use (so tests can fake it). */
export interface AudioLike {
  src: string;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
export interface Player { play(path: string): Promise<PlayOutcome>; stop(): void }

/**
 * One clip at a time. Every play() stops the previous clip first and uses a fresh audio element,
 * so an old click's late events can't touch the new one. Resolves when audio is actually playing
 * (the 'playing' event or play() resolving), never waits for the end, and gives up after a hard
 * timeout. An older play() that a newer one replaced resolves 'superseded'.
 */
export class ClipPlayer implements Player {
  private gen = 0;
  private el: AudioLike | null = null;
  constructor(private make: () => AudioLike, private url: (path: string) => string, private startTimeout = 3000) {}

  stop(): void {
    this.gen++;
    const el = this.el;
    this.el = null;
    if (!el) return;
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* already gone */ }
  }

  play(path: string): Promise<PlayOutcome> {
    this.stop();
    const mine = this.gen;
    const el = this.make();
    this.el = el;
    return new Promise<PlayOutcome>((resolve) => {
      let done = false;
      const current = () => mine === this.gen;
      const finish = (o: PlayOutcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('error', onError);
        resolve(current() ? o : 'superseded');
      };
      const onPlaying = () => finish('ok');
      const onError = () => finish('error');
      const timer = setTimeout(() => { finish('timeout'); if (current()) this.stop(); }, this.startTimeout);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('error', onError);
      el.preload = 'auto';
      el.src = this.url(path);
      let p: Promise<void> | undefined;
      try { p = el.play(); } catch { finish('error'); return; }
      void p?.then(() => finish('ok'), (e: { name?: string }) => finish(e?.name === 'AbortError' && !current() ? 'superseded' : 'error'));
    });
  }
}

export interface VoiceChoice { voice: 'builtin' | 'system'; voiceURI: string | null }
export interface PronounceDeps {
  player: Player;
  /** A system voice (chrome.tts / Web Speech). */
  speak: (text: string, voiceURI: string | null) => Promise<SpeakResult>;
  /** Silence any system voice, so it can't talk over a clip. */
  stopSpeech?: () => void;
}

/**
 * Say a word or sentence. Built-in voice: play the clip, and only if that fails (or there is no
 * clip) use a system voice. System voice chosen: speak with it, and if it doesn't start, play
 * the clip. Newest call wins; an older one resolves { ok: true, superseded: true } quietly.
 */
export function makePronouncer(deps: PronounceDeps) {
  let gen = 0;
  return async function pronounce(clip: Clip, choice: VoiceChoice): Promise<SpeakResult> {
    const mine = ++gen;
    const stale = () => mine !== gen;
    const superseded = (tried: string[]): SpeakResult => ({ ok: true, superseded: true, tried });
    const tried: string[] = [];
    const playClip = async (): Promise<SpeakResult | null> => {
      if (!clip.path) return null;
      try { deps.stopSpeech?.(); } catch { /* nothing speaking */ }
      const out = await deps.player.play(clip.path).catch(() => 'error' as PlayOutcome);
      tried.push(`clip:${clip.path}:${out}`);
      if (out === 'ok') return stale() ? superseded(tried) : { ok: true, engine: 'clip', tried };
      if (out === 'superseded' || stale()) return superseded(tried);
      return null;
    };
    const system = async (): Promise<SpeakResult | null> => {
      if (!clip.text) return null;
      deps.player.stop();
      const r = await deps.speak(clip.text, choice.voiceURI);
      tried.push(...r.tried);
      if (r.superseded || stale()) return superseded(tried);
      return { ...r, tried };
    };
    if (choice.voice === 'system') {
      const r = await system();
      if (r?.ok) return r;
      const c = await playClip();
      return c ?? r ?? { ok: false, reason: 'failed', tried };
    }
    const c = await playClip();
    if (c) return c;
    const r = await system();
    return r ?? { ok: false, reason: 'failed', tried };
  };
}

/** An audio player for extension pages (side panel, offscreen document). */
export function pagePlayer(): ClipPlayer {
  const url = (p: string) => (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime?.getURL?.(p) ?? `/${p}`;
  return new ClipPlayer(() => new Audio() as unknown as AudioLike, url);
}
