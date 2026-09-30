import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { findItem, isVoiceItem, itemsAt, projectDurationMs } from '@shared/project/queries'
import { zoomCommands } from '@shared/commands/zoom-still'
import { renderFrame } from '@shared/render/compositor'
import type { PsdManifest } from '@shared/psd/types'
import type { Ctx2D } from '@shared/render/types'
import { defaultRegion, zoomProgress } from '@shared/render/zoom'
import { portraitScenes, type PortraitScene } from '@shared/portrait/scene'
import type { Ms, PortraitTransform, Project, VoiceItem } from '@shared/project/types'
import { portraitPlacement } from '@shared/render/portrait'
import { isPlacedItem, itemBox, type PlacedItem } from '@shared/render/item-box'

import { measureContext } from '../../lib/fonts'
import { formatMs } from '../../lib/time'
import { player, togglePlayback, usePlaybackStore } from '../../playback/player'
import { browserResources, useResourceStore } from '../../render/browser-resources'
import { useMediaStore } from '../../state/media'
import { hasClipboard, pasteAt, splitAtPlayhead } from '../../state/edit-actions'
import { changeEditing } from '../../state/editing'
import { useSettingsStore } from '../../state/settings'
import { saveFrameImage } from '../../state/snapshot'
import { deleteSelection, useEditorStore } from '../../state/store'
import { openContextMenu, type MenuEntry } from '../../ui/ContextMenu'
import { insertZoom } from '../timeline/timeline-menus'
import { ItemFrameEditor } from './ItemFrameEditor'
import { PortraitFrameEditor } from './PortraitFrameEditor'
import { ZoomFrameEditor } from './ZoomFrameEditor'

/** ズーム枠を置いたときの既定の尺。 */
const DEFAULT_ZOOM_MS = 3000

export function PreviewPane({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useEditorStore((state) => state.project)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const setSelection = useEditorStore((state) => state.setSelection)
  const dispatch = useEditorStore((state) => state.dispatch)
  const durationMs = projectDurationMs(project)
  const caption = itemsAt(project, playheadMs)
    .filter(isVoiceItem)
    .map((item) => `${project.characters[item.characterId]?.name ?? ''}「${item.displayText ?? item.text}」`)
    .join(' ')
  const playing = usePlaybackStore((state) => state.playing)
  const loading = usePlaybackStore((state) => state.loading)
  // 画像や PSD・動画のコマの読み込みが終わったら描き直す。
  const resourceVersion = useResourceStore((state) => state.version)
  const mediaSources = useMediaStore((state) => state.sources)
  const [checkZoom, setCheckZoom] = useState(false)
  const [overlayBox, setOverlayBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  /** プレビューで動かしている立ち絵のキャラクター。 */
  const [portraitTarget, setPortraitTarget] = useState<string | null>(null)

  const selected = selectedItemIds[0] === undefined ? undefined : findItem(project, selectedItemIds[0])
  const zoomItem = selected?.type === 'zoom' ? selected : null

  // タイムラインで場面ごとの立ち絵を選んだら、そのキャラクターの立ち絵を動かせるようにする。
  const selectedPortraitCharacter = selected?.type === 'portrait' ? selected.characterId : null
  useEffect(() => {
    if (selectedPortraitCharacter) setPortraitTarget(selectedPortraitCharacter)
  }, [selectedPortraitCharacter])

  const bound = browserResources.bind(project)
  const layerIndex = new Map(project.layers.map((layer) => [layer.id, layer.index]))
  /** 画面に出ている立ち絵と、その範囲。描く順(上にあるものが後)に並べる。 */
  const placedPortraits: PlacedPortrait[] = []
  for (const scene of portraitScenes(project, playheadMs)) {
    const manifest = scene.character.portrait ? bound.psd(scene.character.portrait.assetId) : null
    if (manifest) placedPortraits.push({ scene, manifest, rect: portraitPlacement(scene.transform, manifest) })
  }
  placedPortraits.sort((a, b) => (layerIndex.get(a.scene.layerId) ?? 0) - (layerIndex.get(b.scene.layerId) ?? 0))
  // プレビューでクリックした素材を選ぶか(設定の「編集」タブで切れる)
  const clickSelect = useSettingsStore((state) => state.settings?.ui.previewClickSelect !== false)
  const hiddenLayers = new Set(project.layers.filter((layer) => !layer.visible).map((layer) => layer.id))
  const lockedLayers = new Set(project.layers.filter((layer) => layer.locked).map((layer) => layer.id))
  /** 画面に出ていて、プレビューで動かせる素材と、その範囲。描く順(上にあるものが後)。 */
  const placedItems = itemsAt(project, playheadMs)
    .filter((item): item is PlacedItem => isPlacedItem(item) && !hiddenLayers.has(item.layerId))
    .flatMap((item) => {
      const rect = itemBox(project, item, measureContext())
      return rect ? [{ item, rect }] : []
    })
    .sort((a, b) => (layerIndex.get(a.item.layerId) ?? 0) - (layerIndex.get(b.item.layerId) ?? 0))
  /** 画面いっぱいの動画(背景のゲーム映像など)。枠を出すと下の素材を触れなくなるので、枠もクリックでの選択もしない。 */
  const fillsScreen = ({ rect }: { rect: { x: number; y: number; width: number; height: number } }): boolean =>
    rect.x <= 1 && rect.y <= 1 && rect.x + rect.width >= project.canvas.width - 1 && rect.y + rect.height >= project.canvas.height - 1
  const framed =
    zoomItem || !selected || !isPlacedItem(selected) || selected.locked || lockedLayers.has(selected.layerId)
      ? undefined
      : placedItems.find((entry) => entry.item.id === selected.id && !(entry.item.type === 'video' && fillsScreen(entry)))
  const editingPortrait = zoomItem || framed ? undefined : placedPortraits.find((entry) => entry.scene.character.id === portraitTarget)

  /** 画面上の位置を、キャンバスの座標に直す(canvas の上でも、重ねた枠の上でも同じ)。 */
  const toCanvasPoint = (event: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1, height: 1 }
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * project.canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * project.canvas.height
    }
  }
  const portraitAt = (point: { x: number; y: number }): PlacedPortrait | undefined =>
    [...placedPortraits]
      .reverse()
      .find(({ rect }) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height)

  /** 立ち絵の配置を変える。場面ごとの立ち絵があればその区間だけ、無ければ全体の配置を変える。 */
  const commitPortrait = (scene: PortraitScene, transform: PortraitTransform): void => {
    const portrait = scene.character.portrait
    if (!portrait) return
    const result = scene.controllingItem
      ? dispatch([{ op: 'portrait.update', itemId: scene.controllingItem.id, transform }], 'この区間の立ち絵の配置')
      : dispatch([{ op: 'character.setPortrait', characterId: scene.character.id, portrait: { ...portrait, transform } }], '立ち絵の配置')
    if (!result.ok) onError(result.message)
  }
  // 枠の編集中は拡大前の画面を見せる。「拡大して確認」か再生中は拡大した結果を見せる(Z-6)。
  const applyZoom = zoomItem === null || checkZoom || playing

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    renderFrame(context as unknown as Ctx2D, project, playheadMs, browserResources.bind(project), { applyZoom })
  }, [project, playheadMs, resourceVersion, mediaSources, applyZoom])

  // 枠は表示中の canvas にぴったり重ねる。
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = (): void =>
      setOverlayBox({ left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.clientWidth, height: canvas.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const building = Object.values(mediaSources).find((source) => source.state === 'building')
  const failed = Object.values(mediaSources).find((source) => source.state === 'error')

  const zoomOnStill = project.editing.zoomOnStill ?? 'overwrite'

  const addZoom = (): void => {
    const result = dispatch(
      zoomCommands(project, playheadMs, DEFAULT_ZOOM_MS, defaultRegion(project.canvas)),
      'ズーム枠の追加'
    )
    if (!result.ok) {
      onError(result.message)
      return
    }
    if (result.resolvedIds['zoom']) setSelection([result.resolvedIds['zoom']])
    setCheckZoom(false)
  }

  const report = (message: string | null): void => {
    if (message) onError(message)
  }

  /** プレビューの右クリック。クリックした所を中心にズーム枠を置けるようにする。 */
  /** 立ち絵の上での右クリックの項目。「この場面」は、再生位置のセリフの間(セリフが無ければ再生位置から3秒)。 */
  const portraitMenu = (point: { x: number; y: number }): MenuEntry[] => {
    const hit = portraitAt(point)
    if (!hit) return []
    const { scene } = hit
    const name = scene.character.name
    const range = sceneRange(project, scene.character.id, playheadMs)
    const insert = (kind: 'adjust' | 'hide', extra: { transform?: PortraitTransform; expressionId?: string | null }, label: string): void => {
      const result = dispatch([{ op: 'portrait.insert', characterId: scene.character.id, atMs: range.startMs, durationMs: range.durationMs, kind, ...extra, tempId: 'scene' }], label)
      if (!result.ok) {
        onError(result.message)
        return
      }
      if (result.resolvedIds['scene']) setSelection([result.resolvedIds['scene']])
      if (kind === 'adjust') setPortraitTarget(scene.character.id)
    }
    const expressions = Object.values(scene.character.portrait?.expressions ?? {})
    const adjusting = scene.controllingItem?.kind === 'adjust' ? scene.controllingItem : null
    const setExpression = (expressionId: string | null): void => {
      if (adjusting) {
        const result = dispatch([{ op: 'portrait.update', itemId: adjusting.id, expressionId }], 'この場面の表情')
        if (!result.ok) onError(result.message)
      } else {
        insert('adjust', { expressionId }, 'この場面の表情')
      }
    }
    const entries: MenuEntry[] = [
      { label: `「${name}」の立ち絵を動かす(枠を出す)`, onSelect: () => setPortraitTarget(scene.character.id), testId: 'menu-portrait-edit' },
      {
        label: `この場面だけ「${name}」を動かせるようにする`,
        onSelect: () => insert('adjust', { transform: scene.transform }, 'この場面の立ち絵'),
        testId: 'menu-portrait-scene'
      },
      { label: `この場面で「${name}」を隠す`, onSelect: () => insert('hide', {}, '立ち絵を隠す'), testId: 'menu-portrait-hide' }
    ]
    if (expressions.length > 0) {
      entries.push({
        label: 'この場面の表情',
        testId: 'menu-portrait-expression',
        submenu: [
          { label: 'セリフに合わせる', checked: scene.expressionId === undefined, onSelect: () => setExpression(null) },
          ...expressions.map((expression) => ({
            label: expression.name,
            checked: scene.expressionId === expression.id,
            onSelect: () => setExpression(expression.id)
          }))
        ]
      })
    }
    if (scene.controllingItem?.transformOverride) {
      const item = scene.controllingItem
      entries.push({
        label: 'この区間の配置をやめる(全体の配置に戻す)',
        onSelect: () => {
          const result = dispatch([{ op: 'portrait.update', itemId: item.id, transform: null }], '立ち絵の配置を戻す')
          if (!result.ok) onError(result.message)
        }
      })
    }
    entries.push('separator')
    return entries
  }

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return
    const point = toCanvasPoint(event)
    const hit = portraitAt(point)
    // テロップ・画像・図形の上なら、それを選ぶ(立ち絵より上のレイヤーにあるときだけ)。
    const itemHit = clickSelect
      ? [...placedItems]
          .reverse()
          .find(
            (entry) =>
              !fillsScreen(entry) &&
              point.x >= entry.rect.x &&
              point.x <= entry.rect.x + entry.rect.width &&
              point.y >= entry.rect.y &&
              point.y <= entry.rect.y + entry.rect.height
          )
      : undefined
    if (itemHit && (!hit || (layerIndex.get(itemHit.item.layerId) ?? 0) >= (layerIndex.get(hit.scene.layerId) ?? 0))) {
      setPortraitTarget(null)
      setSelection([itemHit.item.id])
      return
    }
    setPortraitTarget(hit ? hit.scene.character.id : null)
    // 枠を出している素材の外をクリックしたら、選ぶのをやめる(立ち絵やほかの素材を触れるように)。
    if (framed) setSelection([])
  }

  // 画像の保存などの短いお知らせ。しばらくしたら消す。
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const saveImage = (subtitles: boolean): void => {
    saveFrameImage(project, playheadMs, { subtitles })
      .then((path) => {
        if (path) setNotice(`画像を保存しました: ${path}`)
      })
      .catch((error: unknown) => onError(`画像を保存できませんでした: ${error instanceof Error ? error.message : String(error)}`))
  }

  const onCanvasContextMenu = (event: React.MouseEvent): void => {
    const point = toCanvasPoint(event)
    const entries: MenuEntry[] = [
      ...portraitMenu(point),
      { label: playing ? '停止' : '再生', shortcut: 'Space', onSelect: togglePlayback },
      'separator',
      {
        label: 'ここを中心にズーム枠を置く',
        onSelect: () => {
          report(insertZoom(project, playheadMs, DEFAULT_ZOOM_MS, point))
          setCheckZoom(false)
        },
        testId: 'menu-preview-zoom'
      },
      {
        label: 'この画面を画像で保存(PNG)',
        submenu: [
          { label: '字幕あり', onSelect: () => saveImage(true), testId: 'menu-preview-image' },
          { label: '字幕なし(サムネイル用)', onSelect: () => saveImage(false), testId: 'menu-preview-image-plain' }
        ],
        testId: 'menu-preview-image-parent'
      },
      { label: '再生位置で分割', shortcut: 'S', onSelect: () => report(splitAtPlayhead()) },
      { label: '再生位置に貼り付け', shortcut: 'Ctrl+V', disabled: !hasClipboard(), onSelect: () => report(pasteAt()) }
    ]
    if (selected && 'transform' in selected) {
      const reset = (patch: { x?: number; y?: number; scale?: number; rotation?: number }, label: string): void => {
        const result = dispatch([{ op: 'item.setTransform', itemId: selected.id, ...patch }], label)
        if (!result.ok) onError(result.message)
      }
      entries.push(
        'separator',
        { label: '選んだものを中央に戻す', onSelect: () => reset({ x: project.canvas.width / 2, y: project.canvas.height / 2 }, '位置を戻す') },
        { label: '選んだものの大きさ・回転を元に戻す', onSelect: () => reset({ scale: 1, rotation: 0 }, '大きさを戻す') },
        { label: '選んだものをクリックした所へ', onSelect: () => reset(point, '位置の変更') }
      )
    }
    if (selected) {
      entries.push('separator', { label: '選んだものを削除', shortcut: 'Delete', danger: true, onSelect: () => report(deleteSelection()) })
    }
    openContextMenu(event, entries)
  }

  return (
    <section className="pane pane--preview">
      <header className="pane__header">
        <h2>プレビュー</h2>
        <button type="button" className="button--small" onClick={addZoom} data-testid="add-zoom" title="再生位置にズーム枠を置く">
          ズーム枠を置く
        </button>
        <label className="preview__zoomCheck" title="ズームを置くとき、その時点の動画のコマを静止画にして、ズームとグループにする(設定の「編集」で置き換え方も選べます)">
          <input
            type="checkbox"
            checked={zoomOnStill !== 'off'}
            onChange={(event) => report(changeEditing({ zoomOnStill: event.target.checked ? 'overwrite' : 'off' }))}
            data-testid="zoom-on-still"
          />
          静止画で
        </label>
        {zoomItem && (
          <label className="preview__zoomCheck">
            <input
              type="checkbox"
              checked={checkZoom}
              onChange={(event) => {
                setCheckZoom(event.target.checked)
                // 寄り切っている区間の外にいれば、確かめやすいよう寄り切った時刻へ移る。
                if (event.target.checked && zoomProgress(zoomItem, playheadMs - zoomItem.startMs) < 1) {
                  const settled = zoomItem.startMs + Math.min(zoomItem.durationMs / 2, zoomItem.method === 'slowPush' ? zoomItem.durationMs - zoomItem.outMs - 1 : zoomItem.inMs + 1)
                  setPlayhead(settled)
                }
              }}
              data-testid="zoom-check"
            />
            拡大して確認
          </label>
        )}
        <span className="pane__count">
          {project.canvas.width}×{project.canvas.height} / {project.canvas.fps}fps
        </span>
      </header>
      {building && building.state === 'building' && (
        <p className="status" data-testid="proxy-status">
          編集用の動画を作成中… {Math.round(building.ratio * 100)}%
        </p>
      )}
      {failed && failed.state === 'error' && <p className="status status--error">{failed.message}</p>}
      <div className="preview__stage">
        <canvas
          ref={canvasRef}
          width={project.canvas.width}
          height={project.canvas.height}
          className="preview__canvas"
          onContextMenu={onCanvasContextMenu}
          onPointerDown={onCanvasPointerDown}
          data-testid="preview-canvas"
        />
        {zoomItem && !applyZoom && overlayBox && (
          <div className="preview__overlay" style={overlayBox}>
            <ZoomFrameEditor
              canvas={project.canvas}
              region={zoomItem.region}
              scale={project.canvas.width / Math.max(1, overlayBox.width)}
              onCommit={(region) => {
                const result = dispatch([{ op: 'zoom.update', itemId: zoomItem.id, region }], 'ズーム枠の変更')
                if (!result.ok) onError(result.message)
              }}
            />
          </div>
        )}
        {framed && overlayBox && (
          <div className="preview__overlay preview__overlay--passthrough" style={overlayBox}>
            <ItemFrameEditor
              canvas={project.canvas}
              size={{ width: framed.rect.width, height: framed.rect.height }}
              placement={{ x: framed.item.transform.x, y: framed.item.transform.y, scale: framed.item.transform.scale }}
              scale={project.canvas.width / Math.max(1, overlayBox.width)}
              label={FRAME_LABELS[framed.item.type]}
              onCommit={(placement) => {
                const result = dispatch([{ op: 'item.setTransform', itemId: framed.item.id, ...placement }], `${FRAME_LABELS[framed.item.type]}の位置・大きさ`)
                if (!result.ok) onError(result.message)
              }}
              onContextMenu={onCanvasContextMenu}
            />
          </div>
        )}
        {editingPortrait && overlayBox && (
          <div className="preview__overlay preview__overlay--passthrough" style={overlayBox}>
            <PortraitFrameEditor
              canvas={project.canvas}
              manifest={editingPortrait.manifest}
              transform={editingPortrait.scene.transform}
              scale={project.canvas.width / Math.max(1, overlayBox.width)}
              label={`${editingPortrait.scene.character.name}: ${editingPortrait.scene.controllingItem ? 'この区間の配置' : '全体の配置'}`}
              onCommit={(transform) => commitPortrait(editingPortrait.scene, transform)}
              onContextMenu={onCanvasContextMenu}
            />
          </div>
        )}
        {/* 画面の字幕は canvas に描くため、読み上げ用に同じ内容を文字でも出す。 */}
        <p className="sr-only" aria-live="polite" data-testid="current-subtitle">
          {caption}
        </p>
      </div>
      <div className="preview__controls">
        <button
          type="button"
          className="preview__play"
          onClick={togglePlayback}
          disabled={loading}
          aria-label={playing ? '停止' : '再生'}
          data-testid="play-toggle"
        >
          {loading ? '…' : playing ? '■' : '▶'}
        </button>
        <span className="preview__time" data-testid="playhead">
          {formatMs(playheadMs)} / {formatMs(durationMs)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1000)}
          step={10}
          value={Math.min(playheadMs, Math.max(durationMs, 1000))}
          onChange={(event) => {
            player.stop()
            setPlayhead(Number(event.target.value))
          }}
          aria-label="再生位置"
        />
        {notice && (
          <span className="preview__notice" role="status" data-testid="preview-notice">
            {notice}
          </span>
        )}
      </div>
    </section>
  )
}

const FRAME_LABELS: Record<PlacedItem['type'], string> = { text: 'テロップ', image: '画像', shape: '図形', video: '動画' }

interface PlacedPortrait {
  scene: PortraitScene
  manifest: PsdManifest
  rect: { x: number; y: number; width: number; height: number }
}

/** 「この場面」の範囲: 再生位置でそのキャラクターが話しているセリフ、無ければ誰かのセリフ、それも無ければ再生位置から3秒。 */
export function sceneRange(project: Project, characterId: string, playheadMs: Ms): { startMs: Ms; durationMs: Ms } {
  const lines = project.items.filter(
    (item): item is VoiceItem => item.type === 'voice' && item.startMs <= playheadMs && playheadMs < item.startMs + item.durationMs
  )
  const line = lines.find((item) => item.characterId === characterId) ?? lines[0]
  return line ? { startMs: line.startMs, durationMs: line.durationMs } : { startMs: Math.round(playheadMs), durationMs: 3000 }
}
