import { describe, it, expect } from 'vitest';
import { review, newCard, dueIds, isDue, isLearned, priorityFor, fromStored, toStored, State, type Deck } from '@/src/srs';
import { BY_ID } from '@/src/words';

const t0 = new Date('2026-10-18T16:00:00Z');
const days = (n: number) => new Date(t0.getTime() + n * 86_400_000);

describe('FSRS scheduling', () => {
  it('a new word rated "Got it" is scheduled later than "Again"', () => {
    const good = review(undefined, 'good', t0);
    const again = review(undefined, 'again', t0);
    expect(new Date(good.due).getTime()).toBeGreaterThan(new Date(again.due).getTime());
    expect(good.reps).toBe(1);
  });

  it('repeated "Got it" grows the interval', () => {
    let c = review(undefined, 'good', t0);
    const gaps: number[] = [];
    let now = t0;
    for (let i = 0; i < 5; i++) {
      now = new Date(c.due);
      const next = review(c, 'good', now);
      gaps.push(new Date(next.due).getTime() - now.getTime());
      c = next;
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    expect(c.state).toBe(State.Review);
    expect(isLearned(c)).toBe(true);
  });

  it('"Again" on a review card counts a lapse and brings it back soon', () => {
    let c = review(undefined, 'good', t0);
    for (let i = 0; i < 4; i++) c = review(c, 'good', new Date(c.due));
    const at = new Date(c.due);
    const lapsed = review(c, 'again', at);
    expect(lapsed.lapses).toBe(1);
    expect(new Date(lapsed.due).getTime() - at.getTime()).toBeLessThan(86_400_000);
  });

  it('is deterministic (no fuzz) so tests and family devices agree', () => {
    expect(review(undefined, 'good', t0)).toEqual(review(undefined, 'good', t0));
  });

  it('round-trips through storage form', () => {
    const c = review(undefined, 'good', t0);
    expect(toStored(fromStored(c))).toEqual(c);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it('lists due words, oldest first', () => {
    const deck: Deck = {
      'a.n': { ...newCard(t0), due: days(-2).toISOString() },
      'b.n': { ...newCard(t0), due: days(3).toISOString() },
      'c.n': { ...newCard(t0), due: days(-5).toISOString() },
    };
    expect(dueIds(deck, t0)).toEqual(['c.n', 'a.n']);
    expect(isDue(deck['b.n'], days(4))).toBe(true);
  });

  it('swap priority: due > learning > new at level > solid; above-level words excluded', () => {
    const chien = BY_ID.get('chien.n')!;
    const hard = [...BY_ID.values()].find((w) => w.level === 4)!;
    const fresh = [...BY_ID.values()].find((w) => w.level === 1 && w.id !== 'chien.n')!;
    const learningCard = review(undefined, 'again', t0);
    const deck: Deck = { [chien.id]: { ...learningCard, due: days(-1).toISOString() } };
    const p = priorityFor(deck, 1, t0);
    expect(p(chien)).toBeGreaterThan(p(fresh));
    expect(p(hard)).toBe(-Infinity);
    deck[chien.id] = { ...learningCard, due: days(2).toISOString() };
    expect(priorityFor(deck, 1, t0)(chien)).toBeGreaterThan(p(fresh));
  });
});
