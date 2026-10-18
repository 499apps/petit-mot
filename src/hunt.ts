/** Word Hunt rules, independent of the page so they can be tested. */
export interface HuntPlayer { id: string; name: string; avatar: string }
export interface Turn {
  player: HuntPlayer;
  targets: string[];
  decoys: string[];
  found: string[];
  hinted: string[];
  score: number;
  startedAt: number;
  endedAt: number | null;
}
export interface Hunt {
  players: HuntPlayer[];
  timer: number; // seconds; 0 = relaxed
  turns: Turn[];
  phase: 'playing' | 'pass' | 'done';
}
export type FindResult = { kind: 'found'; points: number; done: boolean } | { kind: 'decoy' } | { kind: 'again' } | { kind: 'over' };

export const POINTS = { find: 10, hinted: 5, speedMax: 5, finishBonus: 10 } as const;

export function createHunt(players: HuntPlayer[], timer: number): Hunt {
  if (players.length < 1 || players.length > 4) throw new Error('1 to 4 players');
  return { players, timer, turns: [], phase: 'pass' };
}

export const current = (h: Hunt): Turn | undefined => h.turns[h.turns.length - 1];
export const nextPlayer = (h: Hunt): HuntPlayer | undefined => h.players[h.turns.length];

export function startTurn(h: Hunt, targets: string[], decoys: string[], now: number): Turn {
  const player = nextPlayer(h);
  if (!player) throw new Error('no players left');
  const t: Turn = { player, targets, decoys, found: [], hinted: [], score: 0, startedAt: now, endedAt: null };
  h.turns.push(t);
  h.phase = 'playing';
  return t;
}

export function timeLeft(h: Hunt, now: number): number | null {
  const t = current(h);
  if (!h.timer || !t) return null;
  return Math.max(0, h.timer - Math.floor((now - t.startedAt) / 1000));
}

export function find(h: Hunt, wordId: string, now: number): FindResult {
  const t = current(h);
  if (!t || h.phase !== 'playing' || t.endedAt) return { kind: 'over' };
  if (h.timer && timeLeft(h, now) === 0) { endTurn(h, now); return { kind: 'over' }; }
  if (t.found.includes(wordId)) return { kind: 'again' };
  if (!t.targets.includes(wordId)) return { kind: 'decoy' };
  t.found.push(wordId);
  let points: number = t.hinted.includes(wordId) ? POINTS.hinted : POINTS.find;
  const left = timeLeft(h, now);
  if (left !== null) points += Math.ceil((left / h.timer) * POINTS.speedMax);
  t.score += points;
  const done = t.found.length === t.targets.length;
  if (done) { t.score += POINTS.finishBonus; endTurn(h, now); }
  return { kind: 'found', points, done };
}

/** Returns the word to point at, or null when nothing is left to hint. */
export function hint(h: Hunt): string | null {
  const t = current(h);
  if (!t || t.endedAt) return null;
  const id = t.targets.find((x) => !t.found.includes(x) && !t.hinted.includes(x)) ?? t.targets.find((x) => !t.found.includes(x));
  if (id && !t.hinted.includes(id)) t.hinted.push(id);
  return id ?? null;
}

export function endTurn(h: Hunt, now: number): void {
  const t = current(h);
  if (!t || t.endedAt) return;
  t.endedAt = now;
  h.phase = h.turns.length < h.players.length ? 'pass' : 'done';
}

export interface Ranking { player: HuntPlayer; score: number; found: number; total: number; place: number }
export function results(h: Hunt): Ranking[] {
  const rows = h.turns.map((t) => ({ player: t.player, score: t.score, found: t.found.length, total: t.targets.length, place: 0 }));
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.place = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].place : i + 1; });
  return rows;
}
export function winner(h: Hunt): HuntPlayer | null {
  const r = results(h);
  if (r.length < 2) return null;
  return r[0].score > r[1].score ? r[0].player : null; // tie = everyone wins
}
