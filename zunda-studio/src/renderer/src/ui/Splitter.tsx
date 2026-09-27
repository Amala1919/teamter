import { useRef } from 'react'

import { useLayoutStore, LAYOUT_LIMITS, type LayoutKey } from '../state/layout'
import { openContextMenu } from './ContextMenu'

interface SplitterProps {
  /** どの欄の大きさを変えるか。 */
  target: LayoutKey
  /** 大きさの基準になる要素(比率はこの要素の幅・高さに対して)。 */
  container: () => HTMLElement | null
  /** 境界の向き。vertical は左右に動く縦の線、horizontal は上下に動く横の線。 */
  orientation: 'vertical' | 'horizontal'
  /** 欄が境界の後ろ側(右・下)にあるなら true。 */
  after?: boolean
  label: string
}

const KEY_STEP = 0.02

/**
 * 欄の境界。ドラッグで大きさを変える。ダブルクリックで既定に戻し、矢印キーでも動かせる。
 */
export function Splitter({ target, container, orientation, after = false, label }: SplitterProps): React.JSX.Element {
  const value = useLayoutStore((state) => state.layout[target])
  const setRatio = useLayoutStore((state) => state.set)
  const reset = useLayoutStore((state) => state.reset)
  const dragging = useRef(false)

  const ratioAt = (clientX: number, clientY: number): number | null => {
    const element = container()
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (orientation === 'vertical') {
      return after ? (rect.right - clientX) / rect.width : (clientX - rect.left) / rect.width
    }
    return after ? (rect.bottom - clientY) / rect.height : (clientY - rect.top) / rect.height
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add(orientation === 'vertical' ? 'resizing-x' : 'resizing-y')
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const ratio = ratioAt(event.clientX, event.clientY)
    if (ratio !== null) setRatio(target, ratio)
  }
  const stop = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('resizing-x', 'resizing-y')
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const grow = orientation === 'vertical' ? (after ? 'ArrowLeft' : 'ArrowRight') : after ? 'ArrowUp' : 'ArrowDown'
    const shrink = orientation === 'vertical' ? (after ? 'ArrowRight' : 'ArrowLeft') : after ? 'ArrowDown' : 'ArrowUp'
    if (event.key === grow) setRatio(target, value + KEY_STEP)
    else if (event.key === shrink) setRatio(target, value - KEY_STEP)
    else if (event.key === 'Home' || event.key === 'Enter') reset(target)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const [min, max] = LAYOUT_LIMITS[target]
  return (
    <div
      className={`splitter splitter--${orientation}`}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(value * 100)}
      title={`${label}(ドラッグで大きさを変える・ダブルクリックで元に戻す)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => reset(target)}
      onKeyDown={onKeyDown}
      onContextMenu={(event) =>
        openContextMenu(event, [
          { label: 'この境界を元に戻す', onSelect: () => reset(target) },
          { label: 'すべての欄の大きさを元に戻す', onSelect: () => reset(), testId: 'menu-reset-layout' }
        ])
      }
      data-testid={`splitter-${target}`}
    />
  )
}
