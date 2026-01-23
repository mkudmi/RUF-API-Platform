import { useEffect, useRef, useState } from 'react'

export function SidebarCreateMenu(props: {
  onImport: () => void
  onCreateCollection: () => void
  onCreateFolder: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const el = wrapRef.current
      if (!el) return
      const target = e.target as Node | null
      if (!target) return
      if (el.contains(target)) return
      setOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={wrapRef} className="sidebarPlusWrap">
      <button
        type="button"
        className="sidebarPlusBtn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create"
        title="Create"
      >
        <span className="sidebarPlusGlyph" aria-hidden="true">+</span>
      </button>

      {open ? (
        <div className="sidebarPlusMenu" role="menu" aria-label="Create menu">
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
