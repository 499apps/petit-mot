import { describe, it, expect } from 'vitest';
import { familyStreak, leaderboard } from '@/src/family';
import { addDays, dayKey, weekStart } from '@/src/dates';
import { review } from '@/src/srs';
import type { Profile, XpLog } from '@/src/types';

const today = new Date(2026, 9, 18, 12); // Sun 18 Oct 2026, local
const k = (n: number) => dayKey(addDays(today, n));
const logOf = (entries: [number, Record<string, number>][]): XpLog => Object.fromEntries(entries.map(([n, v]) => [k(n), v]));

describe('family streak', () => {
  it('counts consecutive days where anyone played', () => {
    const s = familyStreak(logOf([[0, { a: 5 }], [-1, { b: 3 }], [-2, { a: 1 }]]), today, 0);
    expect(s).toMatchObject({ days: 3, playedToday: true, alive: true });
  });

  it('grace days bridge short gaps without counting them', () => {
    const log = logOf([[0, { a: 5 }], [-3, { a: 1 }], [-4, { b: 2 }]]);
    expect(familyStreak(log, today, 2).days).toBe(3);
    expect(familyStreak(log, today, 1).days).toBe(1);
  });

  it('not playing yet today does not break it while grace remains', () => {
    const log = logOf([[-1, { a: 5 }], [-2, { a: 5 }]]);
    const s = familyStreak(log, today, 2);
    expect(s).toMatchObject({ days: 2, playedToday: false, alive: true, graceLeft: 2 });
    const later = familyStreak(log, addDays(today, 2), 2);
    expect(later).toMatchObject({ days: 2, alive: true, graceLeft: 0 }); // play today or it ends tomorrow
    expect(familyStreak(log, addDays(today, 3), 2)).toMatchObject({ days: 0, alive: false });
  });

  it('counts team days when everyone played', () => {
    const s = familyStreak(logOf([[0, { a: 1, b: 1 }], [-1, { a: 2 }], [-2, { a: 1, b: 4 }]]), today, 1, ['a', 'b']);
    expect(s.teamDays).toBe(2);
  });

  it('zero XP entries do not count', () => {
    expect(familyStreak(logOf([[0, { a: 0 }]]), today, 0).days).toBe(0);
  });
});

describe('leaderboard', () => {
  const P = (id: string, name: string): Profile => ({ id, name, avatar: '🦊', level: 1, createdAt: '' });
  it('ranks by this week, then all-time; counts learned words', () => {
    const ws = weekStart(today);
    const log: XpLog = { [dayKey(ws)]: { a: 10, b: 30 }, [dayKey(addDays(ws, -3))]: { a: 500 }, [dayKey(today)]: { a: 5 } };
    let c = review(undefined, 'good', new Date(2026, 8, 1));
    for (let i = 0; i < 4; i++) c = review(c, 'good', new Date(c.due));
    const board = leaderboard([P('a', 'Dad'), P('b', 'Léo')], log, { a: {}, b: { 'chien.n': c } }, today);
    expect(board.map((x) => x.profile.name)).toEqual(['Léo', 'Dad']);
    expect(board[0]).toMatchObject({ weekXp: 30, learned: 1 });
    expect(board[1]).toMatchObject({ weekXp: 15, totalXp: 515, todayXp: 5 });
  });
});
