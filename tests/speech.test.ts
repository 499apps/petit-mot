import { describe, it, expect } from 'vitest';
import { pickVoice, rankVoices } from '@/src/speech';

const v = (name: string, lang: string, localService: boolean) => ({ name, lang, localService, voiceURI: name });

describe('voice choice', () => {
  const voices = [v('Google français', 'fr-FR', false), v('Microsoft Paul', 'fr-FR', true), v('Amélie', 'fr-CA', true), v('Samantha', 'en-US', true)];
  it('prefers an on-device fr-FR voice', () => expect(pickVoice(voices, null)?.name).toBe('Microsoft Paul'));
  it('never picks a non-French voice', () => expect(rankVoices(voices).every((x) => x.lang.startsWith('fr'))).toBe(true));
  it('falls back to another local French voice', () => expect(pickVoice([voices[0], voices[2]], null)?.name).toBe('Amélie'));
  it('does not silently use a network voice', () => expect(pickVoice([voices[0]], null)).toBeNull());
  it('honours an explicit choice, even a network voice', () => expect(pickVoice(voices, 'Google français')?.name).toBe('Google français'));
  it('ignores a saved voice that is gone', () => expect(pickVoice(voices, 'Old voice')?.name).toBe('Microsoft Paul'));
});
