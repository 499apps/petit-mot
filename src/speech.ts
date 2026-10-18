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
export type Outcome = 'ok' | 'error' | 'timeout';
export interface Engine {
  id: 'tts' | 'web';
  voices(): Promise<Voice[]>;
  say(text: string, voice: Voice, rate: number): Promise<Outcome>;
}
export interface SpeakResult {
  ok: boolean;
  voice?: Voice;
  engine?: Engine['id'];
  reason?: 'no-french-voice' | 'failed' | 'unavailable';
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
/** Try each engine's planned voices until one actually starts speaking. */
export async function speakWith(engines: Engine[], text: string, saved: string | null, rate = 0.85): Promise<SpeakResult> {
  const tried: string[] = [];
  let anyVoice = false;
  for (const engine of engines) {
    const voices = await engine.voices().catch(() => [] as Voice[]);
    const plan = planVoices(voices, saved).slice(0, MAX_TRIES_PER_ENGINE);
    if (plan.length) anyVoice = true;
    for (const voice of plan) {
      const out = await engine.say(text, voice, rate).catch(() => 'error' as Outcome);
      tried.push(`${engine.id}:${voice.name}:${out}`);
      if (out === 'ok') return { ok: true, voice, engine: engine.id, tried };
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

const timeoutFor = (v: Voice) => (v.online ? 6000 : 2500);

interface TtsEvent { type: string }
interface TtsApi {
  speak(text: string, options: { voiceName?: string; lang?: string; rate?: number; enqueue?: boolean; onEvent?: (e: TtsEvent) => void }, cb?: () => void): void;
  getVoices(cb: (voices: { voiceName?: string; lang?: string; remote?: boolean }[]) => void): void;
  isSpeaking(cb: (speaking: boolean) => void): void;
  stop(): void;
}
type ChromeLike = { tts?: TtsApi; runtime?: { lastError?: unknown } };
const chromeApi = () => (globalThis as { chrome?: ChromeLike }).chrome;

/** chrome.tts engine, available in extension pages and the background worker (needs the "tts" permission). */
export function ttsEngine(): Engine | null {
  const tts = chromeApi()?.tts;
  if (!tts?.speak) return null;
  return {
    id: 'tts',
    voices: () => new Promise<Voice[]>((res) => tts.getVoices((vs) => res((vs ?? []).map(fromTts).filter((v): v is Voice => !!v)))),
    say: (text, voice, rate) => new Promise<Outcome>((res) => {
      let done = false;
      const finish = (o: Outcome) => { if (!done) { done = true; clearTimeout(timer); res(o); } };
      const timer = setTimeout(() => {
        // Some engines don't send "start"; if it is speaking, that counts.
        tts.isSpeaking((speaking) => { if (speaking) finish('ok'); else { tts.stop(); finish('timeout'); } });
      }, timeoutFor(voice));
      try {
        // enqueue:false interrupts anything playing, so no cancel-then-speak race.
        tts.speak(text, {
          voiceName: voice.name, lang: voice.lang || 'fr-FR', rate, enqueue: false,
          onEvent: (e) => {
            if (e.type === 'start' || e.type === 'end' || e.type === 'word') finish('ok');
            else if (e.type === 'error' || e.type === 'cancelled') finish('error');
          },
        }, () => { if (chromeApi()?.runtime?.lastError) finish('error'); });
      } catch { finish('error'); }
    }),
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
    say: async (text, voice, rate) => {
      const real = (await load()).find((v) => matches(fromWeb(v), voice.uri ?? voice.name));
      if (!real) return 'error';
      if (ss.speaking || ss.pending) { ss.cancel(); await new Promise((r) => setTimeout(r, 80)); } // speak() right after cancel() is dropped by Chrome
      if (ss.paused) ss.resume();
      return new Promise<Outcome>((res) => {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = real; u.lang = real.lang || 'fr-FR'; u.rate = rate;
        let done = false;
        const finish = (o: Outcome) => { if (!done) { done = true; clearTimeout(timer); res(o); } };
        const timer = setTimeout(() => { if (ss.speaking && !ss.paused) finish('ok'); else { ss.cancel(); finish('timeout'); } }, timeoutFor(voice));
        u.onstart = () => finish('ok');
        u.onend = () => finish('ok');
        u.onerror = (e) => finish(e.error === 'interrupted' ? 'ok' : 'error');
        held = u;
        ss.speak(u);
      });
    },
  };
}

/** Engines usable in the current context, best first. */
export function localEngines(): Engine[] {
  return [ttsEngine(), webEngine()].filter((e): e is Engine => !!e);
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
