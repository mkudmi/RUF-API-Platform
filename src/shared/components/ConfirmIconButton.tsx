import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export function ConfirmIconButton(props: {
  className: string
  onConfirm: () => void
  disabled?: boolean
  ariaLabel: string
  confirmAriaLabel?: string
  title?: string
  confirmTitle?: string
  icon: ReactNode
  timeoutMs?: number
  style?: CSSProperties
}) {
  const timeoutMs = props.timeoutMs ?? 5500
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!armed) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setArmed(false), timeoutMs)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [armed, timeoutMs])

  useEffect(() => {
    if (!armed) return

    function onGlobalPointerDown(e: PointerEvent) {
      const el = btnRef.current
      if (!el) return
      const target = e.target as Node | null
      if (target && el.contains(target)) return
      setArmed(false)
    }

    window.addEventListener('pointerdown', onGlobalPointerDown, true)
    return () => window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  }, [armed])

  return (
    <button
      type="button"
      className={`${props.className} ${armed ? 'confirmActionArmed' : ''}`.trim()}
      disabled={props.disabled}
      aria-disabled={props.disabled}
      aria-label={armed ? (props.confirmAriaLabel ?? props.ariaLabel) : props.ariaLabel}
      title={armed ? (props.confirmTitle ?? props.title) : props.title}
      ref={btnRef}
      style={props.style}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (props.disabled) return
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        props.onConfirm()
      }}
    >
      {armed ? <span className="confirmActionGlyph">!</span> : props.icon}
    </button>
  )
}
