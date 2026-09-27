import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { inferPortraitConfig } from '@shared/portrait/infer'
import type { AssetLicense, Character } from '@shared/project/types'
import type { PsdManifest } from '@shared/psd/types'

import { api, toAppError } from '../../api'
import { browserResources } from '../../render/browser-resources'
import { useEditorStore } from '../../state/store'
import { PortraitManager } from './PortraitManager'
import { PortraitPreview } from './PortraitPreview'

interface PortraitSectionProps {
  character: Character
  run: (commands: Command[], label: string) => Record<string, string> | null
}

/** キャラクター画面の「立ち絵」欄。PSD を選ぶとパーツを推定して設定し、細かい調整は素材マネージャーで行う。 */
export function PortraitSection({ character, run }: PortraitSectionProps): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const portrait = character.portrait
  const asset = portrait ? project.assets[portrait.assetId] : undefined
  const [manifest, setManifest] = useState<PsdManifest | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  useEffect(() => {
    if (!portrait || !asset) {
      setManifest(null)
      return
    }
    let cancelled = false
    browserResources
      .loadManifest(portrait.assetId, asset.path.absolute)
      .then((loaded) => !cancelled && setManifest(loaded))
      .catch((caught: unknown) => !cancelled && setError(toAppError(caught).message))
    return () => {
      cancelled = true
    }
  }, [portrait, asset])

  const pickPsd = async (): Promise<void> => {
    setError(null)
    const picked = await api.invoke('dialog:pick', { kind: 'psd' })
    const path = picked?.[0]
    if (!path) return
    setLoading(true)
    try {
      const loaded = await api.invoke('psd:load', path)
      // 何人目の立ち絵かで既定の位置(右・左…)を変える。
      const slot = Object.values(project.characters).filter((other) => other.portrait && other.id !== character.id).length
      const inferred = inferPortraitConfig(loaded, 'psd', project.canvas, slot)
      const previousAssetId = portrait?.assetId
      const commands: Command[] = [
        {
          op: 'asset.add',
          asset: {
            type: 'psd',
            path: { absolute: path, relative: null },
            license: { source: '', creditRequired: true, creditText: '' }
          },
          tempId: 'psd'
        },
        { op: 'character.setPortrait', characterId: character.id, portrait: { ...inferred.config, assetId: 'psd' } }
      ]
      if (previousAssetId && !usedElsewhere(previousAssetId)) commands.push({ op: 'asset.remove', assetId: previousAssetId })
      const resolved = run(commands, '立ち絵の設定')
      if (resolved?.['psd']) browserResources.remember(resolved['psd'], loaded)
      setNotes(inferred.notes)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setLoading(false)
    }
  }

  /** ほかのキャラクターも同じ PSD を使っているか(使っていれば素材は残す)。 */
  const usedElsewhere = (assetId: string): boolean =>
    Object.values(project.characters).some((other) => other.id !== character.id && other.portrait?.assetId === assetId)

  const removePortrait = (): void => {
    if (!portrait) return
    const commands: Command[] = [{ op: 'character.setPortrait', characterId: character.id, portrait: null }]
    if (!usedElsewhere(portrait.assetId)) commands.push({ op: 'asset.remove', assetId: portrait.assetId })
    if (run(commands, '立ち絵を外す')) setNotes([])
  }

  const updateLicense = (patch: Partial<AssetLicense>): void => {
    if (!portrait || !asset) return
    run([{ op: 'asset.updateLicense', assetId: portrait.assetId, license: { ...asset.license, ...patch } }], '素材のライセンスの変更')
  }

  return (
    <section data-testid="portrait-section">
      <h3>立ち絵</h3>
      {error && <p className="status status--error">{error}</p>}
      {!portrait ? (
        <>
          <p className="note">PSD の立ち絵を選ぶと、目・口・眉のパーツを自動で推定します。</p>
          <button type="button" onClick={() => void pickPsd()} disabled={loading} data-testid="portrait-pick">
            {loading ? '読み込み中…' : 'PSD を選ぶ'}
          </button>
        </>
      ) : (
        <div className="portrait-section">
          <div className="portrait-section__thumb">
            {manifest ? (
              <PortraitPreview
                portrait={portrait}
                manifest={manifest}
                expressionId={portrait.defaultExpressionId}
                animate={false}
                size={160}
              />
            ) : (
              <span className="status">読み込み中…</span>
            )}
          </div>
          <div className="portrait-section__body">
            <p className="portrait-section__file" title={asset?.path.absolute}>
              {asset?.path.absolute.split(/[\\/]/).at(-1) ?? '(素材が見つかりません)'}
            </p>
            {notes.map((note) => (
              <p key={note} className="status status--warn" data-testid="portrait-note">
                {note}
              </p>
            ))}
            {manifest?.warnings.map((warning) => (
              <p key={warning} className="status status--warn">
                {warning}
              </p>
            ))}
            <span className="field__row field__row--wrap">
              <button type="button" onClick={() => setManagerOpen(true)} data-testid="portrait-open-manager">
                パーツと表情を設定
              </button>
              <button type="button" onClick={() => void pickPsd()} disabled={loading}>
                別の PSD にする
              </button>
              <button type="button" className="button--danger" onClick={removePortrait}>
                立ち絵を外す
              </button>
            </span>
            {asset && (
              <>
                <label className="field">
                  <span className="field__label">入手元(配布ページなど)</span>
                  <input
                    type="text"
                    key={`source-${asset.license.source}`}
                    defaultValue={asset.license.source}
                    placeholder="例: https://… の配布ページ"
                    onBlur={(event) => {
                      if (event.target.value !== asset.license.source) updateLicense({ source: event.target.value })
                    }}
                    data-testid="portrait-license-source"
                  />
                </label>
                <label className="field">
                  <span className="field__label">クレジット表記</span>
                  <input
                    type="text"
                    key={`credit-${asset.license.creditText ?? ''}`}
                    defaultValue={asset.license.creditText ?? ''}
                    placeholder="例: 立ち絵: 坂本アヒル様"
                    onBlur={(event) => {
                      if (event.target.value !== (asset.license.creditText ?? '')) updateLicense({ creditText: event.target.value })
                    }}
                  />
                </label>
                <label className="field__row">
                  <input
                    type="checkbox"
                    checked={asset.license.creditRequired}
                    onChange={(event) => updateLicense({ creditRequired: event.target.checked })}
                  />
                  動画の説明欄にクレジットを載せる
                </label>
              </>
            )}
          </div>
        </div>
      )}
      {managerOpen && <PortraitManager characterId={character.id} onClose={() => setManagerOpen(false)} />}
    </section>
  )
}
