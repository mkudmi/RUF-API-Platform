import { forwardRef, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { VariableSuggestion } from '../shared/utils/variables'

type BaseProps = {
  value: string
  onChangeValue: (next: string) => void
  suggestions: VariableSuggestion[]
}

type InputProps = BaseProps & {
  as?: 'input'
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

type TextareaProps = BaseProps & {
  as: 'textarea'
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>

type Props = InputProps | TextareaProps

type PendingSelection = { start: number, end: number }

function computeToken(value: string, cursor: number): { start: number, query: string } | null {
  const before = value.slice(0, cursor)
  const start = before.lastIndexOf('{{')
  if (start < 0) return null
  const closeIdx = before.indexOf('}}', start + 2)
  if (closeIdx >= 0) return null
  return { start, query: before.slice(start + 2) }
}

export const VariableAutocompleteField = forwardRef<HTMLInputElement | HTMLTextAreaElement, Props>(
  function VariableAutocompleteField(props, forwardedRef) {
    const { as: asProp, value, onChangeValue, suggestions, onBlur, onKeyDown, onClick, onFocus, onKeyUp, ...rest } = props
    const as = asProp ?? 'input'
    const { className, style, ...restProps } = rest

    const rootRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
    const menuPanelRef = useRef<HTMLDivElement | null>(null)
    const setRefs = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputRef.current = el
      if (typeof forwardedRef === 'function') forwardedRef(el)
      else if (forwardedRef) (forwardedRef as any).current = el
    }

    const pendingSelectionRef = useRef<PendingSelection | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [anchor, setAnchor] = useState<{ left: number, top: number, width: number }>({ left: 0, top: 0, width: 240 })
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)

    const filtered = useMemo(() => {
      const needle = query.trim().toLowerCase()
      const items = needle
        ? suggestions.filter(s => s.name.toLowerCase().includes(needle))
        : suggestions
      return items
    }, [query, suggestions])

    function updateAnchorFromEl(el: HTMLInputElement | HTMLTextAreaElement) {
      const r = el.getBoundingClientRect()
      setAnchor({
        left: Math.round(r.left),
        top: Math.round(r.bottom + 6),
        width: Math.round(r.width),
      })
    }

    function updateMenuFromEl(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string) {
      const cursor = el.selectionStart ?? nextValue.length
      const token = computeToken(nextValue, cursor)
      if (!token) {
        setMenuOpen(false)
        setQuery('')
        return
      }

      updateAnchorFromEl(el)
      setQuery(token.query)
      setActiveIndex(0)
      setMenuOpen(true)
    }

    function applySuggestion(name: string) {
      const el = inputRef.current
      if (!el) return
      const cursor = el.selectionStart ?? value.length
      const token = computeToken(value, cursor)
      if (!token) return

      const after = value.slice(cursor)
      const hasClosing = after.startsWith('}}')
      const insert = hasClosing ? `{{${name}` : `{{${name}}}`
      const nextValue = value.slice(0, token.start) + insert + after
      const nextCursor = token.start + insert.length + (hasClosing ? 2 : 0)

      pendingSelectionRef.current = { start: nextCursor, end: nextCursor }
      setMenuOpen(false)
      setQuery('')
      onChangeValue(nextValue)
    }

    useEffect(() => {
      const pending = pendingSelectionRef.current
      if (!pending) return
      const el = inputRef.current
      if (!el) return
      pendingSelectionRef.current = null
      try {
        el.setSelectionRange(pending.start, pending.end)
      } catch {
        // ignore
      }
    }, [value])

    useEffect(() => {
      if (!menuOpen) return

      function onPointerDown(e: PointerEvent) {
        const t = e.target as Node | null
        const wrap = rootRef.current
        if (t && wrap && wrap.contains(t)) return
        setMenuOpen(false)
      }

      function onGlobalScrollOrResize() {
        const el = inputRef.current
        if (!el) return
        updateAnchorFromEl(el)
      }

      window.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('scroll', onGlobalScrollOrResize, true)
      window.addEventListener('resize', onGlobalScrollOrResize)
      return () => {
        window.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('scroll', onGlobalScrollOrResize, true)
        window.removeEventListener('resize', onGlobalScrollOrResize)
      }
    }, [menuOpen])

    useEffect(() => {
      if (!menuOpen) return
      const panel = menuPanelRef.current
      if (!panel) return
      const el = panel.querySelector<HTMLElement>(`[data-var-idx="${activeIndex}"]`)
      if (!el) return
      try {
        el.scrollIntoView({ block: 'nearest' })
      } catch {
        // ignore
      }
    }, [activeIndex, menuOpen])

    const commonHandlers = {
      ref: setRefs as any,
      value,
      onChange: (e: any) => {
        const next = String(e.target.value ?? '')
        onChangeValue(next)
        updateMenuFromEl(e.target, next)
      },
      onFocus: (e: any) => {
        onFocus?.(e)
        updateMenuFromEl(e.target, String(e.target.value ?? ''))
      },
      onClick: (e: any) => {
        onClick?.(e)
        updateMenuFromEl(e.target, String(e.target.value ?? ''))
      },
      onKeyUp: (e: any) => {
        onKeyUp?.(e)
        if (
          e?.key === 'ArrowDown' ||
          e?.key === 'ArrowUp' ||
          e?.key === 'Enter' ||
          e?.key === 'Tab' ||
          e?.key === 'Escape'
        ) return
        updateMenuFromEl(e.target, String(e.target.value ?? ''))
      },
      onKeyDown: (e: any) => {
        if (menuOpen) {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setMenuOpen(false)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : 0))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0))
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            const picked = filtered[activeIndex]
            if (picked) {
              e.preventDefault()
              e.stopPropagation()
              applySuggestion(picked.name)
              return
            }
          }
        }

        onKeyDown?.(e)
      },
      onBlur: (e: any) => {
        onBlur?.(e)
        setTimeout(() => setMenuOpen(false), 0)
      },
    }

    return (
      <div ref={rootRef} style={{ position: 'relative', width: '100%', ...(style as any) }}>
        {as === 'textarea' ? (
          <textarea
            {...(restProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...commonHandlers}
            className={className}
            style={{ width: '100%' }}
          />
        ) : (
          <input
            {...(restProps as InputHTMLAttributes<HTMLInputElement>)}
            {...commonHandlers}
            className={className}
            style={{ width: '100%' }}
          />
        )}

        {menuOpen ? (
          <div
            className="selectMenuPanel varMenuPanel"
            ref={menuPanelRef}
            role="menu"
            style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: anchor.width, zIndex: 200 }}
            onPointerDown={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {filtered.length ? (
              filtered.map((s, idx) => (
                <button
                  key={`${s.kind}:${s.name}`}
                  type="button"
                  className={`selectMenuItem ${idx === activeIndex ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  data-var-idx={idx}
                  onClick={() => applySuggestion(s.name)}
                >
                  <div className="varMenuItem">
                    <div className="mono">{s.name}</div>
                    {s.description ? <div className="varMenuDesc">{s.description}</div> : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="varMenuEmpty small">No variables</div>
            )}
          </div>
        ) : null}
      </div>
    )
  },
)
