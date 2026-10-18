import type { Form } from '../words';
import type { Word } from '../types';

const DETERMINERS = new Set([
  'the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'some', 'any',
  'every', 'each', 'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'many', 'few',
  'several', 'another', 'other', 'lots', 'of', "dad's", "mom's",
]);
const VERB_LEAD = new Set([
  'to', 'i', 'you', 'we', 'they', 'can', 'could', 'will', 'would', 'should', 'must', 'might', 'may', "don't", "didn't",
  "can't", "won't", "let's", 'lets', 'please', 'not', 'never', 'always', 'often', 'usually', "i'll", "we'll", "you'll", "they'll",
]);
const ADJ_LEAD = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'very', 'so', 'too', 'really', 'quite', 'more', 'most', 'the', 'a', 'an', 'feel', 'feels', 'looks', 'seems', "it's", "that's", "i'm", "you're", "we're", "they're"]);

/**
 * Decides whether a word may be swapped given the word right before it.
 * Verbs always need a lead-in ("to play", "I play"); words that are often another part
 * of speech (ctx) need one too. Everything else is fine anywhere.
 */
export function contextOk(word: Word, form: Form, prev: string | null): boolean {
  const p = prev?.toLowerCase() ?? null;
  if (word.pos === 'v') return p !== null && VERB_LEAD.has(p);
  if (!word.ctx) return true;
  if (p === null) return false;
  if (word.pos === 'n') return DETERMINERS.has(p) || (form === 'plural' && /^(\d+|many|few|some|all|these|those)$/.test(p));
  return ADJ_LEAD.has(p);
}
