import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

type ValueHistoryOption<T extends string | number> = {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
  right?: ReactNode
}

type ValueHistorySelectProps<T extends string | number> = {
  value: T
  valueLabel: string
  ariaLabel: string
  title?: string
  options: ValueHistoryOption<T>[]
  onChange: (next: T) => void
  panelPosition?: 'absolute' | 'fixed'
  panelClassName?: string
  panelStyle?: CSSProperties
  panelZIndex?: number
  inputClassName?: string
  inputStyle?: CSSProperties
  anchorProps?: HTMLAttributes<HTMLDivElement>
  valueAdornment?: ReactNode
}

type FixedAnchor = { left: number; top: number; width: number }

export function ValueHistorySelect<T extends string | number>(props: ValueHistorySelectProps<T>) {
  const {
    value,
    valueLabel,
    ariaLabel,
    title,
    options,
    onChange,
    panelPosition = 'absolute',
    panelClassName = 'selectMenuPanel valueHistoryPanel',
    panelStyle,
    panelZIndex = 220,
    inputClassName = 'mono valueHistoryInput',
    inputStyle,
    anchorProps,
    valueAdornment,
  } = props

  const [open, setOpen] = useState(false)
  const [fixedAnchor, setFixedAnchor] = useState<FixedAnchor | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  const panelComputedStyle = useMemo<CSSProperties>(() => {
    if (panelPosition === 'fixed') {
      return {
        position: 'fixed',
        left: fixedAnchor?.left ?? 0,
        top: fixedAnchor?.top ?? 0,
        width: fixedAnchor?.width ?? 240,
        zIndex: panelZIndex,
        ...panelStyle,
      }
    }
    return {
      position: 'absolute',
      left: 0,
      top: 'calc(100% + 6px)',
      width: '100%',
      zIndex: panelZIndex,
      ...panelStyle,
    }
  }, [fixedAnchor?.left, fixedAnchor?.top, fixedAnchor?.width, panelPosition, panelStyle, panelZIndex])

  function updateFixedAnchor() {
    if (panelPosition !== 'fixed') return
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setFixedAnchor({ left: rect.left, top: rect.bottom + 6, width: rect.width })
  }

  function toggle() {
    setOpen(prev => {
      const next = !prev
      if (next) updateFixedAnchor()
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open || panelPosition !== 'fixed') return
    function onRelayout() {
      updateFixedAnchor()
    }
    window.addEventListener('resize', onRelayout)
    window.addEventListener('scroll', onRelayout, true)
    return () => {
      window.removeEventListener('resize', onRelayout)
      window.removeEventListener('scroll', onRelayout, true)
    }
  }, [open, panelPosition])

  return (
    <div ref={anchorRef} style={{ position: 'relative' }} {...anchorProps}>
      <input
        className={inputClassName}
        readOnly
        aria-readonly="true"
        aria-label={ariaLabel}
        value={valueLabel}
        style={{ width: '100%', boxSizing: 'border-box', ...inputStyle }}
        onClick={() => toggle()}
      />
      {valueAdornment ? (
        <span aria-hidden="true" style={{ position: 'absolute', right: 38, top: '50%', transform: 'translateY(-50%)' }}>
          {valueAdornment}
        </span>
      ) : null}
      <button
        type="button"
        className="valueHistoryBtn"
        aria-label={ariaLabel}
        title={title || ariaLabel}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          toggle()
        }}
      >
        ▾
      </button>
      {open ? (
        <div
          className={panelClassName}
          ref={panelRef}
          role="menu"
          style={panelComputedStyle}
          onPointerDown={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {options.map(option => {
            const isActive = option.value === value
            return (
              <button
                key={String(option.value)}
                type="button"
                className={`selectMenuItem ${isActive ? 'selectMenuItemActive' : ''}`}
                role="menuitemradio"
                aria-checked={isActive}
                title={option.title}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.right ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div className="mono">{option.label}</div>
                    {option.right}
                  </div>
                ) : (
                  <div className="mono">{option.label}</div>
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
