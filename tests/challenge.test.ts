import { describe, it, expect } from 'vitest';
import { encode, decode, buildQuiz, CodeError, newChallengeId, cleanName, type Challenge } from '@/src/challenge';

const base: Challenge = {
  kind: 'challenge', id: newChallengeId(123456789), from: { name: 'Léo', avatar: '🦊', score: 5 },
  words: ['chien.n', 'chat.n', 'maison.n', 'pomme.n', 'rouge.adj', 'manger.v'], seed: 123456789,
};

describe('challenge codes', () => {
  it('round-trips a challenge exactly', () => {
    const code = encode(base);
    expect(code.startsWith('PM1-')).toBe(true);
    expect(decode(code)).toEqual(base);
  });

  it('round-trips a reply with the original challenger', () => {
    const reply: Challenge = { ...base, kind: 'reply', from: { name: 'Dad', avatar: '🐼', score: 6 }, replyTo: base.from };
    expect(decode(encode(reply))).toEqual(reply);
  });

  it('tolerates whitespace and line breaks from chat apps', () => {
    const code = encode(base);
    const mangled = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} \r\n${code.slice(50)}  `;
    expect(decode(mangled)).toEqual(base);
  });

  it('detects typos and truncation', () => {
    const code = encode(base);
    const i = 10;
    const typo = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect(() => decode(typo)).toThrow(CodeError);
    expect(() => decode(code.slice(0, -6))).toThrow(CodeError);
    expect(() => decode('hello')).toThrow(/PM1-/);
  });

  it('rejects unknown words (different pack version) and bad sizes', () => {
    expect(() => decode(encode({ ...base, words: ['chien.n', 'zzz.n', 'chat.n'] }))).toThrow(/different version/);
    expect(() => decode(encode({ ...base, words: ['chien.n'] }))).toThrow(/number of words/);
  });

  it('sanitises names and clamps scores', () => {
    expect(cleanName('<b>Bob</b>\u0007')).toBe('bBob/b');
    expect(cleanName('')).toBe('Someone');
    const c = decode(encode({ ...base, from: { ...base.from, score: 99 } }));
    expect(c.from.score).toBeNull();
  });

  it('builds the same quiz from the same seed on both computers', () => {
    const a = buildQuiz(base.words, base.seed);
    const b = buildQuiz(base.words, base.seed);
    expect(a.map((q) => q.options)).toEqual(b.map((q) => q.options));
    for (const q of a) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options[q.answer]).toBe(q.word.en);
    }
    expect(buildQuiz(base.words, base.seed + 1).map((q) => q.options)).not.toEqual(a.map((q) => q.options));
  });
});
