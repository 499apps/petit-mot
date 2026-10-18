/** Pronunciation with the computer's own voices. Never uses network voices unless asked. */
export interface VoiceLike { name: string; lang: string; localService: boolean; voiceURI: string; default?: boolean }

export function rankVoices<T extends VoiceLike>(voices: T[]): T[] {
  const score = (v: T) => {
    const lang = v.lang.toLowerCase().replace('_', '-');
    let s = 0;
    if (lang === 'fr-fr') s += 40; else if (lang.startsWith('fr')) s += 25; else return -1;
    if (v.localService) s += 50; // on-device: works offline, nothing sent anywhere
    if (/natural|neural|premium|enhanced/i.test(v.name)) s += 5;
    return s;
  };
  return voices.filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Preferred voice: the saved choice if still installed, else the best local French voice. */
export function pickVoice<T extends VoiceLike>(voices: T[], preferredURI: string | null): T | null {
  const ranked = rankVoices(voices);
  const saved = preferredURI ? ranked.find((v) => v.voiceURI === preferredURI) : undefined;
  return saved ?? ranked.find((v) => v.localService) ?? null;
}

let cached: SpeechSynthesisVoice[] = [];
export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve((cached = now));
  return new Promise((res) => {
    const done = () => res((cached = speechSynthesis.getVoices()));
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function speak(text: string, preferredURI: string | null, rate = 0.85): Promise<boolean> {
  if (typeof speechSynthesis === 'undefined') return false;
  const voice = pickVoice(cached.length ? cached : await voicesReady(), preferredURI);
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  speechSynthesis.speak(u);
  return true;
}
