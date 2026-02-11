import { forwardRef, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { VariableSuggestion } from '../utils/variables'
import { useDismissibleLayer } from '../hooks/useDismissibleLayer'
import { logWarn } from '../utils/logger'

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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function getCaretAnchorRect(
  el: HTMLInputElement | HTMLTextAreaElement,
  cursor: number,
  mirrorEl: HTMLDivElement,
): DOMRect | null {
  try {
    const cs = window.getComputedStyle(el)
    const isTextarea = el.tagName.toLowerCase() === 'textarea'

    const rect = el.getBoundingClientRect()
    mirrorEl.style.position = 'fixed'
    mirrorEl.style.left = `${Math.round(rect.left)}px`
    mirrorEl.style.top = `${Math.round(rect.top)}px`
    mirrorEl.style.width = `${Math.round(rect.width)}px`
    mirrorEl.style.height = `${Math.round(rect.height)}px`
    mirrorEl.style.visibility = 'hidden'
    mirrorEl.style.pointerEvents = 'none'
    mirrorEl.style.overflow = 'hidden'
    mirrorEl.style.whiteSpace = isTextarea ? 'pre-wrap' : 'pre'
    mirrorEl.style.wordWrap = 'break-word'
    mirrorEl.style.overflowWrap = 'break-word'
    mirrorEl.style.boxSizing = cs.boxSizing
    mirrorEl.style.border = cs.border
    mirrorEl.style.padding = cs.padding
    mirrorEl.style.font = cs.font
    mirrorEl.style.letterSpacing = cs.letterSpacing
    mirrorEl.style.textTransform = cs.textTransform
    mirrorEl.style.textIndent = cs.textIndent
    mirrorEl.style.lineHeight = cs.lineHeight
    mirrorEl.style.tabSize = (cs as any).tabSize ?? '4'

    const before = el.value.slice(0, cursor)
    const after = el.value.slice(cursor) || '\u200b'

    mirrorEl.textContent = ''
    const beforeSpan = document.createElement('span')
    beforeSpan.textContent = before
    const caretSpan = document.createElement('span')
    caretSpan.textContent = '\u200b'
    const afterSpan = document.createElement('span')
    afterSpan.textContent = after
    mirrorEl.appendChild(beforeSpan)
    mirrorEl.appendChild(caretSpan)
    mirrorEl.appendChild(afterSpan)

    mirrorEl.scrollTop = (el as HTMLTextAreaElement).scrollTop ?? 0
    mirrorEl.scrollLeft = (el as HTMLTextAreaElement).scrollLeft ?? 0

    const caretRect = caretSpan.getBoundingClientRect()
    return caretRect
  } catch (error) {
    logWarn('VariableAutocompleteField.getCaretAnchorRect', 'Failed to compute caret anchor rect', { error })
    return null
  }
}

export const VariableAutocompleteField = forwardRef<HTMLInputElement | HTMLTextAreaElement, Props>(
  function VariableAutocompleteField(props, forwardedRef) {
    const { as: asProp, value, onChangeValue, suggestions, onBlur, onKeyDown, onClick, onFocus, onKeyUp, ...rest } = props
    const as = asProp ?? 'input'
    const { className, style, ...restProps } = rest

    const rootRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
    const menuPanelRef = useRef<HTMLDivElement | null>(null)
    const mirrorRef = useRef<HTMLDivElement | null>(null)
    const lastCursorRef = useRef<number>(0)
    const setRefs = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputRef.current = el
      if (typeof forwardedRef === 'function') forwardedRef(el)
      else if (forwardedRef) (forwardedRef as any).current = el
    }

    const pendingSelectionRef = useRef<PendingSelection | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [anchor, setAnchor] = useState<{ left: number, top: number, width: number, caretTop: number, caretBottom: number }>({
      left: 0,
      top: 0,
      width: 320,
      caretTop: 0,
      caretBottom: 0,
    })
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)

    const filtered = useMemo(() => {
      const needle = query.trim().toLowerCase()
      const items = needle
        ? suggestions.filter(s => s.name.toLowerCase().includes(needle))
        : suggestions
      return items
    }, [query, suggestions])

    function ensureMirrorEl(): HTMLDivElement {
      if (mirrorRef.current) return mirrorRef.current
      const div = document.createElement('div')
      div.setAttribute('data-var-mirror', '1')
      document.body.appendChild(div)
      mirrorRef.current = div
      return div
    }

    function updateAnchorFromEl(el: HTMLInputElement | HTMLTextAreaElement, cursor: number) {
      const r = el.getBoundingClientRect()
      const mirrorEl = ensureMirrorEl()
      const caretRect = getCaretAnchorRect(el, cursor, mirrorEl)
      const baseRect = caretRect ?? r

      const margin = 8
      const maxWidth = Math.max(220, window.innerWidth - margin * 2)
      const width = clamp(320, 220, maxWidth)
      const left = clamp(Math.round(baseRect.left), margin, Math.max(margin, window.innerWidth - width - margin))
      const caretTop = Math.round(baseRect.top)
      const caretBottom = Math.round(baseRect.bottom)
      const desiredTop = Math.round(baseRect.bottom + 6)
      const top = clamp(desiredTop, margin, Math.max(margin, window.innerHeight - margin))

      setAnchor({ left, top, width, caretTop, caretBottom })
    }

    function updateMenuFromEl(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string) {
      const cursor = el.selectionStart ?? nextValue.length
      lastCursorRef.current = cursor
      const token = computeToken(nextValue, cursor)
      if (!token) {
        setMenuOpen(false)
        setQuery('')
        return
      }

      updateAnchorFromEl(el, cursor)
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
      } catch (error) {
        logWarn('VariableAutocompleteField.setSelectionRange', 'Failed to restore text selection', { error })
      }
    }, [value])

    useDismissibleLayer({
      open: menuOpen,
      onDismiss: () => setMenuOpen(false),
      isInsideTarget: target => {
        const wrap = rootRef.current
        return !!(target && wrap && wrap.contains(target))
      },
    })

    useEffect(() => {
      if (!menuOpen) return

      function onGlobalScrollOrResize() {
        const el = inputRef.current
        if (!el) return
        updateAnchorFromEl(el, lastCursorRef.current)
      }

      window.addEventListener('scroll', onGlobalScrollOrResize, true)
      window.addEventListener('resize', onGlobalScrollOrResize)
      return () => {
        window.removeEventListener('scroll', onGlobalScrollOrResize, true)
        window.removeEventListener('resize', onGlobalScrollOrResize)
      }
    }, [menuOpen])

    useEffect(() => {
      return () => {
        const m = mirrorRef.current
        mirrorRef.current = null
        if (m && m.parentNode) m.parentNode.removeChild(m)
      }
    }, [])

    useEffect(() => {
      if (!menuOpen) return
      const panel = menuPanelRef.current
      if (!panel) return
      const el = panel.querySelector<HTMLElement>(`[data-var-idx="${activeIndex}"]`)
      if (!el) return
      try {
        el.scrollIntoView({ block: 'nearest' })
      } catch (error) {
        logWarn('VariableAutocompleteField.scrollIntoView', 'Failed to ensure active suggestion visibility', { error })
      }
    }, [activeIndex, menuOpen])

    useEffect(() => {
      if (!menuOpen) return
      const panel = menuPanelRef.current
      if (!panel) return

      const margin = 8
      const rect = panel.getBoundingClientRect()

      let nextLeft = anchor.left
      let nextTop = anchor.top

      if (rect.right > window.innerWidth - margin) nextLeft = Math.max(margin, window.innerWidth - margin - rect.width)
      if (rect.left < margin) nextLeft = margin

      const overflowBottom = rect.bottom - (window.innerHeight - margin)
      if (overflowBottom > 0) {
        const aboveTop = anchor.caretTop - 6 - rect.height
        if (aboveTop >= margin) nextTop = aboveTop
        else nextTop = Math.max(margin, window.innerHeight - margin - rect.height)
      }
      if (rect.top < margin) nextTop = margin

      if (nextLeft !== anchor.left || nextTop !== anchor.top) {
        setAnchor(prev => {
          if (prev.left === nextLeft && prev.top === nextTop) return prev
          return { ...prev, left: nextLeft, top: nextTop }
        })
      }
    }, [anchor.left, anchor.top, anchor.caretTop, menuOpen])

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
        const currentValue = String((e?.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '')
        if (currentValue !== value) onChangeValue(currentValue)
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
