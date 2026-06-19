import { useCallback, useRef } from 'react'
import { clampHistory } from '../utils/sql'

type EditorHistoryEntry = {
  text: string
  caret: number
}

type EditorHistoryState = {
  stack: EditorHistoryEntry[]
  index: number
  applying: boolean
}

export function useSqlTerminalEditorHistory(initialText: string) {
  const pendingCaretRef = useRef<number | null>(null)
  const historyRef = useRef<EditorHistoryState>({
    stack: [{ text: initialText, caret: 0 }],
    index: 0,
    applying: false,
  })

  const recordProgrammaticChange = useCallback((nextText: string, nextCaret: number) => {
    const history = historyRef.current
    const current = history.stack[history.index]?.text ?? ''
    if (current === nextText) {
      pendingCaretRef.current = nextCaret
      return
    }

    const nextEntry = { text: nextText, caret: nextCaret }
    const base = history.stack.slice(0, history.index + 1)
    const nextStack = clampHistory([...base, nextEntry], 20)
    historyRef.current = { stack: nextStack, index: nextStack.length - 1, applying: false }
    pendingCaretRef.current = nextCaret
  }, [])

  const recordInputChange = useCallback((nextText: string, caret: number) => {
    const history = historyRef.current
    if (history.applying) return
    const current = history.stack[history.index]?.text ?? ''
    if (current === nextText) return

    const nextEntry = { text: nextText, caret }
    const base = history.stack.slice(0, history.index + 1)
    const nextStack = clampHistory([...base, nextEntry], 20)
    historyRef.current = { stack: nextStack, index: nextStack.length - 1, applying: false }
  }, [])

  const undo = useCallback(() => {
    const history = historyRef.current
    if (history.index <= 0) return null
    const nextIndex = history.index - 1
    const entry = history.stack[nextIndex]
    historyRef.current = { ...history, index: nextIndex, applying: true }
    pendingCaretRef.current = entry.caret
    return entry
  }, [])

  const redo = useCallback(() => {
    const history = historyRef.current
    if (history.index >= history.stack.length - 1) return null
    const nextIndex = history.index + 1
    const entry = history.stack[nextIndex]
    historyRef.current = { ...history, index: nextIndex, applying: true }
    pendingCaretRef.current = entry.caret
    return entry
  }, [])

  const finishApplying = useCallback(() => {
    const history = historyRef.current
    historyRef.current = { ...history, applying: false }
  }, [])

  return {
    pendingCaretRef,
    recordProgrammaticChange,
    recordInputChange,
    undo,
    redo,
    finishApplying,
  }
}
