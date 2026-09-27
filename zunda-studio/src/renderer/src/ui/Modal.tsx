import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 開いているモーダルの重なり順。Esc は一番上のモーダルだけを閉じる。 */
const openModals: symbol[] = []

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps): React.JSX.Element {
  const id = useRef(Symbol('modal')).current
  useEffect(() => {
    openModals.push(id)
    return () => {
      openModals.splice(openModals.indexOf(id), 1)
    }
  }, [id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 上のモーダルが閉じた直後に再描画が走り、下のモーダルが「一番上」に見えることがあるので、
      // 処理済みの Esc(defaultPrevented)は無視する。
      if (event.key !== 'Escape' || event.defaultPrevented || openModals.at(-1) !== id) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, onClose])

  return createPortal(
    <div className="modal__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={wide ? 'modal modal--wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}
