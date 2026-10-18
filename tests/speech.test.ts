import { describe, it, expect, vi } from 'vitest';
import { pickVoice, rankVoices, planVoices, speakWith, fromTts, fromWeb, voiceLabel, friendlyError, type Voice, type Engine, type Outcome } from '@/src/speech';

const v = (name: string, lang: string, online: boolean): Voice => ({ name, lang, online });
const google = v('Google français', 'fr-FR', true);
const paul = v('Microsoft Paul', 'fr-FR', false);
const hortense = v('Microsoft Hortense', 'fr-FR', false);
const amelie = v('Amélie', 'fr-CA', false);
const samantha = v('Samantha', 'en-US', false);
const all = [google, paul, amelie, samantha];

function engine(id: Engine['id'], voices: Voice[], outcome: (v: Voice) => Outcome = () => 'ok'): Engine & { said: string[] } {
  const said: string[] = [];
  return { id, said, voices: async () => voices, say: async (_t, voice) => { said.push(voice.name); return outcome(voice); } };
}

describe('voice ranking and choice', () => {
  it('prefers an on-device fr-FR voice', () => expect(pickVoice(all, null)?.name).toBe('Microsoft Paul'));
  it('never picks a non-French voice', () => expect(rankVoices(all).every((x) => x.lang.startsWith('fr'))).toBe(true));
  it('falls back to another local French voice', () => expect(pickVoice([google, amelie], null)?.name).toBe('Amélie'));
  it('does not silently use an online voice', () => expect(pickVoice([google], null)).toBeNull());
  it('honours an explicit choice, even an online voice', () => expect(pickVoice(all, 'Google français')?.name).toBe('Google français'));
  it('ignores a saved voice that is gone', () => expect(pickVoice(all, 'Old voice')?.name).toBe('Microsoft Paul'));
  it('matches a saved Web Speech voiceURI (settings from v0.1)', () => {
    const w = fromWeb({ name: 'Microsoft Hortense - French (France)', lang: 'fr-FR', localService: true, voiceURI: 'urn:hortense' });
    expect(pickVoice([w], 'urn:hortense')?.name).toBe('Microsoft Hortense - French (France)');
  });
});

describe('fallback plan', () => {
  it('saved online voice first, then local French, then other online French', () => {
    const g2 = v('Google français (Canada)', 'fr-CA', true);
    expect(planVoices([g2, google, paul, amelie, samantha], 'Google français').map((x) => x.name))
      .toEqual(['Google français', 'Microsoft Paul', 'Amélie', 'Google français (Canada)']);
  });
  it('a missing saved Google voice still allows other online voices (the learner opted in)', () => {
    const g2 = v('Google français (Canada)', 'fr-CA', true);
    expect(planVoices([g2], 'Google français').map((x) => x.name)).toEqual(['Google français (Canada)']);
  });
  it('no saved choice means local voices only', () => expect(planVoices([google, paul], null)).toEqual([paul]));
  it('saved local voice leads, without online voices', () => expect(planVoices([google, paul, hortense], 'Microsoft Paul').map((x) => x.name)).toEqual(['Microsoft Paul', 'Microsoft Hortense']));
  it('treats Google voices as online even if the engine forgets to say so', () => {
    expect(fromTts({ voiceName: 'Google français', lang: 'fr-FR', remote: false })?.online).toBe(true);
    expect(fromTts({ voiceName: 'Microsoft Paul', lang: 'fr-FR' })?.online).toBe(false);
    expect(fromTts({ lang: 'fr-FR' })).toBeNull();
  });
  it('labels online voices in the picker', () => {
    expect(voiceLabel(google)).toMatch(/online voice \(sent to Google\)/);
    expect(voiceLabel(paul)).toMatch(/on this computer/);
  });
});

describe('speakWith', () => {
  it('the reported bug: a saved Google voice speaks through chrome.tts', async () => {
    const tts = engine('tts', [google, samantha]);
    const r = await speakWith([tts], 'le chien', 'Google français');
    expect(r).toMatchObject({ ok: true, engine: 'tts', voice: { name: 'Google français' } });
  });
  it('moves on to the next voice when one fails or times out', async () => {
    const tts = engine('tts', [google, paul], (x) => (x === google ? 'timeout' : 'ok'));
    const r = await speakWith([tts], 'le chien', 'Google français');
    expect(r.ok).toBe(true);
    expect(tts.said).toEqual(['Google français', 'Microsoft Paul']);
  });
  it('falls back to Web Speech when chrome.tts fails', async () => {
    const tts = engine('tts', [google], () => 'error');
    const web = engine('web', [google]);
    const r = await speakWith([tts, web], 'le chien', 'Google français');
    expect(r).toMatchObject({ ok: true, engine: 'web' });
    expect(r.tried).toEqual(['tts:Google français:error', 'web:Google français:ok']);
  });
  it('an engine whose voice list throws is skipped', async () => {
    const broken: Engine = { id: 'tts', voices: () => Promise.reject(new Error('no tts')), say: vi.fn() };
    const r = await speakWith([broken, engine('web', [paul])], 'x', null);
    expect(r).toMatchObject({ ok: true, engine: 'web' });
  });
  it('a throwing say() counts as an error, not a crash', async () => {
    const bad: Engine = { id: 'tts', voices: async () => [paul], say: () => Promise.reject(new Error('boom')) };
    expect(await speakWith([bad], 'x', null)).toMatchObject({ ok: false, reason: 'failed' });
  });
  it('no French voice at all gives a friendly, visible reason with an install hint', async () => {
    const r = await speakWith([engine('tts', [samantha]), engine('web', [samantha])], 'x', null);
    expect(r).toMatchObject({ ok: false, reason: 'no-french-voice' });
    expect(friendlyError(r)).toMatch(/Time & language → Speech/);
    expect(friendlyError(r, true)).toMatch(/Settings → Voice/);
  });
  it('only online voices and no opt-in: does not send text to Google', async () => {
    const tts = engine('tts', [google]);
    const r = await speakWith([tts], 'x', null);
    expect(r).toMatchObject({ ok: false, reason: 'no-french-voice' });
    expect(tts.said).toEqual([]);
  });
  it('tries at most three voices per engine', async () => {
    const many = [1, 2, 3, 4, 5].map((i) => v(`Voice ${i}`, 'fr-FR', false));
    const tts = engine('tts', many, () => 'error');
    await speakWith([tts], 'x', null);
    expect(tts.said).toHaveLength(3);
  });
  it('no engine available', async () => expect(await speakWith([], 'x', null)).toMatchObject({ ok: false, reason: 'unavailable' }));
});
