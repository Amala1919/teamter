/**
 * Interface language.
 *
 * The game is Japanese by default, which is what the original shipped as and
 * what the card database is authored in: names, rules text and flavour all come
 * from the Japanese side of the official card data, so the interface matches
 * them rather than sitting in a different language from the cards.
 *
 * English is kept reachable with `?lang=en` — the card data carries both, and
 * having the second language forces the layout to stay honest about text that
 * is twice as wide.
 */

export type Lang = 'ja' | 'en';

function detect(): Lang {
  if (typeof location === 'undefined') return 'ja';
  const q = new URLSearchParams(location.search).get('lang');
  return q === 'en' ? 'en' : 'ja';
}

export const LANG: Lang = detect();
export const isJa = LANG === 'ja';

/** Every piece of chrome text, Japanese first. */
const STRINGS = {
  // --- menu ---
  'menu.title': ['Teamter', 'Teamter'],
  'menu.subtitle': ['シャドウバース 個人研究版', 'A study of Shadowverse'],
  'menu.pack': ['パックを開く', 'Open a pack'],
  'menu.collection': ['カード一覧', 'Collection'],
  'menu.decks': ['デッキ', 'Your decks'],
  'menu.newDeck': ['新規デッキ', 'New deck'],
  'menu.starterDeck': ['{cls} スターター', '{cls} starter'],
  'menu.noDecks': ['デッキがありません。', 'No decks yet.'],
  'menu.edit': ['編集', 'Edit'],
  'menu.createFirst': ['まずはデッキを作成してください。', 'Create a deck to begin.'],
  'menu.opponent': ['対戦相手', 'Opponent'],
  'menu.battle': ['対戦開始', 'Battle'],
  'menu.illegal': ['このデッキはまだ使用できません。', 'Deck is not legal yet.'],
  'menu.copy': ['複製', 'Copy'],
  'menu.tagline': ['スタンダード〜ワンダーランド・ドリームズ', 'Standard → Wonderland Dreams'],
  'menu.newDeckBtn': ['＋ 新規デッキ', '+ New deck'],
  'menu.incomplete': [' · 未完成', ' · incomplete'],
  'menu.partialNote': [
    'このデッキには未実装テキストのカードが{n}枚あります。',
    '{n} cards in this deck are not fully implemented.',
  ],
  'menu.delete': ['削除', 'Delete'],

  // --- collection ---
  'collection.title': ['カード一覧', 'Collection'],
  'collection.hint': [
    '右クリック、または長押しでカード詳細',
    'Right-click or long-press a card for details',
  ],
  'collection.back': ['← 戻る', '← Back'],
  'collection.count': ['{n} / {total}', '{n} of {total}'],
  'collection.partialCount': [' · 未実装 {n}', ' · {n} partial'],

  // --- deck builder ---
  'deck.title': ['デッキ', 'Deck'],
  'deck.empty': ['カードをクリックして追加します。', 'Click cards to add them.'],
  'deck.partial': ['一部未実装', 'PARTIAL'],
  'deck.save': ['保存', 'Save'],
  'deck.saveBack': ['← 保存して戻る', '← Save & back'],
  'deck.addMore': ['あと{n}枚', 'Add {n} more cards.'],
  'deck.removeSome': ['{n}枚多い', 'Remove {n}.'],
  'deck.ready': ['使用できます', 'Ready to play'],
  'deck.namePlaceholder': ['デッキ名', 'Deck name'],
  'deck.count': ['{n} / {max}', '{n} / {max}'],
  'deck.full': [' — 完成', ' — full'],
  'deck.legal': ['使用可能なデッキです。', 'Legal deck — ready to play.'],
  'deck.partialCount': ['未実装テキストのカードが{n}枚あります。', '{n} cards not fully implemented.'],
  'deck.removeOne': ['{name} — クリックで1枚減らす', '{name} — click to remove one'],

  // --- filters ---
  'filter.class': ['クラス', 'Class'],
  'filter.cost': ['コスト', 'Cost'],
  'filter.type': ['種類', 'Type'],
  'filter.rarity': ['レアリティ', 'Rarity'],
  'filter.set': ['カードパック', 'Set'],
  'filter.all': ['すべて', 'All'],
  'filter.implemented': ['実装済みのみ', 'Fully implemented'],
  'filter.implementedHint': [
    'テキストがまだ完全に実装されていないカードを隠します',
    'Hide cards whose printed text is not fully implemented yet',
  ],
  'filter.search': ['カード名で検索', 'Search by name'],
  'grid.noMatch': ['条件に合うカードがありません。', 'No cards match these filters.'],
  'grid.partial': ['一部未実装', 'Partial'],

  // --- card detail ---
  'detail.baseForm': ['進化前を表示', 'Base form'],
  'detail.evolvedForm': ['進化後を表示', 'Evolved form'],
  'detail.close': ['閉じる', 'Close'],
  'detail.evolved': ['進化時', 'Evolved'],
  'detail.creates': ['生成:', 'Creates:'],
  'detail.countdown': ['カウントダウン {n}', 'Countdown {n}'],
  'detail.missing': [
    '次のテキストはまだ動作しません:',
    'Not implemented yet:',
  ],
  'detail.noText': ['能力を持たない。', 'No abilities.'],
  'detail.stats': ['{atk}/{def}', '{atk}/{def}'],
  'detail.evoStats': ['進化後 {atk}/{def}', 'evolved {atk}/{def}'],
  'detail.pp': ['{n} PP', '{n} PP'],
  'detail.missingLead': [
    'このカードのテキストはまだ完全には実装されていません。次の行は動作しません（原文）:',
    'Not fully implemented yet. These lines have no engine behaviour:',
  ],

  // --- pack opening ---
  'pack.title': ['カードパック', 'Card Pack'],
  'pack.hint': ['パックをタップして開封', 'Tap the pack to open it'],
  'pack.allSets': ['全カードパック', 'All sets'],
  'pack.revealAll': ['すべてめくる', 'Reveal all'],
  'pack.again': ['もう一度開く', 'Open another'],
  'pack.done': ['終了', 'Done'],
  'pack.close': ['閉じる', 'Close'],
  'pack.results': ['獲得カード', 'Your Cards'],
  'pack.resultsHint': [
    'カードをタップでめくり、もう一度タップで詳細',
    'Tap a card to turn it over, again for details',
  ],
  'pack.label': ['CARD PACK', 'CARD PACK'],

  // --- mulligan ---
  'mull.title': ['マリガン', 'Redraw'],
  'mull.hint': [
    '引き直したいカードをタップしてください。引き直しは1回だけです。',
    'Tap any card you would rather not keep. You may redraw once.',
  ],
  'mull.mark': ['引き直す', 'Redraw'],
  'mull.keepAll': ['そのまま', 'Keep all'],
  'mull.confirm': ['決定', 'Confirm'],
  'mull.keeping': ['手札をそのまま使います。', 'Keeping your whole hand.'],
  'mull.redrawing': ['{n}枚を引き直します。', 'Redrawing {n} cards.'],

  // --- battle HUD ---
  'hud.endTurn': ['ターン終了', 'End Turn'],
  'hud.opponentTurn': ['相手のターン…', 'Opponent…'],
  'hud.log': ['ログ', 'Log'],
  'hud.concede': ['降参', 'Concede'],
  'hud.backToMenu': ['メニューへ戻る', 'Back to menu'],
  'hud.deck': ['デッキ', 'Deck'],
  'hud.hand': ['手札', 'Hand'],
  'hud.turnLine': ['ターン {n} — {who}', 'Turn {n} — {who}'],
  'hud.yourMove': ['あなたの番', 'your move'],
  'hud.theirMove': ['相手の番', 'opponent'],
  'hud.yourTurn': ['あなたのターン', 'Your Turn'],
  'hud.enemyTurn': ['相手のターン', "Opponent's Turn"],
  'hud.win': ['勝利', 'Victory'],
  'hud.lose': ['敗北', 'Defeat'],
  'hud.draw': ['引き分け', 'Draw'],
  'hud.wonBecause': ['相手のリーダーを倒した。', 'Your leader stood.'],
  'hud.lostBecause': ['自分のリーダーが倒れた。', 'Your leader fell.'],
  'hud.conceded': ['降参しました。', 'You conceded.'],
  'hud.pp': ['PP', 'PP'],
  'hud.ep': ['EP', 'EP'],

  // --- battle actions ---
  'battle.play': ['プレイ · {n}', 'Play · {n}'],
  'battle.enhance': ['エンハンス · {n}', 'Enhance · {n}'],
  'battle.evolve': ['進化', 'Evolve'],
  'battle.you': ['あなた', 'You'],
  'battle.foe': ['相手', 'Opponent'],
  'battle.played': ['{who}が<b>{card}</b>をプレイ', '{who} played <b>{card}</b>'],
  'battle.inspect': ['カード詳細', 'Card details'],
  'battle.inspectHint': [
    'カードをタップで詳細（相手の場も確認できます）',
    'Tap any card to read it — including the opponent’s',
  ],

  // --- card inspector ---
  'inspect.title': ['カード情報', 'Card'],
  'inspect.onBoard': ['場の状態', 'On the board'],
  'inspect.evolvedNow': ['進化済み', 'Evolved'],
  'inspect.countdownNow': ['カウントダウン残り {n}', 'Countdown {n} left'],
  'inspect.stats': ['{atk}/{def}', '{atk}/{def}'],
  'inspect.owner.you': ['自分', 'Yours'],
  'inspect.owner.foe': ['相手', "Opponent's"],
  'inspect.close': ['閉じる', 'Close'],

  // --- card types and misc labels ---
  'type.follower': ['フォロワー', 'Follower'],
  'type.spell': ['スペル', 'Spell'],
  'type.amulet': ['アミュレット', 'Amulet'],
  'rarity.bronze': ['ブロンズ', 'Bronze'],
  'rarity.silver': ['シルバー', 'Silver'],
  'rarity.gold': ['ゴールド', 'Gold'],
  'rarity.legendary': ['レジェンド', 'Legendary'],
  'set.basic': ['ベーシック', 'Basic'],
  'set.standard': ['スタンダード', 'Standard'],
  'set.darkness': ['ダークネス・エボルヴ', 'Darkness Evolved'],
  'set.bahamut': ['バハムート降臨', 'Rise of Bahamut'],
  'set.tempest': ['神々の騒嵐', 'Tempest of the Gods'],
  'set.wonderland': ['ワンダーランド・ドリームズ', 'Wonderland Dreams'],
  // --- deck validation ---
  'deckerr.size': [
    'デッキはちょうど{max}枚である必要があります（現在{n}枚）。',
    'A deck must contain exactly {max} cards (has {n}).',
  ],
  'deckerr.unknown': ['不明なカード: {id}', 'Unknown card: {id}'],
  'deckerr.token': [
    '{name}はトークンのためデッキに入れられません。',
    '{name} is a token and cannot be added to a deck.',
  ],
  'deckerr.class': ['{name}は{cls}のカードではありません。', '{name} is not a {cls} card.'],
  'deckerr.copies': [
    '{name}: {n}枚（同名カードは{max}枚まで）。',
    '{name}: {n} copies (limit {max}).',
  ],

  'credits.art': [
    'カードの主題イラストは Game Icons（game-icons.net, CC BY 3.0）を使用',
    'Card subjects from Game Icons (game-icons.net), CC BY 3.0',
  ],
} as const satisfies Record<string, readonly [string, string]>;

export type StringKey = keyof typeof STRINGS;

/** Every key, for the test that checks both languages are filled in. */
export const STRING_KEYS = Object.keys(STRINGS) as StringKey[];

/**
 * Looks up `key` in the current language, substituting `{name}` placeholders.
 * Missing keys return the key itself, which is loud enough to catch in review
 * without breaking the screen.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key] as readonly [string, string] | undefined;
  let s = entry ? entry[LANG === 'ja' ? 0 : 1] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** A class's name in the interface language. */
export function className(cls: { label: string; labelJa: string }): string {
  return isJa ? cls.labelJa : cls.label;
}

/** The card's name in the interface language. */
export function cardName(card: { name: string; nameJa?: string }): string {
  return (isJa && card.nameJa) || card.name;
}

/** The card's printed rules text in the interface language. */
export function cardText(card: { text: string; textJa?: string }): string {
  return (isJa && card.textJa) || card.text;
}

/** The card's evolved-form rules text in the interface language. */
export function cardEvoText(card: { evoText?: string; evoTextJa?: string }): string {
  return ((isJa && card.evoTextJa) || card.evoText) ?? '';
}

/** The card's flavour text in the interface language. */
export function cardFlavor(card: { flavor?: string; flavorJa?: string }): string {
  return ((isJa && card.flavorJa) || card.flavor) ?? '';
}
