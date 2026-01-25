import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { safeJsonParse } from '../../shared/utils/http'
import { generateJsonSchema } from '../../shared/utils/jsonSchema'
import type { RequestHistoryItem } from '../../shared/types/requestHistory'
import type { RunResult } from '../../features/requestRunner/runRequest'
import { evaluateJsonSearch, type JsonValue } from './JsonPathSearch'
import { CloseIcon, CopyIcon, SchemaIcon, SearchIcon, TrashIcon } from '../../shared/icons'
import { copyText } from '../../shared/utils/clipboard'
import { addResponseSearchHistoryEntry, loadResponseSearchHistory, saveResponseSearchHistory } from '../utils/responseSearchHistory'

type FileSystemWritableFileStreamLike = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

function statusClass(status: number) {
  if (status >= 200 && status < 300) return 'status2xx'
  if (status >= 300 && status < 400) return 'status3xx'
  if (status >= 400 && status < 500) return 'status4xx'
  if (status >= 500 && status < 600) return 'status5xx'
  return 'statusOther'
}

function compactStatusText(text: string) {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''
  return trimmed
    .replaceAll(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/g)
    .map(w => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join('')
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDateTime24(ts: number) {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear()).padStart(4, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`
}

function countLines(text: string) {
  if (!text) return 1
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++
  }
  return lines
}

function buildLineNumbers(lineCount: number) {
  const out: string[] = []
  for (let i = 1; i <= lineCount; i++) out.push(String(i))
  return out.join('\n')
}

export function ResponseViewer(props: {
  result: RunResult | null
  inFlightCount?: number
  tab: 'body' | 'headers' | 'history'
  onTabChange: (tab: 'body' | 'headers' | 'history') => void
  historyItems?: RequestHistoryItem[]
  onSelectHistoryItem?: (item: RequestHistoryItem) => void
  onDeleteHistoryItem?: (item: RequestHistoryItem) => void
}) {
  const [bodyQuery, setBodyQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false)
  const [schemaCopyFeedback, setSchemaCopyFeedback] = useState(false)
  const [schemaFileBaseName, setSchemaFileBaseName] = useState('requestResponseSchema')
  const schemaMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const saveSchemaDialogRef = useRef<HTMLDialogElement | null>(null)
  const schemaFileNameInputRef = useRef<HTMLInputElement | null>(null)
  const schemaCloseTimerRef = useRef<number | null>(null)
  const [responseSearchOpen, setResponseSearchOpen] = useState(false)
  const [responseSearchCopied, setResponseSearchCopied] = useState(false)
  const responseSearchInputRef = useRef<HTMLInputElement | null>(null)
  const responseSearchHelpDialogRef = useRef<HTMLDialogElement | null>(null)
  const responseSearchHistoryPanelRef = useRef<HTMLDivElement | null>(null)
  const [responseSearchHistory, setResponseSearchHistory] = useState<string[]>(() => loadResponseSearchHistory())
  const [responseSearchHistoryOpen, setResponseSearchHistoryOpen] = useState(false)
  const [responseSearchHistoryAnchor, setResponseSearchHistoryAnchor] = useState<{ left: number, top: number, width: number, placement: 'above' | 'below' } | null>(null)
  const sizePopoverAnchorRef = useRef<HTMLSpanElement | null>(null)
  const sizePopoverCloseTimerRef = useRef<number | null>(null)
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false)
  const [sizePopoverPos, setSizePopoverPos] = useState<{ left: number, top: number } | null>(null)

  const parsed = useMemo(() => {
    if (!props.result) return null
    return safeJsonParse(props.result.bodyText)
  }, [props.result])

  const isJson = props.result ? parsed !== null : false

  const bodyView = useMemo(() => {
    if (!props.result) return { text: '', matchesCount: null as number | null, error: null as string | null }
    if (!isJson) return { text: props.result.bodyText, matchesCount: null as number | null, error: null as string | null }

    const q = bodyQuery.trim()
    if (!q) return { text: JSON.stringify(parsed, null, 2), matchesCount: null as number | null, error: null as string | null }

    const { matches, error } = evaluateJsonSearch(parsed as JsonValue, q)
    if (error) return { text: '', matchesCount: matches.length, error }
    if (!matches.length) return { text: '', matchesCount: 0, error: null as string | null }

    const out = Array.isArray(parsed) ? matches : (matches.length === 1 ? matches[0] : matches)
    return { text: JSON.stringify(out, null, 2), matchesCount: matches.length, error: null as string | null }
  }, [bodyQuery, isJson, parsed, props.result])

  const result = props.result
  const tab = props.tab
  const headersText = result ? JSON.stringify(result.headers, null, 2) : ''
  const historyItems = props.historyItems ?? []
  const copyPayload = tab === 'body' ? bodyView.text : headersText
  const canCopy = !!result && copyPayload.length > 0
  const canGenerateSchema = tab === 'body' && isJson
  const responseSearchErrorText = tab === 'body' && responseSearchOpen && isJson && !!bodyQuery.trim() ? bodyView.error : null
  const responseSearchMatchesCount = !bodyView.error && bodyQuery.trim() && typeof bodyView.matchesCount === 'number' ? bodyView.matchesCount : null
  const responseSearchHasMatchesMeta = tab === 'body' && responseSearchOpen && isJson && typeof responseSearchMatchesCount === 'number'

  const bodyLineCount = useMemo(() => countLines(bodyView.text), [bodyView.text])
  const bodyLineNumbers = useMemo(() => buildLineNumbers(bodyLineCount), [bodyLineCount])
  const bodyGutterWidthCh = Math.max(2, String(bodyLineCount).length) + 1

  const headersLineCount = useMemo(() => countLines(headersText), [headersText])
  const headersLineNumbers = useMemo(() => buildLineNumbers(headersLineCount), [headersLineCount])
  const headersGutterWidthCh = Math.max(2, String(headersLineCount).length) + 1

  async function onCopy() {
    await copyText(copyPayload)
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }

  async function onCopyResponseSearch() {
    const q = bodyQuery.trim()
    if (!q) return
    await copyText(q)
    setResponseSearchCopied(true)
    setTimeout(() => setResponseSearchCopied(false), 800)
  }

  function recordResponseSearchHistory(query: string) {
    setResponseSearchHistory(prev => {
      const next = addResponseSearchHistoryEntry(prev, query, 10)
      if (next === prev) return prev
      saveResponseSearchHistory(next)
      return next
    })
  }

  function deleteResponseSearchHistoryItem(queryRaw: string) {
    const q = queryRaw.trim()
    if (!q) return
    setResponseSearchHistory(prev => {
      const next = prev.filter(v => v !== q)
      if (next.length === prev.length) return prev
      saveResponseSearchHistory(next)
      return next
    })
  }

  function clearResponseSearchHistory() {
    setResponseSearchHistory([])
    saveResponseSearchHistory([])
  }

  function closeResponseSearchHistoryMenu() {
    setResponseSearchHistoryOpen(false)
    setResponseSearchHistoryAnchor(null)
  }

  function toggleResponseSearchHistoryMenu(anchorEl: HTMLElement) {
    if (responseSearchHistoryOpen) {
      closeResponseSearchHistoryMenu()
      return
    }

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 240

    let width = rect.width
    if (width < 220) width = 220
    if (width > 520) width = 520

    let left = rect.left
    const aboveBottom = rect.top - 6
    const canPlaceAbove = aboveBottom - assumedMaxHeight >= margin
    const placement: 'above' | 'below' = canPlaceAbove ? 'above' : 'below'
    const top = placement === 'above' ? aboveBottom : (rect.bottom + 6)

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    setResponseSearchHistoryOpen(true)
    setResponseSearchHistoryAnchor({ left, top, width, placement })
  }

  const clearSchemaCloseTimer = useCallback(() => {
    if (schemaCloseTimerRef.current === null) return
    window.clearTimeout(schemaCloseTimerRef.current)
    schemaCloseTimerRef.current = null
  }, [])

  const closeSchemaMenu = useCallback(() => {
    clearSchemaCloseTimer()
    setSchemaCopyFeedback(false)
    setSchemaMenuOpen(false)
  }, [clearSchemaCloseTimer])

  useEffect(() => {
    if (!schemaMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = schemaMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      closeSchemaMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSchemaMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeSchemaMenu, schemaMenuOpen])

  function getSchemaText() {
    if (!isJson) return null
    const schema = generateJsonSchema(parsed)
    return JSON.stringify(schema, null, 2)
  }

  async function copySchemaToClipboard() {
    const schemaText = getSchemaText()
    if (!schemaText) return
    await copyText(schemaText)
    setSchemaCopyFeedback(true)
    clearSchemaCloseTimer()
    schemaCloseTimerRef.current = window.setTimeout(() => {
      closeSchemaMenu()
    }, 900)
  }

  function openSaveSchemaDialog() {
    closeSchemaMenu()
    setSchemaFileBaseName('requestResponseSchema')
    saveSchemaDialogRef.current?.showModal()
    setTimeout(() => schemaFileNameInputRef.current?.focus(), 0)
  }

  function normalizeSchemaFileName(base: string) {
    const trimmed = base.trim() || 'requestResponseSchema'
    return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`
  }

  async function saveSchemaWithName(baseName: string) {
    const schemaText = getSchemaText()
    if (!schemaText) return

    const fileName = normalizeSchemaFileName(baseName)

    try {
      const w = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike> }
      if (typeof w.showSaveFilePicker === 'function') {
        const handle = await w.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'JSON',
              accept: { 'application/json': ['.json'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(schemaText)
        await writable.close()
      } else {
        const blob = new Blob([schemaText], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      if ((e as Error | null)?.name !== 'AbortError') throw e
    }
  }

  async function confirmSaveSchema() {
    await saveSchemaWithName(schemaFileBaseName)
    saveSchemaDialogRef.current?.close()
  }

  const inFlightCount = props.inFlightCount ?? 0
  const statusLine = inFlightCount > 0 ? 'Sending...' : 'Run a request to see the response.'

  useEffect(() => {
    if (tab === 'body') return
    setResponseSearchOpen(false)
    closeResponseSearchHistoryMenu()
  }, [tab])

  useEffect(() => {
    if (!responseSearchOpen || tab !== 'body') return
    const t = window.setTimeout(() => responseSearchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [responseSearchOpen, tab])

  useEffect(() => {
    if (!responseSearchOpen) closeResponseSearchHistoryMenu()
  }, [responseSearchOpen])

  useEffect(() => {
    if (!responseSearchHistoryOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (responseSearchHistoryPanelRef.current && responseSearchHistoryPanelRef.current.contains(t)) return
      if (t.closest?.('[data-response-search-history-btn]')) return
      closeResponseSearchHistoryMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeResponseSearchHistoryMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [responseSearchHistoryOpen])

  useEffect(() => {
    if (!isJson) closeResponseSearchHistoryMenu()
  }, [isJson])

  const closeSizePopover = useCallback(() => {
    if (sizePopoverCloseTimerRef.current !== null) {
      window.clearTimeout(sizePopoverCloseTimerRef.current)
      sizePopoverCloseTimerRef.current = null
    }
    setSizePopoverOpen(false)
  }, [])

  const openSizePopover = useCallback(() => {
    if (sizePopoverCloseTimerRef.current !== null) {
      window.clearTimeout(sizePopoverCloseTimerRef.current)
      sizePopoverCloseTimerRef.current = null
    }
    const el = sizePopoverAnchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(8, r.right), window.innerWidth - 8)
    const top = Math.min(Math.max(8, r.bottom + 6), window.innerHeight - 8)
    setSizePopoverPos({ left, top })
    setSizePopoverOpen(true)
  }, [])

  const scheduleCloseSizePopover = useCallback(() => {
    if (sizePopoverCloseTimerRef.current !== null) window.clearTimeout(sizePopoverCloseTimerRef.current)
    sizePopoverCloseTimerRef.current = window.setTimeout(() => {
      sizePopoverCloseTimerRef.current = null
      setSizePopoverOpen(false)
    }, 120)
  }, [])

  useEffect(() => {
    if (!sizePopoverOpen) return

    function updatePos() {
      const el = sizePopoverAnchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const left = Math.min(Math.max(8, r.right), window.innerWidth - 8)
      const top = Math.min(Math.max(8, r.bottom + 6), window.innerHeight - 8)
      setSizePopoverPos({ left, top })
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSizePopover()
    }

    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeSizePopover, sizePopoverOpen])

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr auto', height: '100%', overflow: 'hidden' }}>
      {result ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`badge ${statusClass(result.status)}`}>
            HTTP {result.status}{result.statusText ? ` ${compactStatusText(result.statusText)}` : ''}
          </span>
          <span className="small" style={{ opacity: 0.6 }}>·</span>
          <span className="small">{result.timeMs} ms</span>
          <span className="small" style={{ opacity: 0.6 }}>·</span>
          <span
            ref={sizePopoverAnchorRef}
            className="small sizePopoverWrap"
            tabIndex={0}
            onMouseEnter={openSizePopover}
            onMouseLeave={scheduleCloseSizePopover}
            onFocus={openSizePopover}
            onBlur={scheduleCloseSizePopover}
          >
            <span className="sizePopoverTrigger">{formatBytes(result.responseBytes)}</span>
          </span>
          {inFlightCount > 0 ? <span className="small" style={{ marginLeft: 'auto' }}>Sending…</span> : null}
        </div>
      ) : (
        <div className="small">{statusLine}</div>
      )}

      {result && sizePopoverOpen && sizePopoverPos
        ? createPortal(
          <div
            className="sizePopoverPortal"
            onMouseEnter={openSizePopover}
            onMouseLeave={scheduleCloseSizePopover}
          >
            <div
              className="sizePopoverPanel"
              role="tooltip"
              aria-label="Request/response size breakdown"
              style={{ position: 'fixed', left: sizePopoverPos.left, top: sizePopoverPos.top, transform: 'translateX(-100%)' }}
            >
              <div className="sizePopoverSection">
                <div className="sizePopoverHeader">
                  <div className="sizePopoverTitle"><span className="sizePopoverIcon">↓</span>Response Size</div>
                  <div className="sizePopoverStrong">{formatBytes(result.responseBytes)}</div>
                </div>
                <div className="sizePopoverRow">
                  <div className="sizePopoverLabel">Headers</div>
                  <div className="sizePopoverValue">{formatBytes(result.responseHeadersBytes)}</div>
                </div>
                <div className="sizePopoverRow">
                  <div className="sizePopoverLabel">Body</div>
                  <div className="sizePopoverValue">{formatBytes(result.responseBodyBytes)}</div>
                </div>
              </div>

              <div className="sizePopoverDivider" />

              <div className="sizePopoverSection">
                <div className="sizePopoverHeader">
                  <div className="sizePopoverTitle"><span className="sizePopoverIcon">↑</span>Request Size</div>
                  <div className="sizePopoverStrong">{formatBytes(result.requestBytes)}</div>
                </div>
                <div className="sizePopoverRow">
                  <div className="sizePopoverLabel">Headers</div>
                  <div className="sizePopoverValue">{formatBytes(result.requestHeadersBytes)}</div>
                </div>
                <div className="sizePopoverRow">
                  <div className="sizePopoverLabel">Body</div>
                  <div className="sizePopoverValue">{formatBytes(result.requestBodyBytes)}</div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}

      <div className="tabs" style={{ marginTop: 10 }}>
        <button className={`tab ${tab === 'body' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('body')}>
          Body
        </button>
        <button className={`tab ${tab === 'headers' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('headers')}>
          Headers
        </button>
        <button className={`tab ${tab === 'history' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('history')}>
          History
        </button>
      </div>

      {tab === 'history' ? (
        <div className="historyList">
          <div className="small" style={{ opacity: 0.8, marginTop: 10 }}>
            Click an item to load its params/body into the request editor.
          </div>
          {historyItems.length ? (
            <div style={{ overflow: 'auto', minHeight: 0, display: 'grid', gap: 8, marginTop: 10 }}>
              {historyItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="historyItem"
                  onClick={() => props.onSelectHistoryItem?.(item)}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.method} {item.url}
                      </div>
                      <div className="small" style={{ opacity: 0.75 }}>
                        {formatDateTime24(item.createdAt)}
                        {item.draft?.queryParams && Object.keys(item.draft.queryParams).length
                          ? ` · query ${Object.keys(item.draft.queryParams).length}`
                          : ''}
                        {typeof item.draft?.bodyText === 'string' && item.draft.bodyText.trim()
                          ? ` · body ${item.draft.bodyText.length} chars`
                          : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="iconBtn historyDeleteBtn"
                      title="Delete"
                      aria-label="Delete history item"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.onDeleteHistoryItem?.(item)
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="small" style={{ opacity: 0.75, marginTop: 10 }}>
              No history yet.
            </div>
          )}
        </div>
      ) : tab === 'body' ? (
        <div style={{ display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden', marginTop: 10, minHeight: 0 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            <div className="codeWithGutter" style={{ fontSize: 14 }}>
              <pre className="mono codeGutter" style={{ width: `${bodyGutterWidthCh}ch` }} aria-hidden="true">
                {bodyLineNumbers}
              </pre>
              <pre className="mono codePre">
                {bodyView.text}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden', marginTop: 10, minHeight: 0 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            <div className="codeWithGutter" style={{ fontSize: 12 }}>
              <pre className="mono codeGutter" style={{ width: `${headersGutterWidthCh}ch` }} aria-hidden="true">
                {headersLineNumbers}
              </pre>
              <pre className="mono codePre">
                {headersText}
              </pre>
            </div>
          </div>
        </div>
      )}

      {result ? (
        <div className="responseFooterWrap">
          <div className={`responseSearchWrap ${tab === 'body' && responseSearchOpen ? 'responseSearchWrapOpen' : ''}`}>
            <div className="responseSearchInner">
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }} data-response-search-history-anchor>
                <input
                  ref={responseSearchInputRef}
                  className="mono valueHistoryInput"
                  value={bodyQuery}
                  onChange={e => setBodyQuery(e.target.value)}
                  onBlur={() => recordResponseSearchHistory(bodyQuery)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') recordResponseSearchHistory(bodyQuery)
                    if (e.key === 'Escape') closeResponseSearchHistoryMenu()
                  }}
                  disabled={!isJson}
                  style={{ width: '100%' }}
                  placeholder="Examples: id = 5 | id = 24, 25 | name ~ Максим | height >= 166 | $..id"
                />

                <button
                  type="button"
                  className="valueHistoryBtn"
                  data-response-search-history-btn
                  aria-label="Search history"
                  title="Search history"
                  disabled={!isJson}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    const anchorEl = (e.currentTarget.closest('[data-response-search-history-anchor]') as HTMLElement | null) ?? e.currentTarget
                    toggleResponseSearchHistoryMenu(anchorEl)
                  }}
                >
                  ▾
                </button>

                {responseSearchHistoryOpen && responseSearchHistoryAnchor ? (
                  <div
                    className="selectMenuPanel valueHistoryPanel"
                    ref={responseSearchHistoryPanelRef}
                    role="menu"
                    style={{
                      position: 'fixed',
                      left: responseSearchHistoryAnchor.left,
                      top: responseSearchHistoryAnchor.top,
                      width: responseSearchHistoryAnchor.width,
                      transform: responseSearchHistoryAnchor.placement === 'above' ? 'translateY(-100%)' : undefined,
                      zIndex: 220,
                    }}
                    onPointerDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                  >
                    {responseSearchHistory.length ? (
                      responseSearchHistory.map(v => (
                        <div key={v} className="valueHistoryItemRow">
                          <button
                            type="button"
                            className="selectMenuItem valueHistoryPickBtn"
                            role="menuitem"
                            onClick={() => {
                              setBodyQuery(v)
                              recordResponseSearchHistory(v)
                              closeResponseSearchHistoryMenu()
                              setTimeout(() => responseSearchInputRef.current?.focus(), 0)
                            }}
                          >
                            <div className="mono valueHistoryText">{v}</div>
                          </button>
                          <button
                            type="button"
                            className="valueHistoryDeleteBtn"
                            aria-label="Remove from history"
                            onClick={evt => {
                              evt.preventDefault()
                              evt.stopPropagation()
                              deleteResponseSearchHistoryItem(v)
                            }}
                          >
                            <CloseIcon size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="valueHistoryEmpty small">No history</div>
                    )}

                    <div className="valueHistoryFooterRow">
                      <button
                        type="button"
                        className="valueHistoryClearBtn"
                        disabled={!responseSearchHistory.length}
                        onClick={evt => {
                          evt.preventDefault()
                          evt.stopPropagation()
                          clearResponseSearchHistory()
                        }}
                      >
                        Clear History
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="iconBtn"
                onClick={() => responseSearchHelpDialogRef.current?.showModal()}
                title="Инструкция"
                aria-label="Инструкция по поиску"
                style={{ width: 34, height: 34 }}
              >
                i
              </button>
              <button
                type="button"
                className="iconBtn"
                onClick={onCopyResponseSearch}
                disabled={!bodyQuery.trim()}
                title="Copy search"
                aria-label="Copy search"
              >
                {responseSearchCopied ? 'OK' : <CopyIcon />}
              </button>
              <button
                type="button"
                className="iconBtn"
                onClick={() => setBodyQuery('')}
                disabled={!bodyQuery.trim()}
                title="Clear"
                aria-label="Clear"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="treeMenuDivider responseFooterDivider" role="separator" />

          <div className="responseFooter">
            <div className="responseFooterMeta small">
              {responseSearchErrorText ? (
                <span className="responseFooterError">{responseSearchErrorText}</span>
              ) : responseSearchHasMatchesMeta ? (
                <>
                  Matches: <span className="mono">{responseSearchMatchesCount}</span>
                </>
              ) : null}
            </div>

            <div className="responseFooterActions">
              <button
                type="button"
                className="iconBtn"
                onClick={() => {
                  if (responseSearchOpen) recordResponseSearchHistory(bodyQuery)
                  setResponseSearchOpen(v => !v)
                }}
                disabled={tab !== 'body'}
                title="Search"
                aria-label="Search"
              >
                <SearchIcon />
              </button>

              <div ref={schemaMenuOpen ? schemaMenuWrapRef : null} className="methodMenuWrap">
                <button
                  type="button"
                  className="iconBtn"
                  aria-haspopup="menu"
                  aria-expanded={schemaMenuOpen}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!canGenerateSchema) return
                    clearSchemaCloseTimer()
                    setSchemaCopyFeedback(false)
                    setSchemaMenuOpen(v => !v)
                  }}
                  disabled={!canGenerateSchema}
                  title="Generate JSON Schema"
                  aria-label="Generate JSON Schema"
                >
                  <SchemaIcon />
                </button>

                {schemaMenuOpen ? (
                  <div
                    className="methodMenuPanel"
                    role="menu"
                    style={{ left: 'auto', right: 0, top: 'auto', bottom: 34, minWidth: 170 }}
                    onPointerDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                  >
                    <button
                      type="button"
                      className="methodMenuItem mono"
                      role="menuitem"
                      onClick={copySchemaToClipboard}
                      disabled={schemaCopyFeedback}
                    >
                      {schemaCopyFeedback ? 'Copied!' : 'Copy'}
                    </button>
                    <button type="button" className="methodMenuItem mono" role="menuitem" onClick={openSaveSchemaDialog}>
                      Save
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="iconBtn"
                onClick={onCopy}
                disabled={!canCopy}
                title={tab === 'body' ? 'Copy body' : 'Copy headers'}
                aria-label={tab === 'body' ? 'Copy body' : 'Copy headers'}
              >
                {copied ? 'OK' : <CopyIcon />}
              </button>
            </div>
          </div>

          <dialog ref={saveSchemaDialogRef} className="modal modalSmall" onClose={() => setSchemaFileBaseName('requestResponseSchema')}>
            <div className="modalHeader">
              <b>Save JSON Schema</b>
              <button className="iconBtn" onClick={() => saveSchemaDialogRef.current?.close()} aria-label="Close" title="Close">
                <CloseIcon />
              </button>
            </div>

            <div className="small" style={{ marginBottom: 8 }}>
              File name
            </div>

            <input
              ref={schemaFileNameInputRef}
              className="mono"
              style={{ width: '100%' }}
              value={schemaFileBaseName}
              onChange={e => setSchemaFileBaseName(e.target.value)}
              placeholder="requestResponseSchema"
              onKeyDown={e => {
                if (e.key === 'Enter') confirmSaveSchema()
              }}
            />

            <div className="modalActions">
              <button type="button" onClick={confirmSaveSchema}>
                Save
              </button>
            </div>
          </dialog>

          <dialog ref={responseSearchHelpDialogRef} className="modal">
            <div className="modalHeader">
              <b>Как пользоваться поиском</b>
              <button
                className="iconBtn"
                onClick={() => responseSearchHelpDialogRef.current?.close()}
                aria-label="Закрыть"
                title="Закрыть"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="small" style={{ display: 'grid', gap: 12 }}>
              <div className="treeMenuDivider" role="separator" style={{ margin: '2px 0 6px' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 14, alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div><b>JSONPath</b></div>
                  <div>
                    Запрос начинается с <span className="mono">$</span> и выполняется над JSON-ответом.
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Примеры: <span className="mono">$..id</span>, <span className="mono">$.data.items[*].name</span>, <span className="mono">$[0]</span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Документация:{' '}
                    <a
                      href="https://github.com/JSONPath-Plus/JSONPath"
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'underline dotted rgba(255,255,255,.28)', textUnderlineOffset: 2 }}
                    >
                      JSONPath-Plus / JSONPath
                    </a>
                  </div>
                </div>

                <div className="treeMenuDivider" role="separator" style={{ width: 1, height: '100%', margin: 0, alignSelf: 'stretch' }} />

                <div style={{ display: 'grid', gap: 12 }}>
                  <div><b>Фильтр</b></div>
                  <div>
                    Формат: <span className="mono">field op value</span>. Ищет совпадения по всем объектам внутри JSON (рекурсивно).
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Примеры: <span className="mono">id = 5</span>, <span className="mono">status != 404</span>, <span className="mono">height &gt;= 166</span>, <span className="mono">name ~ "Максим"</span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Операторы: <span className="mono">= == != &gt;= &lt;= &gt; &lt; ~ !~</span> (для <span className="mono">~</span> поиск подстроки, без учета регистра).
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Списки: <span className="mono">id = 1, 2, 3</span>. Строки можно брать в кавычки: <span className="mono">"text"</span> или <span className="mono">'text'</span>.
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Пути в поле: <span className="mono">user.name = "Bob"</span> (через точку).
                  </div>
                </div>
              </div>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  )
}
