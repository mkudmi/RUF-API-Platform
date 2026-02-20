import { useEffect, useMemo, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { tags } from '@lezer/highlight'

const jsHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'cm-js-keyword' },
  { tag: tags.comment, class: 'cm-js-comment' },
  { tag: tags.string, class: 'cm-js-string' },
  { tag: tags.number, class: 'cm-js-number' },
  { tag: tags.bool, class: 'cm-js-boolean' },
  { tag: tags.null, class: 'cm-js-null' },
  { tag: tags.variableName, class: 'cm-js-variable' },
  { tag: tags.function(tags.variableName), class: 'cm-js-function' },
  { tag: tags.operator, class: 'cm-js-operator' },
  { tag: [tags.separator, tags.punctuation, tags.brace, tags.squareBracket, tags.paren], class: 'cm-js-punctuation' },
])

const jsEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    background: 'rgba(255,255,255,.06)',
    color: '#e8e8e8',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.35',
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
  '.cm-content .cm-js-keyword': {
    color: '#9ecbff !important',
  },
  '.cm-content .cm-js-comment': {
    color: '#8aa0b8 !important',
  },
  '.cm-content .cm-js-string': {
    color: '#ffb46a !important',
  },
  '.cm-content .cm-js-number': {
    color: '#a9f5a9 !important',
  },
  '.cm-content .cm-js-boolean': {
    color: '#ff8ec2 !important',
  },
  '.cm-content .cm-js-null': {
    color: '#b8c0cc !important',
  },
  '.cm-content .cm-js-variable': {
    color: '#e6edf7 !important',
  },
  '.cm-content .cm-js-function': {
    color: '#7fd8ff !important',
  },
  '.cm-content .cm-js-operator': {
    color: '#d7c8ff !important',
  },
  '.cm-content .cm-js-punctuation': {
    color: '#c7d2fe !important',
  },
  '.cm-cursorLayer': {
    display: 'none !important',
  },
  '.cm-dropCursor': {
    display: 'none !important',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    background: 'transparent !important',
    outline: 'none !important',
    border: '0 !important',
    color: 'inherit !important',
  },
})

const OPEN_TO_CLOSE: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
}

function shouldAutoPairByNextChar(nextChar: string): boolean {
  if (!nextChar) return true
  if (/\s/.test(nextChar)) return true
  if (/[)\]},;:.]/.test(nextChar)) return true
  return false
}

function handleOpenPair(view: EditorView, open: string): boolean {
  const close = OPEN_TO_CLOSE[open]
  if (!close) return false
  const sel = view.state.selection.main
  const doc = view.state.doc.toString()

  if (!sel.empty) {
    const selected = doc.slice(sel.from, sel.to)
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${open}${selected}${close}` },
      selection: { anchor: sel.from + selected.length + 2 },
    })
    return true
  }

  const head = sel.head
  const next = doc.slice(head, head + 1)
  if (!shouldAutoPairByNextChar(next)) {
    view.dispatch({
      changes: { from: head, to: head, insert: open },
      selection: { anchor: head + 1 },
    })
    return true
  }

  view.dispatch({
    changes: { from: head, to: head, insert: `${open}${close}` },
    selection: { anchor: head + 1 },
  })
  return true
}

function handleClosePair(view: EditorView, close: string): boolean {
  const sel = view.state.selection.main
  const doc = view.state.doc.toString()
  const head = sel.head

  if (!sel.empty) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: close },
      selection: { anchor: sel.from + 1 },
    })
    return true
  }

  const next = doc.slice(head, head + 1)
  if (next === close) {
    view.dispatch({ selection: { anchor: head + 1 } })
    return true
  }

  view.dispatch({
    changes: { from: head, to: head, insert: close },
    selection: { anchor: head + 1 },
  })
  return true
}

function handleSmartBackspace(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const doc = view.state.doc.toString()
  const head = sel.head
  if (head <= 0 || head >= doc.length) return false
  const prev = doc[head - 1]
  const next = doc[head]
  if (!prev || !next) return false
  if (OPEN_TO_CLOSE[prev] !== next) return false

  view.dispatch({
    changes: { from: head - 1, to: head + 1, insert: '' },
    selection: { anchor: head - 1 },
  })
  return true
}

export function JsCodeEditor(props: {
  value: string
  onChangeValue: (next: string) => void
  minHeight?: number
}) {
  const { value } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(props.onChangeValue)
  const minHeight = props.minHeight ?? 220

  useEffect(() => {
    onChangeRef.current = props.onChangeValue
  }, [props.onChangeValue])

  const extensions = useMemo(() => [
    history(),
    indentOnInput(),
    keymap.of([
      { key: '(', run: view => handleOpenPair(view, '('), preventDefault: true },
      { key: '[', run: view => handleOpenPair(view, '['), preventDefault: true },
      { key: '{', run: view => handleOpenPair(view, '{'), preventDefault: true },
      { key: '"', run: view => handleOpenPair(view, '"'), preventDefault: true },
      { key: "'", run: view => handleOpenPair(view, "'"), preventDefault: true },
      { key: '`', run: view => handleOpenPair(view, '`'), preventDefault: true },
      { key: ')', run: view => handleClosePair(view, ')'), preventDefault: true },
      { key: ']', run: view => handleClosePair(view, ']'), preventDefault: true },
      { key: '}', run: view => handleClosePair(view, '}'), preventDefault: true },
      { key: 'Backspace', run: view => handleSmartBackspace(view), preventDefault: false },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    javascript({ typescript: false, jsx: false }),
    syntaxHighlighting(jsHighlightStyle),
    jsEditorTheme,
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString())
    }),
  ], [])

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
    view.dom.style.minHeight = `${Math.max(140, minHeight)}px`
    view.dom.style.height = `${Math.max(140, minHeight)}px`
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [extensions, minHeight])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value ?? '' },
    })
  }, [value])

  return <div ref={rootRef} />
}
