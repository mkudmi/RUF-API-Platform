import { useEffect, useMemo, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { getVariableCompletions, type VariableCompletion, type VariableSuggestion } from '../../../../shared/utils/variables'
import { logWarn } from '../../../../shared/utils/logger'

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, class: 'cm-json-key' },
  { tag: tags.number, class: 'cm-json-number' },
  { tag: tags.string, class: 'cm-json-string' },
  { tag: tags.bool, class: 'cm-json-boolean' },
  { tag: tags.null, class: 'cm-json-null' },
  { tag: [tags.separator, tags.punctuation, tags.brace, tags.squareBracket], class: 'cm-json-punctuation' },
])

const jsonEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    marginTop: '10px',
    marginBottom: '6px',
    background: 'rgba(255,255,255,.06)',
    color: '#e8e8e8',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.2',
    resize: 'vertical',
    overflow: 'auto',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    height: '100%',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '10px',
    caretColor: '#f5f7ff',
    lineHeight: 'inherit',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-activeLine': {
    background: 'transparent',
  },
  '.cm-activeLineGutter': {
    background: 'transparent',
  },
  '&.cm-focused': {
    outline: '2px solid rgba(255,255,255,.20)',
    outlineOffset: '2px',
    borderRadius: '6px',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(127, 216, 255, 0.30) !important',
  },
  '.cm-content .cm-json-key': {
    color: '#7fd8ff !important',
  },
  '.cm-content .cm-json-number': {
    color: '#a9f5a9 !important',
  },
  '.cm-content .cm-json-string': {
    color: '#ffb46a !important',
  },
  '.cm-content .cm-json-boolean': {
    color: '#ff8ec2 !important',
  },
  '.cm-content .cm-json-null': {
    color: '#b8c0cc !important',
  },
  '.cm-content .cm-json-punctuation': {
    color: '#c7d2fe !important',
  },
})

type Props = {
  value: string
  onChangeValue: (next: string) => void
  onSubmitShortcut?: () => void
  variableSuggestions: VariableSuggestion[]
  variables?: Record<string, string>
}

const IS_MAC = typeof navigator !== 'undefined'
  && (
    (navigator.platform || '').toLowerCase().includes('mac')
    || navigator.userAgent.toLowerCase().includes('mac os')
  )

function measureDefaultBodyTextareaHeight() {
  const probe = document.createElement('textarea')
  probe.className = 'mono editorTextarea'
  probe.rows = 18
  probe.value = ''
  probe.setAttribute('aria-hidden', 'true')
  probe.style.position = 'fixed'
  probe.style.left = '-9999px'
  probe.style.top = '-9999px'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)
  const h = probe.offsetHeight
  document.body.removeChild(probe)
  return h
}

function isInsideJsonString(doc: string, pos: number): boolean {
  let inString = false
  for (let i = 0; i < pos; i++) {
    if (doc[i] !== '"') continue
    let slashCount = 0
    for (let j = i - 1; j >= 0 && doc[j] === '\\'; j--) slashCount++
    if (slashCount % 2 === 1) continue
    inString = !inString
  }
  return inString
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function computeVariableToken(value: string, cursor: number): { start: number, query: string } | null {
  const before = value.slice(0, cursor)
  const start = before.lastIndexOf('{{')
  if (start < 0) return null
  const closeIdx = before.indexOf('}}', start + 2)
  if (closeIdx >= 0) return null
  return { start, query: before.slice(start + 2) }
}

function getSuggestionSelectionRange(name: string, tokenStart: number, placeholderOffset: number): { anchor: number, head: number } | null {
  if (name === 'random.string(length)') {
    const param = 'length'
    const offset = name.indexOf(param)
    if (offset >= 0) {
      const start = tokenStart + placeholderOffset + 2 + offset
      return { anchor: start, head: start + param.length }
    }
  }
  return null
}

export function JsonCodeEditor(props: Props) {
  const { value, onChangeValue, onSubmitShortcut, variableSuggestions, variables = {} } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const menuOpenRef = useRef(false)
  const filteredRef = useRef<VariableCompletion[]>([])
  const activeIndexRef = useRef(0)
  const caretPosRef = useRef(0)
  const [editorHeight, setEditorHeight] = useState(() => {
    const measured = measureDefaultBodyTextareaHeight()
    return measured > 0 ? measured : 320
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchor, setAnchor] = useState({ left: 0, top: 0, width: 320, caretTop: 0, caretBottom: 0 })

  const filtered = useMemo<VariableCompletion[]>(() => {
    const completions = getVariableCompletions(query, variables)
    if (query.trim() || completions.length !== variableSuggestions.length) return completions
    return variableSuggestions
  }, [query, variableSuggestions, variables])

  useEffect(() => {
    menuOpenRef.current = menuOpen
  }, [menuOpen])

  useEffect(() => {
    filteredRef.current = filtered
  }, [filtered])

  useEffect(() => {
    const max = Math.max(0, filtered.length - 1)
    setActiveIndex(prev => Math.min(prev, max))
  }, [filtered.length])

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  const updateAnchorFromPos = useCallback((view: EditorView, pos: number) => {
    const rect = view.coordsAtPos(pos)
    if (!rect) return
    const margin = 8
    const maxWidth = Math.max(220, window.innerWidth - margin * 2)
    const width = clamp(320, 220, maxWidth)
    const left = clamp(Math.round(rect.left), margin, Math.max(margin, window.innerWidth - width - margin))
    const caretTop = Math.round(rect.top)
    const caretBottom = Math.round(rect.bottom)
    const desiredTop = Math.round(rect.bottom + 6)
    const top = clamp(desiredTop, margin, Math.max(margin, window.innerHeight - margin))
    setAnchor(prev => {
      const next = { left, top, width, caretTop, caretBottom }
      if (
        prev.left === next.left
        && prev.top === next.top
        && prev.width === next.width
        && prev.caretTop === next.caretTop
        && prev.caretBottom === next.caretBottom
      ) return prev
      return next
    })
  }, [])

  const updateVariableMenuFromView = useCallback((view: EditorView) => {
    const doc = view.state.doc.toString()
    const pos = view.state.selection.main.head
    caretPosRef.current = pos
    const token = computeVariableToken(doc, pos)
    if (!token) {
      setMenuOpen(false)
      setQuery('')
      return
    }
    if (/\s/.test(token.query) || token.query.includes('{') || token.query.includes('}')) {
      setMenuOpen(false)
      setQuery('')
      return
    }

    updateAnchorFromPos(view, pos)
    setQuery(prev => {
      if (prev !== token.query) setActiveIndex(0)
      return token.query
    })
    setMenuOpen(true)
  }, [updateAnchorFromPos])

  const applySuggestion = useCallback((name: string) => {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc.toString()
    const pos = view.state.selection.main.head
    const token = computeVariableToken(doc, pos)
    if (!token) return

    const hasClosing = doc.slice(pos, pos + 2) === '}}'
    const tokenEnd = hasClosing ? pos + 2 : pos
    const placeholder = `{{${name}}}`
    const insideJsonString = isInsideJsonString(doc, token.start)
    const insert = insideJsonString ? placeholder : `"${placeholder}"`
    const anchorPos = token.start + insert.length
    const selection = getSuggestionSelectionRange(name, token.start, insideJsonString ? 0 : 1)

    view.dispatch({
      changes: { from: token.start, to: tokenEnd, insert },
      selection: selection ?? { anchor: anchorPos },
    })
    view.focus()
    setMenuOpen(false)
    setQuery('')
  }, [])

  const extensions = useMemo(() => [
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onSubmitShortcut?.()
          return true
        },
        preventDefault: true,
      },
      {
        key: 'ArrowDown',
        run: () => {
          if (!menuOpenRef.current || !filteredRef.current.length) return false
          setActiveIndex(i => (i + 1) % filteredRef.current.length)
          return true
        },
        preventDefault: true,
      },
      {
        key: 'ArrowUp',
        run: () => {
          if (!menuOpenRef.current || !filteredRef.current.length) return false
          setActiveIndex(i => (i - 1 + filteredRef.current.length) % filteredRef.current.length)
          return true
        },
        preventDefault: true,
      },
      {
        key: 'Enter',
        run: () => {
          if (!menuOpenRef.current) return false
          const picked = filteredRef.current[activeIndexRef.current]
          if (!picked) return true
          applySuggestion(picked.name)
          return true
        },
        preventDefault: true,
      },
      {
        key: 'Tab',
        run: () => {
          if (!menuOpenRef.current) return false
          const picked = filteredRef.current[activeIndexRef.current]
          if (!picked) return true
          applySuggestion(picked.name)
          return true
        },
        preventDefault: true,
      },
      {
        key: 'Escape',
        run: () => {
          if (!menuOpenRef.current) return false
          setMenuOpen(false)
          return true
        },
        preventDefault: true,
      },
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    json(),
    syntaxHighlighting(jsonHighlightStyle),
    jsonEditorTheme,
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChangeValue(update.state.doc.toString())
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        if (!update.view.hasFocus) {
          setMenuOpen(false)
          return
        }
        updateVariableMenuFromView(update.view)
      }
    }),
  ], [applySuggestion, onChangeValue, onSubmitShortcut, updateVariableMenuFromView])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const state = EditorState.create({
      doc: value ?? '',
      extensions,
    })
    const view = new EditorView({
      state,
      parent: root,
    })
    view.dom.classList.add('mono')
    view.dom.style.height = `${editorHeight}px`
    if (IS_MAC) view.dom.style.resize = 'none'
    viewRef.current = view
    updateVariableMenuFromView(view)

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [extensions, updateVariableMenuFromView])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dom.style.height = `${editorHeight}px`
  }, [editorHeight])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value ?? '' },
    })
  }, [value])

  useEffect(() => {
    if (!menuOpen) return
    const view = viewRef.current
    if (!view) return

    function onGlobalScrollOrResize() {
      const currentView = viewRef.current
      if (!currentView) return
      updateAnchorFromPos(currentView, caretPosRef.current)
    }

    window.addEventListener('scroll', onGlobalScrollOrResize, true)
    window.addEventListener('resize', onGlobalScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onGlobalScrollOrResize, true)
      window.removeEventListener('resize', onGlobalScrollOrResize)
    }
  }, [menuOpen, updateAnchorFromPos])

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
  }, [anchor.caretTop, anchor.left, anchor.top, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const panel = menuPanelRef.current
    if (!panel) return
    const el = panel.querySelector<HTMLElement>(`[data-var-idx="${activeIndex}"]`)
    if (!el) return
    try {
      el.scrollIntoView({ block: 'nearest' })
    } catch (error) {
      logWarn('JsonCodeEditor.scrollIntoView', 'Failed to scroll active variable suggestion into view', {
        error,
        activeIndex,
      })
    }
  }, [activeIndex, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      const root = rootRef.current
      const panel = menuPanelRef.current
      if (target && root && root.contains(target)) return
      if (target && panel && panel.contains(target)) return
      setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const onResizeHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!IS_MAC) return
    e.preventDefault()
    const startY = e.clientY
    const startHeight = editorHeight
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const next = Math.max(140, startHeight + (ev.clientY - startY))
      setEditorHeight(next)
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [editorHeight])

  return (
    <div>
      <div ref={rootRef} />
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
                key={`${s.kind}:${s.insertName ?? s.name}`}
                type="button"
                className={`selectMenuItem ${idx === activeIndex ? 'selectMenuItemActive' : ''}`}
                role="menuitem"
                data-var-idx={idx}
                onClick={() => applySuggestion(s.insertName ?? s.name)}
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
      {IS_MAC ? <div className="bodyResizeHandle" onPointerDown={onResizeHandlePointerDown} /> : null}
    </div>
  )
}
