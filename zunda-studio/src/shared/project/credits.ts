import type { Asset, AssetId, Project } from './types'

/**
 * 概要欄に載せるクレジット文を作る(REQUIREMENTS.md E-3, L-3, L-4)。
 * 実際に動画で使われているものだけを載せる。最終確認は投稿者が行う前提で、ここでは下書きを作るだけ。
 */

export interface CreditIssue {
  assetId: AssetId | null
  message: string
}

export interface CreditsDraft {
  text: string
  /** 入手元が空、クレジットが必要なのに表記が空、などの確認が必要な点。 */
  issues: CreditIssue[]
}

const SECTION_ORDER = ['voice', 'portrait', 'sound', 'visual'] as const
type Section = (typeof SECTION_ORDER)[number]

const SECTION_TITLES: Record<Section, string> = {
  voice: '音声',
  portrait: '立ち絵',
  sound: 'BGM・効果音',
  visual: '画像・映像'
}

function fileName(asset: Asset): string {
  return asset.path.absolute.split(/[\\/]/).at(-1) ?? asset.path.absolute
}

/** プロジェクトの中で実際に使われている素材。 */
export function usedAssetIds(project: Project): Set<AssetId> {
  const used = new Set<AssetId>()
  for (const item of project.items) {
    if ('assetId' in item) used.add(item.assetId)
  }
  for (const character of Object.values(project.characters)) {
    if (character.portrait) used.add(character.portrait.assetId)
  }
  return used
}

export function generateCredits(project: Project): CreditsDraft {
  const sections: Record<Section, string[]> = { voice: [], portrait: [], sound: [], visual: [] }
  const issues: CreditIssue[] = []
  const add = (section: Section, line: string): void => {
    if (line !== '' && !sections[section].includes(line)) sections[section].push(line)
  }

  // セリフで実際に使われたキャラクターだけ。
  const speaking = new Set(project.items.filter((item) => item.type === 'voice').map((item) => item.characterId))
  for (const character of Object.values(project.characters)) {
    if (!speaking.has(character.id)) continue
    if (character.creditText.trim() === '') {
      issues.push({ assetId: null, message: `${character.name} の音声のクレジット表記が空です` })
      continue
    }
    add('voice', character.creditText.trim())
  }

  for (const assetId of usedAssetIds(project)) {
    const asset = project.assets[assetId]
    if (!asset) continue
    const { license } = asset
    if (license.source.trim() === '') issues.push({ assetId, message: `${fileName(asset)} の入手元が未記入です` })
    if (!license.creditRequired) continue
    const text = license.creditText?.trim() ?? ''
    if (text === '') {
      issues.push({ assetId, message: `${fileName(asset)} はクレジットが必要ですが、表記が未記入です` })
      continue
    }
    add(asset.type === 'psd' ? 'portrait' : asset.type === 'audio' ? 'sound' : 'visual', text)
  }

  const text = SECTION_ORDER.filter((section) => sections[section].length > 0)
    .map((section) => `【${SECTION_TITLES[section]}】\n${sections[section].join('\n')}`)
    .join('\n\n')
  return { text, issues }
}
