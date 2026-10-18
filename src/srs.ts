import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';
import type { Word } from './types';

/** Stored form of a card: dates as ISO strings so it fits chrome.storage. */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: string;
}
export type Deck = Record<string, StoredCard>; // wordId -> card

export type Answer = 'again' | 'good';
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9, maximum_interval: 365 }));

export function toStored(c: Card): StoredCard {
  return {
    due: c.due.toISOString(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days, learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state,
    ...(c.last_review ? { last_review: c.last_review.toISOString() } : {}),
  };
}
export function fromStored(s: StoredCard): Card {
  return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined };
}

export function newCard(now: Date): StoredCard {
  return toStored(createEmptyCard(now));
}

/** Schedules the next review. "Got it" = Good, "Again" = Again. */
export function review(card: StoredCard | undefined, answer: Answer, now: Date): StoredCard {
  const c = card ? fromStored(card) : createEmptyCard(now);
  const { card: next } = scheduler.next(c, now, answer === 'good' ? Rating.Good : Rating.Again);
  return toStored(next);
}

export const isDue = (c: StoredCard, now: Date) => new Date(c.due).getTime() <= now.getTime();
/** A word counts as "learned" once it has graduated to review with a few days of stability. */
export const isLearned = (c: StoredCard) => c.state === State.Review && c.stability >= 3;

export function dueIds(deck: Deck, now: Date): string[] {
  return Object.entries(deck)
    .filter(([, c]) => isDue(c, now))
    .sort((a, b) => new Date(a[1].due).getTime() - new Date(b[1].due).getTime())
    .map(([id]) => id);
}

/**
 * Swap priority for a learner: due reviews first, then words still being learned,
 * then fresh words at their level (most useful first), then already-solid words.
 */
export function priorityFor(deck: Deck, level: number, now: Date): (w: Word) => number {
  return (w) => {
    const c = deck[w.id];
    if (c) {
      if (isDue(c, now)) return 100;
      if (c.state !== State.Review) return 60;
      return 10;
    }
    if (w.level <= level) return 50 - w.level;
    if (w.level === level + 1) return 20;
    return -Infinity;
  };
}

export { State };
