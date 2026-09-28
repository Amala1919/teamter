import type { AssetLicense } from '../project/types'

/**
 * ゆっくり実況・ずんだもん実況でよく使われる、フリーの BGM・効果音の配布サイトと、その利用条件の控え。
 *
 * 音源そのものはアプリに同梱しない。どのサイトも「素材の再配布」を禁じており、アプリへの同梱は再配布にあたるため。
 * 利用者が各サイトから入手した素材を取り込むときに入手元として選ぶと、入手元・クレジットの要否・表記が埋まり、
 * 必要な表記が概要欄の下書きに自動で入る(credits.ts)。
 *
 * 利用条件は変わることがあるので、確認した日を持ち、画面から各サイトの規約を開けるようにする。
 * 最終的な確認は投稿者が行う(REQUIREMENTS.md L-3)。
 */

export type FreeSourceKind = 'bgm' | 'se'

/** required: 表記が必要 / optional: 任意(書くと喜ばれる) / per-item: 素材ごとに違う */
export type FreeSourceCredit = 'required' | 'optional' | 'per-item'

export interface FreeSource {
  id: string
  name: string
  url: string
  /** 利用規約のページ。 */
  termsUrl: string
  kinds: FreeSourceKind[]
  credit: FreeSourceCredit
  /** 概要欄に書く表記の例。{title} は素材名(ファイル名)に置き換える。 */
  creditText: string
  /** 得意な曲調など、選ぶときの手がかり。 */
  genres: string[]
  /** 利用上の注意(収益化・禁止事項など)。 */
  notes: string[]
  /** 戦争・歴史もの(HoI4 など)の重い雰囲気に合う曲が多い。 */
  epic?: boolean
  /** ダウンロードしたファイル名から、このサイトの素材だと分かる形。 */
  filePattern?: RegExp
}

/** 利用条件を確認した日。 */
export const FREE_SOURCES_CHECKED_AT = '2026-09-28'

export const FREE_SOURCES: readonly FreeSource[] = [
  {
    id: 'dova',
    name: 'DOVA-SYNDROME',
    url: 'https://dova-s.jp/',
    termsUrl: 'https://dova-s.jp/help/articles/license-usage/',
    kinds: ['bgm', 'se'],
    credit: 'optional',
    creditText: 'BGM: DOVA-SYNDROME「{title}」',
    genres: ['日常・茶番', 'ほのぼの', '戦闘', 'ホラー', 'オーケストラ'],
    notes: [
      '商用・収益化 OK。クレジットは任意だが、できれば記載してほしいとのこと',
      '作曲者ごとに独自の条件を付けている曲があるので、曲のページも確認する',
      '第三者が不正に著作権を申し立てる例がある。心当たりの無い申し立ては、公式の案内に沿って異議を申し立てる'
    ]
  },
  {
    id: 'maoudamashii',
    name: '魔王魂',
    url: 'https://maou.audio/',
    termsUrl: 'https://maou.audio/rule/',
    kinds: ['bgm', 'se'],
    credit: 'required',
    creditText: '音楽: 魔王魂',
    genres: ['オーケストラ', 'ファンタジー', '戦闘', 'ロック'],
    notes: ['クレジット表記が必要(動画内か概要欄)', '商用・収益化 OK', '自作と偽る・再配布は禁止'],
    epic: true,
    filePattern: /^maou_/i
  },
  {
    id: 'amacha',
    name: '甘茶の音楽工房',
    url: 'https://amachamusic.chagasi.com/',
    termsUrl: 'https://amachamusic.chagasi.com/terms.html',
    kinds: ['bgm'],
    credit: 'optional',
    creditText: '音楽: 甘茶の音楽工房',
    genres: ['ほのぼの', 'コミカル', '日常'],
    notes: ['商用・収益化 OK。クレジットは任意(サイト名・作曲者名・URL のどれかで可)', '音楽が主役の動画(作業用 BGM など)は、YouTube で著作権表示が入ることがある'],
    filePattern: /^amacha/i
  },
  {
    id: 'musmus',
    name: 'MusMus',
    url: 'https://musmus.main.jp/',
    termsUrl: 'https://musmus.main.jp/info.html',
    kinds: ['bgm', 'se'],
    credit: 'required',
    creditText: 'BGM: MusMus',
    genres: ['ゲーム風', 'シリアス', 'ほのぼの'],
    notes: ['無料で使うには著作権表示(クレジット)が必要', '収益化チャンネルで使える'],
    filePattern: /^musmus/i
  },
  {
    id: 'peritune',
    name: 'PeriTune',
    url: 'https://peritune.com/',
    termsUrl: 'https://peritune.com/about/',
    kinds: ['bgm'],
    credit: 'optional',
    creditText: 'Music: PeriTune',
    genres: ['壮大・エピック', '戦闘', 'ファンタジー', '和風'],
    notes: ['クレジットは任意(できれば記載)', 'YouTube の Content ID への登録は禁止', '2026年3月以降の新曲は独自の規約。曲のページで確認する'],
    epic: true,
    filePattern: /^peritune/i
  },
  {
    id: 'hmix',
    name: 'H/MIX GALLERY',
    url: 'https://www.hmix.net/',
    termsUrl: 'https://www.hmix.net/terms.html',
    kinds: ['bgm'],
    credit: 'optional',
    creditText: '音楽: H/MIX GALLERY',
    genres: ['シネマティック', 'ファンタジー', '壮大・エピック'],
    notes: ['個人・YouTube 収益化は無料。クレジットは任意', '企業の商用利用などは有料'],
    epic: true
  },
  {
    id: 'noiseless',
    name: '騒音のない世界',
    url: 'https://noiselessworld.net/',
    termsUrl: 'https://noiselessworld.net/terms',
    kinds: ['bgm'],
    credit: 'optional',
    creditText: 'BGM: 騒音のない世界',
    genres: ['日常', 'ほのぼの', 'チル'],
    notes: ['商用 OK。クレジット・利用報告は任意', '再配布・販売、楽曲が主役のコンテンツは禁止']
  },
  {
    id: 'otologic',
    name: 'OtoLogic',
    url: 'https://otologic.jp/',
    termsUrl: 'https://otologic.jp/free/license.html',
    kinds: ['bgm', 'se'],
    credit: 'required',
    creditText: '使用した音素材: OtoLogic(https://otologic.jp)',
    genres: ['ジングル', '効果音', '短い BGM'],
    notes: ['CC BY 4.0。OtoLogic の素材だと分かる表記が必要(URL か「CC BY 4.0」の併記が望ましい)']
  },
  {
    id: 'soundeffect-lab',
    name: '効果音ラボ',
    url: 'https://soundeffect-lab.info/',
    termsUrl: 'https://soundeffect-lab.info/agreement/',
    kinds: ['se'],
    credit: 'optional',
    creditText: '効果音: 効果音ラボ',
    genres: ['効果音全般', 'アニメ・演出', 'ボタン・システム音'],
    notes: ['商用・収益化 OK。報告・リンク・クレジットは不要(任意)', '再配布と、YouTube の Content ID への登録は禁止']
  },
  {
    id: 'pocket-se',
    name: 'ポケットサウンド',
    url: 'https://pocket-se.info/',
    termsUrl: 'https://pocket-se.info/rules/',
    kinds: ['se', 'bgm'],
    credit: 'required',
    creditText: '効果音: ポケットサウンド(https://pocket-se.info/)',
    genres: ['効果音全般', '環境音'],
    notes: ['無料で使うにはクレジット表記が必要(表記しない場合は有料)']
  },
  {
    id: 'springin',
    name: "Springin' Sound Stock",
    url: 'https://www.springin.org/sound-stock/',
    termsUrl: 'https://www.springin.org/sound-stock/guideline/',
    kinds: ['se', 'bgm'],
    credit: 'optional',
    creditText: "効果音: Springin' Sound Stock",
    genres: ['ジングル', '効果音', '10秒 BGM'],
    notes: ['商用・収益化 OK。クレジットは原則不要(求められたら従う)', '素材集としての動画投稿と、Content ID への登録は禁止']
  },
  {
    id: 'on-jin',
    name: 'On-Jin ～音人～',
    url: 'https://on-jin.com/',
    termsUrl: 'https://on-jin.com/kiyaku.php',
    kinds: ['se'],
    credit: 'optional',
    creditText: '効果音: On-Jin ～音人～',
    genres: ['効果音全般', '戦闘', '環境音'],
    notes: ['個人の利用は連絡不要・クレジット任意', '法人・商用事業での利用は事前の連絡が必要', '再配布・転売は禁止']
  },
  {
    id: 'niconi-commons',
    name: 'ニコニ・コモンズ',
    url: 'https://commons.nicovideo.jp/',
    termsUrl: 'https://commons.nicovideo.jp/',
    kinds: ['bgm', 'se'],
    credit: 'per-item',
    creditText: '{title}(ニコニ・コモンズ)',
    genres: ['ゲーム風', 'ミーム', 'ゆっくり向け素材'],
    notes: [
      '作品ごとに条件が違う。検索で「インターネット全体」「営利利用可」を選び、YouTube で使えるものか確かめる',
      '表記は作品ページの指定に従う(作品ID nc〜 を書くことが多い)'
    ],
    filePattern: /(^|[^a-z0-9])nc\d{4,}(?!\d)/i
  },
  {
    id: 'youtube-audio-library',
    name: 'YouTube オーディオ ライブラリ',
    url: 'https://studio.youtube.com/',
    termsUrl: 'https://support.google.com/youtube/answer/3376882',
    kinds: ['bgm', 'se'],
    credit: 'per-item',
    creditText: '{title}(YouTube オーディオ ライブラリ)',
    genres: ['洋楽風', 'シネマティック', '効果音'],
    notes: ['曲ごとに表記が必要なものがある。ライブラリに出る表記文をそのまま使う', 'YouTube 以外で使えるかは曲ごとに確認する']
  }
]

export function freeSource(id: string | undefined): FreeSource | undefined {
  return id === undefined ? undefined : FREE_SOURCES.find((source) => source.id === id)
}

/** ファイル名から、どのサイトの素材かを推し量る。分からなければ undefined。 */
export function detectFreeSource(fileName: string): FreeSource | undefined {
  return FREE_SOURCES.find((source) => source.filePattern?.test(fileName))
}

/** 素材名(拡張子を除いたファイル名)。 */
export function titleOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

/**
 * サイトを選んだときの権利表記。
 * 表記が必要なサイトは必ず概要欄に載せ、任意のサイトも既定で載せる(外すこともできる)。素材ごとに違うサイトは表記の確認を促す。
 */
export function licenseFromSource(source: FreeSource, fileName: string): AssetLicense {
  return {
    source: `${source.name} ${source.url}`,
    sourceId: source.id,
    creditRequired: source.credit !== 'optional',
    creditText: source.creditText.replace('{title}', titleOf(fileName)),
    creditOptIn: true
  }
}
