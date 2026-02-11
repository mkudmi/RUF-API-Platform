import { useEffect } from 'react'

export function useDismissibleLayer(args: {
  open: boolean
  onDismiss: () => void
  isInsideTarget?: (target: Node | null) => boolean
  capturePointerDown?: boolean
}) {
  const { open, onDismiss, isInsideTarget, capturePointerDown } = args

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (isInsideTarget?.(target) === true) return
      onDismiss()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }

    window.addEventListener('pointerdown', onPointerDown, capturePointerDown === true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, capturePointerDown === true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [capturePointerDown, isInsideTarget, onDismiss, open])
}
