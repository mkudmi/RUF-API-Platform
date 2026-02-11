import { useEffect, useMemo, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

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

export function JsonCodeEditor(props: Props) {
  const { value, onChangeValue, onSubmitShortcut } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [editorHeight, setEditorHeight] = useState(() => {
    const measured = measureDefaultBodyTextareaHeight()
    return measured > 0 ? measured : 320
  })

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
      if (!update.docChanged) return
      onChangeValue(update.state.doc.toString())
    }),
  ], [onChangeValue, onSubmitShortcut])

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

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [extensions])

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
      {IS_MAC ? <div className="bodyResizeHandle" onPointerDown={onResizeHandlePointerDown} /> : null}
    </div>
  )
}
