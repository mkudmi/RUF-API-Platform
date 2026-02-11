import { useEffect, useRef, useState } from 'react'
import { useDismissibleLayer } from '../hooks/useDismissibleLayer'

export function SidebarCreateMenu(props: {
  onImport: () => void
  onCreateCollection: () => void
  onCreateFolder: () => void
  triggerLabel?: string
  triggerClassName?: string
  wrapClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ left: number, top: number } | null>(null)

  useDismissibleLayer({
    open,
    onDismiss: () => setOpen(false),
    isInsideTarget: target => {
      const el = wrapRef.current
      return !!(el && target && el.contains(target))
    },
  })

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }

    function updateMenuPosition() {
      const anchor = wrapRef.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!anchor || !menu) return

      const margin = 8
      const gap = 8
      const rect = menu.getBoundingClientRect()

      let left = anchor.right - rect.width
      left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin))

      let top = anchor.bottom + gap
      if (top + rect.height > window.innerHeight - margin) {
        top = anchor.top - rect.height - gap
      }
      top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin))

      setMenuPos({ left: Math.round(left), top: Math.round(top) })
    }

    const rafId = window.requestAnimationFrame(updateMenuPosition)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open])

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={wrapRef} className={props.wrapClassName ? `sidebarPlusWrap ${props.wrapClassName}` : 'sidebarPlusWrap'}>
      <button
        type="button"
        className={props.triggerClassName ? `sidebarPlusBtn ${props.triggerClassName}` : 'sidebarPlusBtn'}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create"
        title="Create"
      >
        <span className={(props.triggerLabel ?? '+') === '+' ? 'sidebarPlusGlyph' : undefined} aria-hidden="true">
          {props.triggerLabel ?? '+'}
        </span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="sidebarPlusMenu"
          role="menu"
          aria-label="Create menu"
          style={menuPos
            ? { left: `${menuPos.left}px`, top: `${menuPos.top}px` }
            : { left: '-9999px', top: '-9999px' }}
        >
          <button type="button" className="sidebarPlusMenuItem" role="menuitem" onClick={() => run(props.onImport)}>
            Import
          </button>
          <button type="button" className="sidebarPlusMenuItem" role="menuitem" onClick={() => run(props.onCreateCollection)}>
            Create Collection
          </button>
          <button type="button" className="sidebarPlusMenuItem" role="menuitem" onClick={() => run(props.onCreateFolder)}>
            Create Folder
          </button>
        </div>
      ) : null}
    </div>
  )
}
