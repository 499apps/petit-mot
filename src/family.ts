import { addDays, dayKey, weekStart } from './dates';
import type { Profile, XpLog } from './types';
import { isLearned, type Deck } from './srs';

export interface Streak {
  days: number; // active days in the current streak
  teamDays: number; // days in the streak where everyone played
  playedToday: boolean;
  graceLeft: number; // missed days you can still skip before it breaks (as of today)
  alive: boolean;
}

const active = (log: XpLog, k: string, ids?: string[]) => {
  const d = log[k];
  if (!d) return false;
  return ids ? ids.every((id) => (d[id] ?? 0) > 0) : Object.values(d).some((x) => x > 0);
};

/**
 * Shared family streak: a day counts when anyone earns XP. Missing up to `grace` days in a row
 * doesn't break it (those days just don't count). Kind by design: no punishment, no nagging.
 */
export function familyStreak(log: XpLog, today: Date, grace: number, profileIds: string[] = []): Streak {
  const playedToday = active(log, dayKey(today));
  let days = 0, team = 0, gap = 0;
  let cursor = playedToday ? today : addDays(today, -1);
  // Count how many inactive days precede today (excluding today) to report remaining grace.
  let leadGap = 0;
  if (!playedToday) {
    while (leadGap <= grace && !active(log, dayKey(addDays(today, -1 - leadGap)))) leadGap++;
    if (leadGap > grace) return { days: 0, teamDays: 0, playedToday, graceLeft: grace, alive: false };
    cursor = addDays(today, -1 - leadGap);
  }
  for (let i = 0; i < 3650; i++) {
    const k = dayKey(cursor);
    if (active(log, k)) {
      days++;
      if (profileIds.length > 1 && active(log, k, profileIds)) team++;
      gap = 0;
    } else {
      gap++;
      if (gap > grace) break;
    }
    cursor = addDays(cursor, -1);
  }
  return { days, teamDays: team, playedToday, graceLeft: playedToday ? grace : Math.max(0, grace - leadGap), alive: days > 0 };
}

export interface Standing { profile: Profile; weekXp: number; totalXp: number; learned: number; todayXp: number }

export function leaderboard(profiles: Profile[], log: XpLog, decks: Record<string, Deck>, today: Date): Standing[] {
  const ws = weekStart(today).getTime();
  const tk = dayKey(today);
  return profiles
    .map((p) => {
      let weekXp = 0, totalXp = 0;
      for (const [k, byP] of Object.entries(log)) {
        const xp = byP[p.id] ?? 0;
        totalXp += xp;
        const [y, m, d] = k.split('-').map(Number);
        if (new Date(y, m - 1, d).getTime() >= ws) weekXp += xp;
      }
      const learned = Object.values(decks[p.id] ?? {}).filter(isLearned).length;
      return { profile: p, weekXp, totalXp, learned, todayXp: log[tk]?.[p.id] ?? 0 };
    })
    .sort((a, b) => b.weekXp - a.weekXp || b.totalXp - a.totalXp || a.profile.name.localeCompare(b.profile.name));
}

export const XP = {
  openCard: 1,
  got: 5,
  again: 2,
  huntFind: 10,
  huntRound: 10,
  challengeCorrect: 5,
  challengeWin: 10,
} as const;

export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐯', '🐨', '🐙', '🦄', '🐢', '🐧', '🦉', '🐝', '🚀', '⚽', '🎸', '🌟', '🥐', '🧀', '🗼', '🎨'];
