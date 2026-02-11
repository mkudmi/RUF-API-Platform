import { useEffect, useMemo, useRef, useState } from 'react'
import { tauriInvoke } from '../../../shared/utils/tauri'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'

type TerminalEntry =
  | { kind: 'in'; text: string }
  | { kind: 'out'; text: string }
  | { kind: 'err'; text: string }
  | { kind: 'sys'; text: string }

type TerminalExecResult = {
  stdout: string
  stderr: string
  status: number
}

type TerminalShellInfo = {
  id: string
  label: string
  available: boolean
}

const TERMINAL_HEIGHT_KEY = 'ruf_terminal_height_v1'
const TERMINAL_MIN_HEIGHT_PX = 200
const WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX = 38

function getWindowTitlebarHeightPx() {
  if (typeof document === 'undefined') return WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  const el = document.querySelector<HTMLElement>('.windowTitlebar')
  const measured = el?.getBoundingClientRect().height ?? WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  return Math.max(0, Math.round(measured)) || WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
}

function getTerminalMaxHeightPx() {
  if (typeof window === 'undefined') return 420
  const topReserved = getWindowTitlebarHeightPx()
  return Math.max(TERMINAL_MIN_HEIGHT_PX, Math.floor(window.innerHeight - topReserved))
}

function splitLines(s: string): string[] {
  if (!s) return []
  return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
}

function getErrorMessage(e: unknown): string {
  if (typeof e === 'object' && e != null && 'message' in e) {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return String(e)
}

function sanitizeGitBashCommand(cmd: string): string {
  // In this app the input is single-line, so snippets like:
  //   curl ... \ <newline> ...
  // often get pasted as: "curl ... \\   ...", turning "\" into a positional arg.
  // Strip standalone "\" tokens (surrounded by whitespace) without touching escapes like "foo\\ bar".
  // If the input is actually multiline (textarea), keep it as-is so bash line continuations work.
  if (cmd.includes('\n') || cmd.includes('\r')) return cmd.trim()
  return cmd
    .replace(/(^|\s)\\(?=\s)/g, '$1')
    .replace(/\s+\\$/g, '')
    .trim()
}

type TerminalTab = {
  id: string
  shellId: string
  label: string
  cwd: string | null
  entries: TerminalEntry[]
  input: string
  history: string[]
  historyIndex: number | null
}

function makeTabId(): string {
  return `tab_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

export function TerminalDrawer(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props
  const [busy, setBusy] = useState(false)
  const [shells, setShells] = useState<TerminalShellInfo[] | null>(null)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [heightPx, setHeightPx] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(TERMINAL_HEIGHT_KEY)
      if (!raw) return null
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      return null
    }
  })

  const outputRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null)

  function focusInputSoon() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) ?? null, [tabs, activeTabId])

  const prompt = useMemo(() => {
    const shown = activeTab?.cwd ?? ''
    const shellId = activeTab?.shellId ?? ''
    const prefix = shellId === 'powershell' ? 'PS' : '$'
    if (!shown) return prefix === 'PS' ? 'PS>' : `${prefix} `
    return prefix === 'PS' ? `PS ${shown}>` : `${prefix} `
  }, [activeTab?.cwd, activeTab?.shellId])

  useEffect(() => {
    if (!open) return
    focusInputSoon()
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!activeTabId) return
    focusInputSoon()
  }, [open, activeTabId])

  useEffect(() => {
    if (heightPx == null) return
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(heightPx))
    } catch {
      // ignore
    }
  }, [heightPx])

  useEffect(() => {
    if (!open) return

    function clampToViewport() {
      const max = getTerminalMaxHeightPx()
      setHeightPx(prev => {
        if (prev == null) return prev
        return Math.min(prev, max)
      })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [open])

  useEffect(() => {
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeTab?.entries.length])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(el.scrollHeight, 160)
    el.style.height = `${Math.max(24, next)}px`
  }, [activeTab?.input, open, showAddMenu])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function loadShells() {
      try {
        const list = await tauriInvoke<TerminalShellInfo[]>('terminal_list_shells')
        if (cancelled) return
        setShells(list)
      } catch {
        // ignore
      }
    }
    loadShells()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const { homeDir } = await import('@tauri-apps/api/path')
        const dir = await homeDir()
        if (cancelled) return
        setTabs(prev => prev.map(t => (t.cwd == null ? { ...t, cwd: dir } : t)))
      } catch {
        // ignore
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useDismissibleLayer({
    open: open && showAddMenu,
    onDismiss: () => setShowAddMenu(false),
    isInsideTarget: target => {
      const wrap = addMenuWrapRef.current
      return !!(wrap && target && wrap.contains(target))
    },
  })

  useEffect(() => {
    if (!open) return
    if (tabs.length) return
    if (!shells) return
    const firstAvailable = shells.find(s => s.available)
    if (!firstAvailable) return
    const id = makeTabId()
    setTabs([
      {
        id,
        shellId: firstAvailable.id,
        label: firstAvailable.label,
        cwd: null,
        entries: [],
        input: '',
        history: [],
        historyIndex: null,
      },
    ])
    setActiveTabId(id)
  }, [open, tabs.length, shells])

  function addTab(shell: TerminalShellInfo) {
    const id = makeTabId()
    setTabs(prev => [...prev, { id, shellId: shell.id, label: shell.label, cwd: activeTab?.cwd ?? null, entries: [], input: '', history: [], historyIndex: null }])
    setActiveTabId(id)
  }

  function closeTab(id: string) {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx < 0) return prev
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)]
      if (activeTabId === id) {
        const fallback = next[idx - 1] ?? next[idx] ?? null
        setActiveTabId(fallback?.id ?? null)
      }
      return next
    })
  }

  function onResizeHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!open) return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    const startY = e.clientY
    const max = getTerminalMaxHeightPx()
    const startHeight = heightPx ?? Math.round(Math.min(window.innerHeight * 0.38, max))

    const min = TERMINAL_MIN_HEIGHT_PX

    function clamp(n: number) {
      return Math.max(min, Math.min(max, n))
    }

    function onMove(ev: PointerEvent) {
      if ((ev.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dy = ev.clientY - startY
      const next = clamp(Math.round(startHeight - dy))
      setHeightPx(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch {
        // ignore
      }
    }

    function onUp() {
      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    try {
      handle.setPointerCapture(pointerId)
    } catch {
      // ignore
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  async function runCommand(raw: string) {
    const cmd = raw.trim()
    if (!cmd) {
      focusInputSoon()
      return
    }

    if (!activeTab) {
      setShowAddMenu(true)
      focusInputSoon()
      return
    }

    setTabs(prev =>
      prev.map(t => {
        if (t.id !== activeTab.id) return t
        const nextHistory = t.history[t.history.length - 1] === cmd ? t.history : [...t.history, cmd]
        return {
          ...t,
          history: nextHistory,
          historyIndex: null,
          entries: [...t.entries, { kind: 'in', text: `${prompt} ${cmd}` }],
        }
      }),
    )

    if (cmd === 'clear' || cmd === 'cls') {
      setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, entries: [] } : t)))
      focusInputSoon()
      return
    }

    if (/^cd(\s+|$)/i.test(cmd)) {
      const arg = cmd.replace(/^cd/i, '').trim()
      try {
        const next = await tauriInvoke<string>('terminal_resolve_cwd', { args: { cwd: activeTab.cwd, target: arg } })
        setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, cwd: next } : t)))
      } catch (e: unknown) {
        setTabs(prev =>
          prev.map(t => (t.id === activeTab.id ? { ...t, entries: [...t.entries, { kind: 'err', text: getErrorMessage(e) }] } : t)),
        )
      }
      focusInputSoon()
      return
    }

    setBusy(true)
    try {
      const shouldSanitize = activeTab.shellId === 'gitbash' && !cmd.includes('\n') && !cmd.includes('\r')
      const command = shouldSanitize ? sanitizeGitBashCommand(cmd) : cmd
      if (command !== cmd && shouldSanitize) {
        setTabs(prev =>
          prev.map(t =>
            t.id === activeTab.id ? { ...t, entries: [...t.entries, { kind: 'sys', text: 'Stripped bash line-continuations (\\).' }] } : t,
          ),
        )
      }
      const res = await tauriInvoke<TerminalExecResult>('terminal_exec', { args: { command, cwd: activeTab.cwd, shellId: activeTab.shellId } })
      const add: TerminalEntry[] = []
      for (const line of splitLines(res.stdout)) add.push({ kind: 'out', text: line })
      for (const line of splitLines(res.stderr)) add.push({ kind: 'err', text: line })
      if (res.status !== 0) add.push({ kind: 'sys', text: `Exit code: ${res.status}` })
      if (add.length) {
        setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, entries: [...t.entries, ...add] } : t)))
      }
    } catch (e: unknown) {
      setTabs(prev =>
        prev.map(t => (t.id === activeTab.id ? { ...t, entries: [...t.entries, { kind: 'err', text: getErrorMessage(e) }] } : t)),
      )
    } finally {
      setBusy(false)
      focusInputSoon()
    }
  }

  function onSubmit() {
    if (!activeTab) return
    void runCommand(activeTab.input)
    setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, input: '' } : t)))
  }

  function onHistory(delta: -1 | 1) {
    if (!activeTab) return
    if (!activeTab.history.length) return
    const idx = activeTab.historyIndex == null ? activeTab.history.length : activeTab.historyIndex
    const next = Math.max(0, Math.min(activeTab.history.length, idx + delta))
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== activeTab.id) return t
        return {
          ...t,
          historyIndex: next,
          input: next === activeTab.history.length ? '' : (activeTab.history[next] ?? ''),
        }
      }),
    )
  }

  const drawerMaxHeightPx = getTerminalMaxHeightPx()
  const drawerHeightPx = heightPx == null ? null : Math.min(heightPx, drawerMaxHeightPx)

  return (
    <>
      <div
        className={props.open ? 'terminalBackdrop terminalBackdropOpen' : 'terminalBackdrop'}
        onClick={props.onClose}
      />
      <section
        className={props.open ? 'terminalDrawer terminalDrawerOpen' : 'terminalDrawer'}
        aria-hidden={!props.open}
        style={drawerHeightPx != null ? { height: `${drawerHeightPx}px`, maxHeight: `${drawerMaxHeightPx}px` } : { maxHeight: `${drawerMaxHeightPx}px` }}
      >
        <div className="terminalResizeHandle" onPointerDown={onResizeHandlePointerDown} />
        <header className="terminalHeader">
          <div className="terminalTitle mono">
            Terminal
            <div className="terminalTabs" role="tablist" aria-label="Terminal tabs">
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === activeTabId ? 'terminalTab terminalTabActive' : 'terminalTab'}
                  onClick={() => setActiveTabId(t.id)}
                  disabled={busy}
                  role="tab"
                  aria-selected={t.id === activeTabId}
                >
                  <span className="terminalTabLabel">{t.label}</span>
                  <span
                    className="terminalTabClose"
                    role="button"
                    aria-label="Close tab"
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      closeTab(t.id)
                    }}
                  >
                    ✕
                  </span>
                </button>
              ))}
              <div ref={showAddMenu ? addMenuWrapRef : null} className="terminalAddWrap">
                <button
                  type="button"
                  className="terminalAddBtn"
                  onClick={() => setShowAddMenu(v => !v)}
                  disabled={busy}
                  aria-label="Add terminal tab"
                  title="Add tab"
                >
                  +
                </button>
                {showAddMenu ? (
                  <div className="terminalAddMenu" role="menu">
                    {(shells ?? []).map(shell => {
                      return (
                        <button
                          key={shell.id}
                          type="button"
                          className="terminalAddMenuItem"
                          role="menuitem"
                          disabled={!shell.available}
                          onClick={() => {
                            setShowAddMenu(false)
                            addTab(shell)
                            requestAnimationFrame(() => inputRef.current?.focus())
                          }}
                        >
                          {shell.label}
                          {!shell.available ? <span className="terminalAddMenuHint"> (not found)</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="terminalHeaderActions">
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                if (!activeTab) return
                setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, entries: [] } : t)))
                focusInputSoon()
              }}
              aria-label="Clear terminal"
              title="Clear"
              disabled={busy || !activeTab}
            >
              ⟲
            </button>
            <button type="button" className="iconBtn" onClick={props.onClose} aria-label="Close" title="Close">
              ✕
            </button>
          </div>
        </header>

        <div
          ref={outputRef}
          className="terminalOutput mono"
          role="log"
          aria-live="polite"
          onPointerDown={() => inputRef.current?.focus()}
        >
          {(activeTab?.entries ?? []).map((e, i) => (
            <div key={i} className={`terminalLine terminalLine_${e.kind}`}>
              {e.text}
            </div>
          ))}
          <div className="terminalPromptLine">
            <span className="terminalPrompt mono" title={prompt}>
              {prompt}
            </span>
            <textarea
              ref={inputRef}
              className="terminalInput mono"
              value={activeTab?.input ?? ''}
              disabled={!props.open || busy || !activeTab}
              onChange={e => {
                const v = e.target.value
                setTabs(prev => prev.map(t => (t.id === activeTabId ? { ...t, input: v } : t)))
              }}
              onKeyDown={e => {
                const current = activeTab?.input ?? ''
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit()
                  return
                }
                if (e.key === 'ArrowUp' && !current.includes('\n')) {
                  e.preventDefault()
                  onHistory(-1)
                  return
                }
                if (e.key === 'ArrowDown' && !current.includes('\n')) {
                  e.preventDefault()
                  onHistory(1)
                  return
                }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
                  e.preventDefault()
                  if (!activeTab) return
                  setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, entries: [] } : t)))
                }
              }}
              placeholder={
                busy
                  ? 'Running…'
                  : activeTab
                    ? `Enter command (${activeTab.label})`
                    : 'Add a terminal tab (+)'
              }
              rows={1}
            />
          </div>
        </div>
      </section>
    </>
  )
}
