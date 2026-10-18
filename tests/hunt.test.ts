import { describe, it, expect } from 'vitest';
import { createHunt, startTurn, find, hint, endTurn, results, winner, nextPlayer, timeLeft, POINTS } from '@/src/hunt';

const A = { id: 'a', name: 'Dad', avatar: '🐼' };
const B = { id: 'b', name: 'Léo', avatar: '🦊' };

describe('Word Hunt', () => {
  it('scores finds, ignores repeats and flags decoys', () => {
    const h = createHunt([A], 0);
    startTurn(h, ['chien.n', 'chat.n'], ['pomme.n'], 0);
    expect(find(h, 'pomme.n', 1)).toEqual({ kind: 'decoy' });
    expect(find(h, 'chien.n', 2)).toEqual({ kind: 'found', points: POINTS.find, done: false });
    expect(find(h, 'chien.n', 3)).toEqual({ kind: 'again' });
    const last = find(h, 'chat.n', 4);
    expect(last).toMatchObject({ kind: 'found', done: true });
    expect(h.phase).toBe('done');
    expect(results(h)[0].score).toBe(POINTS.find * 2 + POINTS.finishBonus);
  });

  it('hinted words are worth less', () => {
    const h = createHunt([A], 0);
    startTurn(h, ['chien.n', 'chat.n'], [], 0);
    expect(hint(h)).toBe('chien.n');
    expect(find(h, 'chien.n', 1)).toMatchObject({ points: POINTS.hinted });
  });

  it('pass-and-play: turns alternate, then a winner is picked', () => {
    const h = createHunt([A, B], 0);
    expect(nextPlayer(h)).toBe(A);
    startTurn(h, ['chien.n', 'chat.n'], [], 0);
    find(h, 'chien.n', 1);
    endTurn(h, 2);
    expect(h.phase).toBe('pass');
    expect(nextPlayer(h)).toBe(B);
    startTurn(h, ['maison.n', 'pomme.n'], [], 3);
    find(h, 'maison.n', 4);
    find(h, 'pomme.n', 5);
    expect(h.phase).toBe('done');
    expect(winner(h)).toBe(B);
    expect(results(h).map((r) => [r.player.id, r.place])).toEqual([['b', 1], ['a', 2]]);
  });

  it('ties share first place and have no single winner', () => {
    const h = createHunt([A, B], 0);
    startTurn(h, ['chien.n'], [], 0); find(h, 'chien.n', 1);
    startTurn(h, ['chat.n'], [], 2); find(h, 'chat.n', 3);
    expect(winner(h)).toBeNull();
    expect(results(h).map((r) => r.place)).toEqual([1, 1]);
  });

  it('timer: speed bonus, and finds after time-up do not count', () => {
    const h = createHunt([A], 60);
    startTurn(h, ['chien.n', 'chat.n'], [], 0);
    expect(timeLeft(h, 30_000)).toBe(30);
    expect(find(h, 'chien.n', 30_000)).toMatchObject({ kind: 'found', points: POINTS.find + Math.ceil(0.5 * POINTS.speedMax) });
    expect(find(h, 'chat.n', 61_000)).toEqual({ kind: 'over' });
    expect(h.phase).toBe('done');
  });

  it('rejects silly player counts', () => {
    expect(() => createHunt([], 0)).toThrow();
  });
});
