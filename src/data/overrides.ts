import type { CardDef } from '../engine/types';

/**
 * Hand-written abilities for cards whose printed text the compiler cannot
 * express. Each entry receives the partially-built definition and returns the
 * fields to merge over it.
 *
 * Keep this file ordered by card id. Every entry should say, in a comment, what
 * the card actually does — the printed text alone is not always unambiguous.
 */
export type Override = (base: CardDef) => Partial<CardDef>;

export const OVERRIDES: Record<string, Override> = {};
