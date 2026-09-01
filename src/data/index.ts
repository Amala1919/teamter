/**
 * Builds the card pool the engine plays with.
 *
 * Raw card records come from `generated/cards.json` (the official database,
 * normalised by `tools/build-cards.mjs`). Their printed text is compiled into
 * engine effects by `compile.ts`; `overrides.ts` supplies hand-written
 * abilities wherever the compiler cannot express a card.
 */
import { registerCards, _resetRegistry } from '../engine/registry';
import type { CardDef, Keyword } from '../engine/types';
import { compileCardText, inferTargeting, type CompileCtx } from './compile';
import { OVERRIDES } from './overrides';
import rawCards from './generated/cards.json';

export interface RawCard {
  id: string;
  officialId: number;
  name: string;
  nameJa: string;
  cardClass: CardDef['cardClass'];
  set: CardDef['set'];
  rarity: CardDef['rarity'];
  type: CardDef['type'];
  cost: number;
  text: string;
  textJa: string;
  evoText: string;
  evoTextJa: string;
  flavor: string;
  artSeed: number;
  traits?: CardDef['traits'];
  atk?: number;
  def?: number;
  evoAtk?: number;
  evoDef?: number;
  token?: boolean;
  creates?: string[];
}

export const RAW_CARDS = rawCards as unknown as RawCard[];

export interface BuildReport {
  total: number;
  fullyCompiled: number;
  overridden: number;
  vanilla: number;
  partial: { id: string; name: string; lines: string[] }[];
}

let cached: { cards: CardDef[]; report: BuildReport } | null = null;

function countdownFromText(text: string): number | undefined {
  const m = text.match(/Countdown \((\d+)\)/i);
  return m ? parseInt(m[1], 10) : undefined;
}

function buildAll(): { cards: CardDef[]; report: BuildReport } {
  const names = new Map<string, string>();
  for (const c of RAW_CARDS) if (!names.has(c.name)) names.set(c.name, c.id);

  const cards: CardDef[] = [];
  const report: BuildReport = {
    total: RAW_CARDS.length,
    fullyCompiled: 0,
    overridden: 0,
    vanilla: 0,
    partial: [],
  };

  for (const raw of RAW_CARDS) {
    const ctx: CompileCtx = { names, selfType: raw.type, selfId: raw.id };
    const compiled = compileCardText(raw.text, ctx);

    const def: CardDef = {
      id: raw.id,
      name: raw.name,
      nameJa: raw.nameJa || undefined,
      cardClass: raw.cardClass,
      set: raw.set,
      rarity: raw.rarity,
      type: raw.type,
      cost: raw.cost,
      text: raw.text,
      textJa: raw.textJa || undefined,
      evoText: raw.evoText || undefined,
      flavor: raw.flavor || undefined,
      artSeed: raw.artSeed,
    };
    if (raw.traits) def.traits = raw.traits;
    if (raw.type === 'follower') {
      def.atk = raw.atk ?? 0;
      def.def = raw.def ?? 0;
      def.evoAtk = raw.evoAtk ?? def.atk + 2;
      def.evoDef = raw.evoDef ?? def.def + 2;
    }
    if (raw.type === 'amulet') {
      const cd = countdownFromText(raw.text);
      if (cd !== undefined) def.countdown = cd;
    }
    if (raw.token) def.token = true;
    if (raw.creates) def.creates = raw.creates;

    const keywords: Keyword[] = [...compiled.keywords];
    def.abilities = compiled.abilities;
    def.auras = compiled.auras.filter((a) => a.costDelta !== 0 || a.atk || a.def || a.keywords);
    if (compiled.enhance.length > 0) def.enhance = compiled.enhance;
    if (compiled.spellboostCost) def.spellboostCost = compiled.spellboostCost;

    // The evolved side often adds a keyword the base side lacks.
    const evoOnly = compileCardText(raw.evoText, { ...ctx });
    const evoKeywords = evoOnly.keywords.filter((k) => !keywords.includes(k));
    if (evoKeywords.length > 0) def.evoKeywords = evoKeywords;
    for (const ab of evoOnly.abilities) {
      // Abilities present only on the evolved side are marked as such so the
      // base form does not fire them.
      const same = compiled.abilities.some(
        (b) => b.on === ab.on && JSON.stringify(b.effects) === JSON.stringify(ab.effects),
      );
      if (!same) def.abilities.push({ ...ab, evolvedOnly: true });
    }

    if (keywords.length > 0) def.keywords = keywords;

    const override = OVERRIDES[raw.id];
    if (override) {
      Object.assign(def, override(def));
      def.implemented = true;
      delete def.missingText;
      report.overridden++;
    } else if (compiled.unparsed.length > 0) {
      report.partial.push({ id: raw.id, name: raw.name, lines: compiled.unparsed });
      def.implemented = false;
      def.missingText = compiled.unparsed;
    } else if (raw.text.trim() === '') {
      report.vanilla++;
    } else {
      report.fullyCompiled++;
    }

    if (!def.targeting) {
      const t = inferTargeting(def.abilities ?? []);
      if (t) def.targeting = t;
    }
    if (def.implemented === undefined) def.implemented = true;

    cards.push(def);
  }

  return { cards, report };
}

/** Compiles (once) and registers every card. Safe to call repeatedly. */
export function loadCards(): BuildReport {
  if (!cached) cached = buildAll();
  _resetRegistry();
  registerCards(cached.cards);
  return cached.report;
}

export function builtCards(): CardDef[] {
  if (!cached) cached = buildAll();
  return cached.cards;
}
