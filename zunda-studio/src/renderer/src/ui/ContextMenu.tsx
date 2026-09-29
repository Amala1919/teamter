import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

/**
 * 右クリックメニュー。どの画面からも openContextMenu(event, 項目) で開く。
 * 表示は App の直下に1つだけ置いた ContextMenuHost が受け持つ。
 */
export type MenuEntry =
  | 'separator'
  | {
      label: string
      /** 右端に出すショートカットの説明。 */
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      /** チェックの印を付ける(切り替えの項目)。 */
      checked?: boolean
      onSelect?: () => void
      submenu?: MenuEntry[]
      testId?: string
    }

interface MenuState {
  menu: { x: number; y: number; entries: MenuEntry[] } | null
  open: (x: number, y: number, entries: MenuEntry[]) => void
  close: () => void
}

const useMenuStore = create<MenuState>((set) => ({
  menu: null,
  open: (x, y, entries) => set({ menu: { x, y, entries } }),
  close: () => set({ menu: null })
}))

/** 右クリックの位置にメニューを出す。項目が無ければ何もしない。 */
export function openContextMenu(event: React.MouseEvent | MouseEvent, entries: MenuEntry[]): void {
  event.preventDefault()
  event.stopPropagation()
  const visible = trimSeparators(entries)
  if (visible.length === 0) return
  useMenuStore.getState().open(event.clientX, event.clientY, visible)
}

/** ボタンの下などの決まった位置にメニューを出す(ドロップダウン)。 */
export function openMenuAt(x: number, y: number, entries: MenuEntry[]): void {
  const visible = trimSeparators(entries)
  if (visible.length === 0) return
  useMenuStore.getState().open(x, y, visible)
}

export function closeContextMenu(): void {
  useMenuStore.getState().close()
}

/** 先頭・末尾・連続した区切り線を除く(条件で項目を出し分けたときに区切りだけ残らないように)。 */
function trimSeparators(entries: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = []
  for (const entry of entries) {
    if (entry === 'separator' && (result.length === 0 || result.at(-1) === 'separator')) continue
    result.push(entry)
  }
  while (result.at(-1) === 'separator') result.pop()
  return result
}

export function ContextMenuHost(): React.JSX.Element | null {
  const menu = useMenuStore((state) => state.menu)
  const close = useMenuStore((state) => state.close)

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !document.querySelector('.context-menu-root')?.contains(event.target)) close()
    }
    const onDismiss = (): void => close()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('wheel', onDismiss, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('wheel', onDismiss)
    }
  }, [menu, close])

  if (!menu) return null
  return createPortal(
    <div className="context-menu-root">
      <MenuList entries={menu.entries} x={menu.x} y={menu.y} onClose={close} autoFocus />
    </div>,
    document.body
  )
}

interface MenuListProps {
  entries: MenuEntry[]
  x: number
  y: number
  onClose: () => void
  autoFocus?: boolean
  /** 親メニューへ戻る(左キー)。 */
  onBack?: () => void
  /** 画面の右に収まらないときに、左側へ出す基準(サブメニュー用)。 */
  flipX?: number
}

function MenuList({ entries, x, y, onClose, autoFocus, onBack, flipX }: MenuListProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [subAnchor, setSubAnchor] = useState<{ x: number; y: number; flipX: number } | null>(null)

  // 画面からはみ出さないように位置を直す。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - 4) left = flipX !== undefined ? flipX - rect.width : window.innerWidth - rect.width - 4
    if (top + rect.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - rect.height - 4)
    setPosition({ left: Math.max(4, left), top })
    if (autoFocus) element.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }, [x, y, flipX, autoFocus])

  const items = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled="true"])') ?? [])]

  const showSub = (index: number, element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    setOpenSub(index)
    setSubAnchor({ x: rect.right - 2, y: rect.top - 4, flipX: rect.left + 2 })
  }

  const activate = (index: number, element: HTMLElement): void => {
    const entry = entries[index]
    if (!entry || entry === 'separator' || entry.disabled) return
    if (entry.submenu) {
      showSub(index, element)
      return
    }
    onClose()
    entry.onSelect?.()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const list = items()
    const current = list.indexOf(document.activeElement as HTMLElement)
    const focusAt = (index: number): void => list[(index + list.length) % list.length]?.focus()
    switch (event.key) {
      case 'ArrowDown':
        focusAt(current + 1)
        break
      case 'ArrowUp':
        focusAt(current < 0 ? list.length - 1 : current - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(list.length - 1)
        break
      case 'Escape':
        onClose()
        break
      case 'ArrowLeft':
        if (!onBack) return
        onBack()
        break
      case 'ArrowRight':
      case 'Enter':
      case ' ': {
        const element = document.activeElement as HTMLElement | null
        const index = Number(element?.dataset['index'])
        if (!element || Number.isNaN(index)) return
        const entry = entries[index]
        if (event.key === 'ArrowRight' && (entry === 'separator' || !entry?.submenu)) return
        activate(index, element)
        break
      }
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      data-testid="context-menu"
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu__separator" role="separator" />
        ) : (
          <div
            key={`${entry.label}-${index}`}
            role="menuitem"
            tabIndex={-1}
            data-index={index}
            aria-disabled={entry.disabled ? 'true' : undefined}
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            aria-expanded={entry.submenu ? openSub === index : undefined}
            className={[
              'context-menu__item',
              entry.danger ? 'context-menu__item--danger' : '',
              entry.disabled ? 'context-menu__item--disabled' : '',
              openSub === index ? 'context-menu__item--open' : ''
            ].join(' ')}
            onPointerEnter={(event) => {
              if (!entry.disabled) event.currentTarget.focus()
              if (entry.submenu && !entry.disabled) showSub(index, event.currentTarget)
              else setOpenSub(null)
            }}
            onClick={(event) => activate(index, event.currentTarget)}
            data-testid={entry.testId}
          >
            <span className="context-menu__check">{entry.checked ? '✓' : ''}</span>
            <span className="context-menu__label">{entry.label}</span>
            <span className="context-menu__shortcut">{entry.submenu ? '▸' : (entry.shortcut ?? '')}</span>
          </div>
        )
      )}
      {openSub !== null && subAnchor && (() => {
        const entry = entries[openSub]
        if (!entry || entry === 'separator' || !entry.submenu) return null
        return (
          <MenuList
            entries={trimSeparators(entry.submenu)}
            x={subAnchor.x}
            y={subAnchor.y}
            flipX={subAnchor.flipX}
            onClose={onClose}
            autoFocus
            onBack={() => {
              setOpenSub(null)
              ref.current?.querySelector<HTMLElement>(`[data-index="${openSub}"]`)?.focus()
            }}
          />
        )
      })()}
    </div>
  )
}
