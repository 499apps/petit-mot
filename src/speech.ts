/**
 * Pronunciation. Prefers French voices installed on this computer; an online voice
 * (for example "Google français", which sends the text to Google) is used only when the
 * learner picked one in Settings.
 *
 * Two engines:
 *  - chrome.tts (extension pages and the background worker). This is the reliable path, and the
 *    one that drives Chrome's Google voices.
 *  - Web Speech (speechSynthesis), used as a fallback in the side panel and in the page.
 * Each attempt waits for the engine to say it started. A failure moves on to the next voice
 * or engine, and the caller gets a result it can show to the learner.
 */

export interface Voice { name: string; lang: string; online: boolean; uri?: string }
/** 'superseded': a newer request (or another speaker) took over; not a failure, and not worth retrying. */
export type Outcome = 'ok' | 'error' | 'timeout' | 'superseded';
/** Tells an attempt whether it is still the newest request. */
export type StillCurrent = () => boolean;
export interface Engine {
  id: 'tts' | 'web';
  voices(): Promise<Voice[]>;
  say(text: string, voice: Voice, rate: number, current?: StillCurrent, settleMs?: number): Promise<Outcome>;
}
export interface SpeakResult {
  ok: boolean;
  voice?: Voice;
  engine?: Engine['id'] | 'clip';
  reason?: 'no-french-voice' | 'failed' | 'unavailable';
  /** A newer 🔊 click replaced this one. Nothing to show the learner. */
  superseded?: boolean;
  tried: string[];
}

const GOOGLE = /^google\b/i;
const norm = (lang: string) => (lang || '').toLowerCase().replace('_', '-');
export const isFrench = (v: Voice) => norm(v.lang).startsWith('fr');

/** chrome.tts voice → Voice. Google voices are online even if an engine forgets to say so. */
export function fromTts(v: { voiceName?: string; lang?: string; remote?: boolean }): Voice | null {
  if (!v.voiceName) return null;
  return { name: v.voiceName, lang: v.lang ?? '', online: !!v.remote || GOOGLE.test(v.voiceName) };
}
export function fromWeb(v: { name: string; lang: string; localService: boolean; voiceURI: string }): Voice {
  return { name: v.name, lang: v.lang, online: !v.localService || GOOGLE.test(v.name), uri: v.voiceURI };
}

function score(v: Voice): number {
  let s = norm(v.lang) === 'fr-fr' ? 40 : 25;
  if (!v.online) s += 50;
  if (/natural|neural|premium|enhanced/i.test(v.name)) s += 5;
  return s;
}
/** French voices only, best first: on-device fr-FR, then on-device fr-*, then online voices. */
export function rankVoices(voices: Voice[]): Voice[] {
  const seen = new Set<string>();
  return voices.filter(isFrench).filter((v) => !seen.has(v.name) && seen.add(v.name))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}
export const matches = (v: Voice, saved: string) => v.name === saved || v.uri === saved;

/**
 * The voices to try, in order:
 *  1. the saved choice, if it is still there (local or online, since the learner chose it);
 *  2. every on-device French voice, best first;
 *  3. online French voices, but only if the learner opted into an online voice.
 * A saved Google voice that is missing still counts as opting in.
 */
export function planVoices(voices: Voice[], saved: string | null): Voice[] {
  const fr = rankVoices(voices);
  const chosen = saved ? fr.find((v) => matches(v, saved)) : undefined;
  const optedOnline = !!saved && (chosen ? chosen.online : GOOGLE.test(saved));
  const plan = [...(chosen ? [chosen] : []), ...fr.filter((v) => !v.online), ...(optedOnline ? fr.filter((v) => v.online) : [])];
  return plan.filter((v, i) => plan.indexOf(v) === i);
}

/** Back-compat helper: the voice that would be tried first. */
export function pickVoice(voices: Voice[], saved: string | null): Voice | null {
  return planVoices(voices, saved)[0] ?? null;
}

export function voiceLabel(v: Voice): string {
  const where = !v.online ? 'on this computer' : GOOGLE.test(v.name) ? 'online voice (sent to Google)' : 'online voice (sent to the voice provider)';
  return `${v.name} (${v.lang}) · ${where}`;
}

const MAX_TRIES_PER_ENGINE = 3;
/** Pause between stopping old speech and starting new. Chrome (and Google's online voices) can
 *  drop an utterance that arrives while the previous one is still being torn down. */
export const SETTLE_MS = 150;
export const RETRY_SETTLE_MS = 400;
/** How long to wait for an engine to say it started. Never wait for 'end'. */
export const startTimeout = (v: Voice) => (v.online ? 4000 : 2000);
const VOICES_TIMEOUT = 2500;

let generation = 0; // newest speak request in this page/worker
const within = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Try each engine's planned voices until one actually starts speaking. Each request supersedes
 * the previous one in this context: an older click stops trying (no fallback, no error) as soon
 * as a newer click starts. A voice that does not start in time is stopped and tried once more,
 * fresh, before moving on, because a stuck online voice usually recovers after a clean stop.
 */
export async function speakWith(engines: Engine[], text: string, saved: string | null, rate = 0.85): Promise<SpeakResult> {
  const mine = ++generation;
  const current: StillCurrent = () => mine === generation;
  const tried: string[] = [];
  const superseded = (): SpeakResult => ({ ok: true, superseded: true, tried });
  let anyVoice = false;
  for (const engine of engines) {
    const voices = await within(engine.voices(), VOICES_TIMEOUT, [] as Voice[]);
    if (!current()) return superseded();
    const plan = planVoices(voices, saved).slice(0, MAX_TRIES_PER_ENGINE);
    if (plan.length) anyVoice = true;
    for (const voice of plan) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const settle = attempt ? RETRY_SETTLE_MS : SETTLE_MS;
        // Hard cap so a broken engine can never hold this request forever.
        const out = await within(engine.say(text, voice, rate, current, settle), startTimeout(voice) + settle + 1000, 'timeout' as Outcome);
        tried.push(`${engine.id}:${voice.name}:${out}`);
        if (out === 'ok') return current() ? { ok: true, voice, engine: engine.id, tried } : superseded();
        if (out === 'superseded' || !current()) return superseded();
        if (out !== 'timeout') break; // an error from this voice won't fix itself; try the next one
      }
    }
  }
  if (!engines.length) return { ok: false, reason: 'unavailable', tried };
  return { ok: false, reason: anyVoice ? 'failed' : 'no-french-voice', tried };
}

export const INSTALL_HINT = 'On Windows: Settings → Time & language → Speech → Add voices → Français (France). On a Mac: System Settings → Accessibility → Spoken Content → System voice → Manage voices.';
export function friendlyError(r: SpeakResult, short = false): string {
  if (r.ok) return '';
  if (r.reason === 'no-french-voice') return short ? 'No French voice on this computer yet. See Settings → Voice.' : `No French voice on this computer yet. ${INSTALL_HINT}`;
  return short ? 'The voice didn’t play. Try another voice in Settings → Voice.' : 'The voice didn’t play. Try another voice, or check that sound is on. Online voices also need the internet.';
}

// ---------------- engines ----------------

interface TtsEvent { type: string; errorMessage?: string }
interface TtsApi {
  speak(text: string, options: { voiceName?: string; lang?: string; rate?: number; enqueue?: boolean; onEvent?: (e: TtsEvent) => void }, cb?: () => void): void;
  getVoices(cb: (voices: { voiceName?: string; lang?: string; remote?: boolean }[]) => void): void;
  stop(): void;
}
type ChromeLike = { tts?: TtsApi; runtime?: { lastError?: unknown } };
const chromeApi = () => (globalThis as { chrome?: ChromeLike }).chrome;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const always: StillCurrent = () => true;

/**
 * One attempt, shared by both engines: start fresh, resolve as soon as speech starts, never wait
 * for 'end'. Online Google voices may never send 'end', and Chrome then still counts them as
 * speaking, so "is it speaking?" is not evidence that *this* word started.
 */
function attempt(begin: (ev: { started(): void; failed(): void; interrupted(): void }) => void, cancel: () => void, voice: Voice, current: StillCurrent): Promise<Outcome> {
  return new Promise<Outcome>((res) => {
    let done = false;
    const finish = (o: Outcome) => { if (!done) { done = true; clearTimeout(timer); clearInterval(watch); res(o); } };
    const timer = setTimeout(() => {
      finish(current() ? 'timeout' : 'superseded'); // first, so the stop's own 'interrupted' can't relabel it
      try { cancel(); } catch { /* ignore */ }
    }, startTimeout(voice));
    // A newer click takes over; let it do the stopping.
    const watch = setInterval(() => { if (!current()) finish('superseded'); }, 50);
    try {
      begin({
        started: () => finish('ok'),
        failed: () => finish('error'),
        // Interrupted/cancelled is normal: someone newer is speaking. After 'start' it is ignored.
        interrupted: () => finish('superseded'),
      });
    } catch { finish('error'); }
  });
}

/** chrome.tts engine, available in extension pages and the background worker (needs the "tts" permission). */
export function ttsEngine(): Engine | null {
  const tts = chromeApi()?.tts;
  if (!tts?.speak) return null;
  return {
    id: 'tts',
    voices: () => new Promise<Voice[]>((res) => tts.getVoices((vs) => res((vs ?? []).map(fromTts).filter((v): v is Voice => !!v)))),
    say: async (text, voice, rate, current = always, settleMs = SETTLE_MS) => {
      try { tts.stop(); } catch { /* nothing playing */ }
      await wait(settleMs);
      if (!current()) return 'superseded';
      return attempt((ev) => {
        // Already stopped and settled. enqueue:false still guards against another page or the
        // worker having started something meanwhile (never queue behind a voice that won't end).
        tts.speak(text, {
          voiceName: voice.name, lang: voice.lang || 'fr-FR', rate, enqueue: false,
          onEvent: (e) => {
            if (e.type === 'start' || e.type === 'word' || e.type === 'sentence' || e.type === 'marker' || e.type === 'end') ev.started();
            else if (e.type === 'interrupted' || e.type === 'cancelled') ev.interrupted();
            else if (e.type === 'error') ev.failed();
          },
        }, () => { if (chromeApi()?.runtime?.lastError) ev.failed(); });
      }, () => tts.stop(), voice, current);
    },
  };
}

let held: SpeechSynthesisUtterance | null = null; // Chrome can garbage-collect a live utterance and drop its events
/** Web Speech engine (side panel or page). */
export function webEngine(): Engine | null {
  const ss = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const load = () => new Promise<SpeechSynthesisVoice[]>((res) => {
    const now = ss.getVoices();
    if (now.length) return res(now);
    const done = () => res(ss.getVoices());
    ss.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500); // the list loads asynchronously; never wait forever
  });
  return {
    id: 'web',
    voices: async () => (await load()).map(fromWeb),
    say: async (text, voice, rate, current = always, settleMs = SETTLE_MS) => {
      const real = (await load()).find((v) => matches(fromWeb(v), voice.uri ?? voice.name));
      if (!real) return 'error';
      ss.cancel(); // always: a Google voice that never ended still holds the queue
      await wait(settleMs); // speak() right after cancel() is dropped by Chrome
      if (!current()) return 'superseded';
      if (ss.paused) ss.resume();
      return attempt((ev) => {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = real; u.lang = real.lang || 'fr-FR'; u.rate = rate;
        u.onstart = () => ev.started();
        u.onboundary = () => ev.started();
        u.onend = () => ev.started();
        u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? ev.interrupted() : ev.failed());
        held = u;
        ss.speak(u);
      }, () => ss.cancel(), voice, current);
    },
  };
}

/** Stop any system voice in this context (before a bundled clip plays). */
export function stopSpeech(): void {
  try { chromeApi()?.tts?.stop(); } catch { /* not available */ }
  try { (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel(); } catch { /* not available */ }
}

/** Engines usable in the current context, best first. */
export function localEngines(): Engine[] {
  return [ttsEngine(), webEngine()].filter((e): e is Engine => !!e);
}

let pageGeneration = 0;
/**
 * Content-script speech: ask the background (chrome.tts reaches every Chrome voice), then fall
 * back to the page's own Web Speech. A newer click supersedes an older one, so a slow, failed
 * older request can never start a fallback over the newer word.
 */
export async function speakViaBackground(
  ask: (text: string) => Promise<SpeakResult | null>, local: Engine | null, text: string, saved: string | null, waitMs = 12000,
): Promise<SpeakResult> {
  const mine = ++pageGeneration;
  const bg = await within(ask(text), waitMs, null);
  if (bg?.ok) return bg;
  if (mine !== pageGeneration) return { ok: true, superseded: true, tried: bg?.tried ?? [] };
  const res = local ? await speakWith([local], text, saved) : null;
  if (res?.ok) return res;
  if (mine !== pageGeneration) return { ok: true, superseded: true, tried: [...(bg?.tried ?? []), ...(res?.tried ?? [])] };
  const none = (!bg || bg.reason === 'no-french-voice') && (!res || res.reason === 'no-french-voice');
  return { ok: false, reason: none ? 'no-french-voice' : 'failed', tried: [...(bg?.tried ?? []), ...(res?.tried ?? [])] };
}

export async function speak(text: string, saved: string | null, rate = 0.85): Promise<SpeakResult> {
  return speakWith(localEngines(), text, saved, rate);
}

/** The French voices to offer in Settings (chrome.tts names, which Web Speech shares in Chrome). */
export async function listFrenchVoices(): Promise<Voice[]> {
  for (const e of localEngines()) {
    const v = rankVoices(await e.voices().catch(() => []));
    if (v.length) return v;
  }
  return [];
}
export { held as _heldUtterance };
