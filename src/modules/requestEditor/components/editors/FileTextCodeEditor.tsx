import { useEffect, useMemo, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { tags } from '@lezer/highlight'
import type { BeautifyBodyFormat } from '../../utils/bodyBeautify'

const fileJsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, class: 'cm-file-json-key' },
  { tag: tags.number, class: 'cm-file-json-number' },
  { tag: tags.string, class: 'cm-file-json-string' },
  { tag: tags.bool, class: 'cm-file-json-boolean' },
  { tag: tags.null, class: 'cm-file-json-null' },
  { tag: [tags.separator, tags.punctuation, tags.brace, tags.squareBracket], class: 'cm-file-json-punctuation' },
])

const fileEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    minHeight: '360px',
    background: 'rgba(255,255,255,.06)',
    color: '#e8e8e8',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.35',
    overflow: 'auto',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    minHeight: '360px',
  },
  '.cm-content': {
    minHeight: '360px',
    padding: '10px 12px',
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
  '.cm-content .cm-file-json-key': {
    color: '#7fd8ff !important',
  },
  '.cm-content .cm-file-json-number': {
    color: '#a9f5a9 !important',
  },
  '.cm-content .cm-file-json-string': {
    color: '#ffb46a !important',
  },
  '.cm-content .cm-file-json-boolean': {
    color: '#ff8ec2 !important',
  },
  '.cm-content .cm-file-json-null': {
    color: '#b8c0cc !important',
  },
  '.cm-content .cm-file-json-punctuation': {
    color: '#c7d2fe !important',
  },
})

export function FileTextCodeEditor(props: {
  value: string
  format: BeautifyBodyFormat | null
  minHeight?: number
  onChangeValue: (next: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(props.onChangeValue)

  useEffect(() => {
    onChangeRef.current = props.onChangeValue
  }, [props.onChangeValue])

  const extensions = useMemo(() => {
    const out = [
      history(),
      indentOnInput(),
      bracketMatching(),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      fileEditorTheme,
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      }),
    ]

    if (props.format === 'json') {
      out.push(json())
      out.push(syntaxHighlighting(fileJsonHighlightStyle))
      out.push(closeBrackets())
    }

    return out
  }, [props.format])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const state = EditorState.create({
      doc: props.value ?? '',
      extensions,
    })

    const view = new EditorView({
      state,
      parent: root,
    })

    const minHeight = Math.max(220, props.minHeight ?? 360)
    view.dom.classList.add('mono')
    view.dom.style.minHeight = `${minHeight}px`
    view.dom.style.height = `${minHeight}px`
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [extensions, props.minHeight])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === props.value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value ?? '' },
    })
  }, [props.value])

  return <div ref={rootRef} />
}
