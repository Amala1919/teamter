/**
 * Visual constants for the whole client.
 *
 * Values follow docs/research/VISUAL_RESEARCH.md — the class hexes and timings
 * there are reconstructions, not published data, so treat this file as the
 * single place to retune the look rather than sprinkling colours through the
 * renderer.
 */
import type { ClassId, Rarity } from '../engine/types';

export interface ClassTheme {
  /** Main identity colour: gem, rune, drop-zone glow. */
  primary: string;
  /** Deep shade used for frame washes and gradient shadows. */
  deep: string;
  /** Bright accent for rim light and particles. */
  accent: string;
  label: string;
  labelJa: string;
}

export const CLASS_THEME: Record<ClassId, ClassTheme> = {
  forest: { primary: '#4CA64C', deep: '#1E5B2E', accent: '#8FD44A', label: 'Forestcraft', labelJa: 'エルフ' },
  sword: { primary: '#E8C24A', deep: '#A87A18', accent: '#FFEBAE', label: 'Swordcraft', labelJa: 'ロイヤル' },
  rune: { primary: '#4A7BE8', deep: '#2A2F8A', accent: '#9A5CE0', label: 'Runecraft', labelJa: 'ウィッチ' },
  dragon: { primary: '#E88B2A', deep: '#A03B10', accent: '#FFC46B', label: 'Dragoncraft', labelJa: 'ドラゴン' },
  shadow: { primary: '#8B5CC7', deep: '#2B1240', accent: '#C79BFF', label: 'Shadowcraft', labelJa: 'ネクロマンサー' },
  blood: { primary: '#C8203C', deep: '#5A0A18', accent: '#FF6B7A', label: 'Bloodcraft', labelJa: 'ヴァンパイア' },
  haven: { primary: '#F0E6C8', deep: '#C9A227', accent: '#FFFFFF', label: 'Havencraft', labelJa: 'ビショップ' },
  neutral: { primary: '#B8BCC4', deep: '#4A4F58', accent: '#E8EBEF', label: 'Neutral', labelJa: 'ニュートラル' },
};

export interface RarityTheme {
  gem: string;
  gemDeep: string;
  /** Colour of the frame's metallic highlight. */
  metal: string;
  metalDeep: string;
  /** Strength of the frame's ornamentation, 0..1. */
  ornament: number;
  label: string;
}

export const RARITY_THEME: Record<Rarity, RarityTheme> = {
  bronze: { gem: '#C88A54', gemDeep: '#6E4522', metal: '#9E8468', metalDeep: '#4A3B2C', ornament: 0.15, label: 'Bronze' },
  silver: { gem: '#D6DEE8', gemDeep: '#6E7A8A', metal: '#B9C3D0', metalDeep: '#4E5766', ornament: 0.4, label: 'Silver' },
  gold: { gem: '#FFD65C', gemDeep: '#9A6E10', metal: '#E3B75A', metalDeep: '#7A5A18', ornament: 0.7, label: 'Gold' },
  legendary: { gem: '#8FE3FF', gemDeep: '#1D5C86', metal: '#F0D9A0', metalDeep: '#8A6A2A', ornament: 1, label: 'Legendary' },
};

/** Chrome shared by every screen: the gold-on-navy Shadowverse UI language. */
export const UI = {
  bg: '#080B12',
  bgDeep: '#04060A',
  panel: '#111825',
  panelEdge: '#26324A',
  gold: '#D8B865',
  goldBright: '#F5E4A8',
  goldDeep: '#7A5F22',
  text: '#F2EEE4',
  textDim: '#A6AFBF',
  textDisabled: '#6B7386',
  attack: '#FF8A3D',
  attackDeep: '#8A3A08',
  defense: '#63D6A8',
  defenseDeep: '#125A42',
  cost: '#6FB8FF',
  costDeep: '#123A6E',
  damage: '#FF4747',
  heal: '#7BE86A',
  evolve: '#FF4A3D',
  evolveGold: '#FFD86B',
};

/** Card geometry, in texture pixels. The 0.715 aspect matches the original. */
export const CARD = {
  W: 512,
  H: 716,
  /** Rounded-corner radius of the outer frame. */
  RADIUS: 26,
  /** Art window inset from each edge. */
  ART: { x: 30, y: 40, w: 452, h: 430 },
  /** The band across the art that carries the card name. */
  NAME_BAND: { x: 44, y: 372, w: 424, h: 62 },
  /** Rules-text box below the art. */
  TEXT_BOX: { x: 42, y: 452, w: 428, h: 190 },
} as const;

/** Animation timings in milliseconds, from the reference reconstruction. */
export const TIMING = {
  draw: 420,
  play: 380,
  summon: 520,
  spellCast: 700,
  attackLunge: 220,
  hitStop: 60,
  attackReturn: 180,
  evolve: 1200,
  damagePopup: 700,
  destroy: 520,
  turnBanner: 1100,
  cardHover: 140,
  cardFocus: 180,
  handReturn: 280,
} as const;

export const FONT = {
  display: '"Cinzel", "Noto Serif JP", Georgia, serif',
  displayJa: '"Noto Serif JP", "Cinzel", serif',
  ui: '"Noto Sans JP", system-ui, -apple-system, sans-serif',
  numeral: '"Cinzel", Georgia, serif',
} as const;
