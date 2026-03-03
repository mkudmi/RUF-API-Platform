import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { safeJsonParse } from '../../../shared/utils/http'
import { generateJsonSchema } from '../../../shared/utils/jsonSchema'
import type { RequestHistoryItem } from '../../../shared/types/requestHistory'
import type { RequestItem } from '../../collectionTree'
import { runRequest, type RunResult } from '../../requestRunner/runRequest'
import { evaluateJsonSearch, type JsonValue } from '../utils/jsonPathSearch'
import { CloseIcon, CopyIcon, SchemaIcon, SearchIcon, TrashIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { addResponseSearchHistoryEntry, loadResponseSearchHistory, saveResponseSearchHistory } from '../utils/responseSearchHistory'
import { renderJsonLineSyntax, renderXmlLineSyntax } from '../utils/responseSyntaxHighlight'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'
import { logWarn } from '../../../shared/utils/logger'

type FileSystemWritableFileStreamLike = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

type HistoryFileRow = {
  fieldName?: string
  fileName?: string
  isActive?: boolean
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

function formatHistoryStatus(item: RequestHistoryItem): string {
  if (typeof item.responseStatus === 'number') {
    return String(item.responseStatus)
  }
  return 'Pending'
}

function historyStatusClass(item: RequestHistoryItem): string {
  if (typeof item.responseStatus === 'number') return statusClass(item.responseStatus)
  return 'statusOther'
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatResponseTime(timeMs: number) {
  if (!Number.isFinite(timeMs) || timeMs < 0) return '0 ms'
  if (timeMs > 999) return `${(timeMs / 1000).toFixed(2)} s`
  return `${Math.round(timeMs)} ms`
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

function stripUrlParams(url: string): string {
  const raw = (url || '').trim()
  if (!raw) return ''
  const q = raw.indexOf('?')
  const h = raw.indexOf('#')
  let cut = raw.length
  if (q >= 0) cut = Math.min(cut, q)
  if (h >= 0) cut = Math.min(cut, h)
  return raw.slice(0, cut)
}

function getSortedRecordEntries(obj: Record<string, string> | undefined): Array<{ key: string, value: string }> {
  if (!obj) return []
  return Object.entries(obj)
    .map(([key, value]) => ({ key, value: String(value ?? '') }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function sanitizeForLineCounting(text: string) {
  return (text || '').replaceAll('\r', '')
}

function splitLines(text: string) {
  const sanitized = sanitizeForLineCounting(text)
  const lines = sanitized.split('\n')
  return lines.length ? lines : ['']
}

function getHeaderCaseInsensitive(headers: Record<string, string> | null | undefined, name: string) {
  if (!headers) return undefined
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function looksLikeXml(contentType: string | undefined, bodyText: string) {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('xml')) return true

  const t = (bodyText || '').trimStart()
  if (!t.startsWith('<')) return false
  if (/^<!doctype\s+html\b/i.test(t)) return false
  if (/^<html\b/i.test(t)) return false
  return true
}

function prettyPrintXml(xmlText: string) {
  const trimmed = (xmlText || '').trim()
  if (!trimmed) return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'application/xml')
  if (doc.querySelector('parsererror')) return null

  const serialized = new XMLSerializer().serializeToString(doc)
  const withLines = serialized.replace(/(>)(<)(\/*)/g, '$1\n$2$3')
  const lines = withLines.split('\n')

  let pad = 0
  const indent = (n: number) => '  '.repeat(Math.max(0, n))

  const out: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const isXmlDecl = line.startsWith('<?xml')
    const isClosing = /^<\/[^>]+>/.test(line)
    const isSelfClosing = /^<[^>]+\/>/.test(line) || /^<[^>]+><\/[^>]+>/.test(line)
    const isOpening = /^<[^!?/][^>]*>/.test(line) && !isClosing && !isSelfClosing

    if (isClosing) pad = Math.max(0, pad - 1)
    out.push(`${indent(isXmlDecl ? 0 : pad)}${line}`)
    if (isOpening) pad += 1
  }

  return out.join('\n')
}

function formatUnknownForPanel(value: unknown) {
  if (typeof value === 'undefined') return 'n/a'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

type SearchBodyView = {
  text: string
  matchesCount: number | null
  error: string | null
  highlightPlan: { keyTerms: string[], valuesByKey: Record<string, string[]>, standaloneTerms: string[] }
}

type PaginationPlan =
  | { kind: 'page', pageParam: string, currentPage: number, totalPages: number, pageSize: number | null }
  | { kind: 'offset', offsetParam: string, currentOffset: number, limitParam: string, limit: number, totalItems: number }

const EMPTY_HIGHLIGHT_PLAN: SearchBodyView['highlightPlan'] = { keyTerms: [], valuesByKey: {}, standaloneTerms: [] }
const MAX_PAGINATION_PAGES = 50

function deepFindNumericByNames(node: unknown, names: string[], depth = 0): number | null {
  if (depth > 4 || !node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindNumericByNames(item, names, depth + 1)
      if (found !== null) return found
    }
    return null
  }

  const record = node as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (names.includes(key)) {
      const num = typeof value === 'number' ? value : Number(value)
      if (Number.isFinite(num)) return num
    }
  }

  for (const value of Object.values(record)) {
    const found = deepFindNumericByNames(value, names, depth + 1)
    if (found !== null) return found
  }

  return null
}

function inferItemsLength(node: unknown, depth = 0): number | null {
  if (depth > 3 || !node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.length

  const record = node as Record<string, unknown>
  for (const key of ['items', 'data', 'results', 'content', 'rows', 'list']) {
    const value = record[key]
    if (Array.isArray(value)) return value.length
  }

  for (const value of Object.values(record)) {
    const found = inferItemsLength(value, depth + 1)
    if (found !== null) return found
  }

  return null
}

function buildPaginationPlan(args: { url: string | undefined, parsed: JsonValue | null }): PaginationPlan | null {
  const rawUrl = (args.url || '').trim()
  if (!rawUrl || !args.parsed) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const pageParamCandidates = ['page', 'pageNumber', 'page_number', 'pageNum', 'page_num', 'pageno', 'pageNo']
  for (const name of pageParamCandidates) {
    const raw = url.searchParams.get(name)
    if (!raw) continue
    const currentPage = Number(raw)
    if (!Number.isFinite(currentPage) || currentPage < 1) continue

    const totalPages = deepFindNumericByNames(args.parsed, ['totalPages', 'total_pages', 'pageCount', 'page_count', 'pages'])
    const pageSize = deepFindNumericByNames(args.parsed, ['pageSize', 'page_size', 'perPage', 'per_page', 'limit'])
    const totalItems = deepFindNumericByNames(args.parsed, ['total', 'totalCount', 'total_count', 'total_size', 'count'])
    const derivedTotalPages =
      totalPages && totalPages >= currentPage
        ? Math.floor(totalPages)
        : (totalItems && pageSize && pageSize > 0 ? Math.ceil(totalItems / pageSize) : null)

    if (derivedTotalPages && derivedTotalPages > 1) {
      return {
        kind: 'page',
        pageParam: name,
        currentPage,
        totalPages: derivedTotalPages,
        pageSize: pageSize && pageSize > 0 ? Math.floor(pageSize) : null,
      }
    }
  }

  const offsetParamCandidates = ['offset', 'skip', 'start']
  const limitParamCandidates = ['limit', 'pageSize', 'page_size', 'per_page', 'perPage']
  for (const offsetName of offsetParamCandidates) {
    const rawOffset = url.searchParams.get(offsetName)
    if (!rawOffset) continue
    const currentOffset = Number(rawOffset)
    if (!Number.isFinite(currentOffset) || currentOffset < 0) continue

    for (const limitName of limitParamCandidates) {
      const rawLimit = url.searchParams.get(limitName)
      if (!rawLimit) continue
      const limit = Number(rawLimit)
      if (!Number.isFinite(limit) || limit <= 0) continue

      const totalItems = deepFindNumericByNames(args.parsed, ['total', 'totalCount', 'total_count', 'total_size', 'count'])
      const itemsLength = inferItemsLength(args.parsed)
      const derivedTotal = totalItems && totalItems > limit
        ? Math.floor(totalItems)
        : (itemsLength !== null && itemsLength < limit ? currentOffset + itemsLength : null)

      if (derivedTotal && derivedTotal > limit) {
        return {
          kind: 'offset',
          offsetParam: offsetName,
          currentOffset,
          limitParam: limitName,
          limit: Math.floor(limit),
          totalItems: derivedTotal,
        }
      }
    }
  }

  return null
}

function uniqueConcat(values: unknown[][]) {
  const out: unknown[] = []
  const objectSeen = new WeakSet<object>()
  const scalarSeen = new Set<string>()

  for (const list of values) {
    for (const value of list) {
      if (value && typeof value === 'object') {
        const obj = value as object
        if (objectSeen.has(obj)) continue
        objectSeen.add(obj)
        out.push(value)
        continue
      }

      const key = `${typeof value}:${String(value)}`
      if (scalarSeen.has(key)) continue
      scalarSeen.add(key)
      out.push(value)
    }
  }

  return out
}

function mergeHighlightPlans(plans: Array<SearchBodyView['highlightPlan']>) {
  const merged: SearchBodyView['highlightPlan'] = { keyTerms: [], valuesByKey: {}, standaloneTerms: [] }

  for (const plan of plans) {
    for (const key of plan.keyTerms) {
      if (!merged.keyTerms.includes(key)) merged.keyTerms.push(key)
    }
    for (const term of plan.standaloneTerms) {
      if (!merged.standaloneTerms.includes(term)) merged.standaloneTerms.push(term)
    }
    for (const [key, values] of Object.entries(plan.valuesByKey)) {
      const bucket = merged.valuesByKey[key] ?? (merged.valuesByKey[key] = [])
      for (const value of values) {
        if (!bucket.includes(value)) bucket.push(value)
      }
    }
  }

  return merged
}

function buildSearchBodyView(args: {
  source: JsonValue
  rootWasArray: boolean
  bodyQuery: string
}): SearchBodyView {
  const q = args.bodyQuery.trim()
  if (!q) {
    return { text: JSON.stringify(args.source, null, 2), matchesCount: null, error: null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }
  }

  const { matches, displayMatches, highlightPlan, error } = evaluateJsonSearch(args.source, q)
  if (error) return { text: '', matchesCount: matches.length, error, highlightPlan: EMPTY_HIGHLIGHT_PLAN }
  if (!matches.length) return { text: '', matchesCount: 0, error: null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }

  const outputMatches = displayMatches.length ? displayMatches : matches
  const out = args.rootWasArray ? outputMatches : (outputMatches.length === 1 ? outputMatches[0] : outputMatches)
  return { text: JSON.stringify(out, null, 2), matchesCount: matches.length, error: null, highlightPlan }
}

export function ResponseViewer(props: {
  result: RunResult | null
  request?: RequestItem | null
  latestHistoryItem?: RequestHistoryItem | null
  inFlightCount?: number
  tab: 'body' | 'headers' | 'history' | 'tests'
  onTabChange: (tab: 'body' | 'headers' | 'history' | 'tests') => void
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
  const historyInfoPanelRef = useRef<HTMLDivElement | null>(null)
  const testDetailsDialogRef = useRef<HTMLDialogElement | null>(null)
  const [responseSearchHistory, setResponseSearchHistory] = useState<string[]>(() => loadResponseSearchHistory())
  const [responseSearchHistoryOpen, setResponseSearchHistoryOpen] = useState(false)
  const [responseSearchHistoryAnchor, setResponseSearchHistoryAnchor] = useState<{ left: number, top: number, width: number, placement: 'above' | 'below' } | null>(null)
  const [historyInfoOpenId, setHistoryInfoOpenId] = useState<string | null>(null)
  const [selectedTestResultId, setSelectedTestResultId] = useState<string | null>(null)
  const [historyInfoAnchor, setHistoryInfoAnchor] = useState<{ left: number, top: number, width: number, placement: 'above' | 'below' } | null>(null)
  const sizePopoverAnchorRef = useRef<HTMLSpanElement | null>(null)
  const sizePopoverCloseTimerRef = useRef<number | null>(null)
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false)
  const [sizePopoverPos, setSizePopoverPos] = useState<{ left: number, top: number } | null>(null)
  const [paginatedBodyView, setPaginatedBodyView] = useState<SearchBodyView | null>(null)

  const parsed = useMemo(() => {
    if (!props.result) return null
    return safeJsonParse(props.result.bodyText)
  }, [props.result])

  const isJson = props.result ? parsed !== null : false
  const isXmlBody = useMemo(() => {
    if (!props.result || isJson) return false
    const ct = getHeaderCaseInsensitive(props.result.responseHeaders, 'Content-Type')
    return looksLikeXml(ct, props.result.bodyText)
  }, [isJson, props.result])

  const bodyView = useMemo(() => {
    if (!props.result) return { text: '', matchesCount: null as number | null, error: null as string | null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }

    if (props.result.file?.suppressBody) {
      const name = props.result.file.fileName || 'download'
      const sizeText = props.result.file.size ? ` (${formatBytes(props.result.file.size)})` : ''
      return { text: `[Binary file received: ${name}${sizeText}]`, matchesCount: null as number | null, error: null as string | null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }
    }

    if (!isJson) {
      const ct = getHeaderCaseInsensitive(props.result.responseHeaders, 'Content-Type')
      if (looksLikeXml(ct, props.result.bodyText)) {
        const pretty = prettyPrintXml(props.result.bodyText)
        if (pretty !== null) return { text: pretty, matchesCount: null as number | null, error: null as string | null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }
      }
      return { text: props.result.bodyText, matchesCount: null as number | null, error: null as string | null, highlightPlan: EMPTY_HIGHLIGHT_PLAN }
    }

    return buildSearchBodyView({ source: parsed as JsonValue, rootWasArray: Array.isArray(parsed), bodyQuery })
  }, [bodyQuery, isJson, parsed, props.result])

  const paginationPlan = useMemo(
    () => (isJson ? buildPaginationPlan({ url: props.latestHistoryItem?.url, parsed: parsed as JsonValue | null }) : null),
    [isJson, parsed, props.latestHistoryItem?.url],
  )

  useEffect(() => {
    if (!props.result || !props.request || !isJson || !responseSearchOpen || !bodyQuery.trim() || bodyView.error || !paginationPlan) {
      setPaginatedBodyView(null)
      return
    }

    const latestUrl = (props.latestHistoryItem?.url || '').trim()
    const requestHeaders = props.latestHistoryItem?.draft?.headers ?? {}
    if (!latestUrl) {
      setPaginatedBodyView(null)
      return
    }
    const requestForPagination = props.request

    let canceled = false
    const abortController = new AbortController()

    const run = async () => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(latestUrl)
      } catch {
        return
      }

      const baseUrl = `${parsedUrl.origin}/`
      const urlTemplateOverride = `${parsedUrl.origin}${parsedUrl.pathname}`
      const allDisplayMatches: unknown[][] = []
      const allHighlightPlans: Array<SearchBodyView['highlightPlan']> = []
      let totalMatchesCount = 0

      const currentEval = evaluateJsonSearch(parsed as JsonValue, bodyQuery.trim())
      if (currentEval.error) return
      if (currentEval.matches.length) {
        totalMatchesCount += currentEval.matches.length
        allDisplayMatches.push(currentEval.displayMatches.length ? currentEval.displayMatches : currentEval.matches)
        allHighlightPlans.push(currentEval.highlightPlan)
      }

      const pageValues: number[] = []
      if (paginationPlan.kind === 'page') {
        for (let page = 1; page <= paginationPlan.totalPages; page++) {
          if (pageValues.length >= MAX_PAGINATION_PAGES) break
          if (page !== paginationPlan.currentPage) pageValues.push(page)
        }
      } else {
        for (let offset = 0; offset < paginationPlan.totalItems; offset += paginationPlan.limit) {
          if (pageValues.length >= MAX_PAGINATION_PAGES) break
          if (offset !== paginationPlan.currentOffset) pageValues.push(offset)
        }
      }

      for (const value of pageValues) {
        if (canceled) return
        const nextQueryParams = Object.fromEntries(parsedUrl.searchParams.entries())
        if (paginationPlan.kind === 'page') nextQueryParams[paginationPlan.pageParam] = String(value)
        else nextQueryParams[paginationPlan.offsetParam] = String(value)

        const nextResult = await runRequest({
          request: requestForPagination,
          baseUrl,
          urlTemplateOverride,
          variables: {},
          pathParams: {},
          queryParams: nextQueryParams,
          headers: requestHeaders,
          bodyText: props.latestHistoryItem?.draft?.bodyText,
          signal: abortController.signal,
        })
        if (canceled || !nextResult.ok) continue

        const nextParsed = safeJsonParse(nextResult.bodyText)
        if (nextParsed === null) continue

        const nextEval = evaluateJsonSearch(nextParsed as JsonValue, bodyQuery.trim())
        if (nextEval.error || !nextEval.matches.length) continue
        totalMatchesCount += nextEval.matches.length
        allDisplayMatches.push(nextEval.displayMatches.length ? nextEval.displayMatches : nextEval.matches)
        allHighlightPlans.push(nextEval.highlightPlan)
      }

      if (canceled) return
      if (!totalMatchesCount) {
        setPaginatedBodyView({ text: '', matchesCount: 0, error: null, highlightPlan: EMPTY_HIGHLIGHT_PLAN })
        return
      }

      const combined = uniqueConcat(allDisplayMatches)
      const output = combined.length === 1 ? combined[0] : combined
      setPaginatedBodyView({
        text: JSON.stringify(output, null, 2),
        matchesCount: totalMatchesCount,
        error: null,
        highlightPlan: mergeHighlightPlans(allHighlightPlans),
      })
    }

    void run()

    return () => {
      canceled = true
      abortController.abort()
    }
  }, [
    bodyQuery,
    bodyView.error,
    isJson,
    paginationPlan,
    parsed,
    props.latestHistoryItem?.draft?.bodyText,
    props.latestHistoryItem?.draft?.headers,
    props.latestHistoryItem?.url,
    props.request,
    props.result,
    responseSearchOpen,
  ])

  const effectiveBodyView = paginatedBodyView ?? bodyView

  const result = props.result
  const tab = props.tab
  const requestHeadersText = result ? JSON.stringify(result.requestHeaders ?? {}, null, 2) : ''
  const responseHeadersText = result ? JSON.stringify(result.responseHeaders ?? {}, null, 2) : ''
  const headersCopyPayload = result
    ? JSON.stringify({ requestHeaders: result.requestHeaders ?? {}, responseHeaders: result.responseHeaders ?? {} }, null, 2)
    : ''
  const historyItems = props.historyItems ?? []
  const activeHistoryInfoItem = useMemo(
    () => (historyInfoOpenId ? historyItems.find(item => item.id === historyInfoOpenId) ?? null : null),
    [historyInfoOpenId, historyItems],
  )
  const activeHistoryInfoUrl = useMemo(
    () => stripUrlParams(activeHistoryInfoItem?.url || ''),
    [activeHistoryInfoItem?.url],
  )
  const selectedTestResult = useMemo(() => {
    if (!selectedTestResultId || !result?.testResults?.length) return null
    return result.testResults.find((test, idx) => `${test.source}:${test.name}:${idx}` === selectedTestResultId) ?? null
  }, [result, selectedTestResultId])
  const historyInfoMaxHeightPx = useMemo(() => {
    if (!historyInfoAnchor) return undefined
    const margin = 8
    const hardCap = 420
    const available =
      historyInfoAnchor.placement === 'above'
        ? Math.max(120, historyInfoAnchor.top - margin)
        : Math.max(120, window.innerHeight - historyInfoAnchor.top - margin)
    return Math.max(120, Math.min(hardCap, available))
  }, [historyInfoAnchor])
  const testsText = result?.testResults?.length
    ? JSON.stringify(result.testResults, null, 2)
    : ''
  const testsTabStatusClass = (() => {
    const tests = result?.testResults ?? []
    if (!tests.length) return ''
    const allPassed = tests.every(test => test.passed)
    return allPassed ? 'tabTestsPass' : 'tabTestsFail'
  })()
  const copyPayload = tab === 'body' ? effectiveBodyView.text : tab === 'headers' ? headersCopyPayload : tab === 'tests' ? testsText : ''
  const canCopy = !!result && copyPayload.length > 0
  const canGenerateSchema = tab === 'body' && isJson
  const responseSearchErrorText = tab === 'body' && responseSearchOpen && isJson && !!bodyQuery.trim() ? effectiveBodyView.error : null
  const responseSearchMatchesCount = !effectiveBodyView.error && bodyQuery.trim() && typeof effectiveBodyView.matchesCount === 'number' ? effectiveBodyView.matchesCount : null
  const responseSearchHasMatchesMeta = tab === 'body' && responseSearchOpen && isJson && typeof responseSearchMatchesCount === 'number'
  const bodyHighlightPlan = tab === 'body' && responseSearchOpen && isJson && !effectiveBodyView.error
    ? effectiveBodyView.highlightPlan
    : EMPTY_HIGHLIGHT_PLAN

  const onDownloadFile = useCallback(async () => {
    const f = result?.file
    if (!f) return

    const suggestedName = f.fileName || 'download'

    const savePickerFn = (window as any)?.showSaveFilePicker as undefined | ((opts?: any) => Promise<any>)
    if (typeof savePickerFn === 'function') {
      try {
        const handle = await savePickerFn({ suggestedName })
        const writable = await handle.createWritable()
        await writable.write(f.blob)
        await writable.close()
        return
      } catch (e: any) {
        logWarn('ResponseViewer.onDownloadFile', 'showSaveFilePicker failed, falling back to anchor download', { error: e, suggestedName })
        if (e?.name === 'AbortError') return
      }
    }

    const url = URL.createObjectURL(f.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [result])

  const bodyLines = useMemo(() => splitLines(effectiveBodyView.text), [effectiveBodyView.text])
  const bodyLineCount = bodyLines.length
  const bodyGutterWidthCh = Math.max(2, String(bodyLineCount).length) + 1

  const requestHeadersLines = useMemo(() => splitLines(requestHeadersText), [requestHeadersText])
  const requestHeadersLineCount = requestHeadersLines.length
  const requestHeadersGutterWidthCh = Math.max(2, String(requestHeadersLineCount).length) + 1

  const responseHeadersLines = useMemo(() => splitLines(responseHeadersText), [responseHeadersText])
  const responseHeadersLineCount = responseHeadersLines.length
  const responseHeadersGutterWidthCh = Math.max(2, String(responseHeadersLineCount).length) + 1

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

  function closeHistoryInfoMenu() {
    setHistoryInfoOpenId(null)
    setHistoryInfoAnchor(null)
  }

  function toggleHistoryInfoMenu(itemId: string, anchorEl: HTMLElement) {
    if (historyInfoOpenId === itemId) {
      closeHistoryInfoMenu()
      return
    }

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 300
    const width = 360
    let left = rect.right - width
    const aboveBottom = rect.top - 6
    const canPlaceAbove = aboveBottom - assumedMaxHeight >= margin
    const placement: 'above' | 'below' = canPlaceAbove ? 'above' : 'below'
    const top = placement === 'above' ? aboveBottom : (rect.bottom + 6)

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    setHistoryInfoOpenId(itemId)
    setHistoryInfoAnchor({ left, top, width, placement })
  }

  function toggleResponseSearch() {
    setResponseSearchOpen(prev => {
      if (prev) {
        recordResponseSearchHistory(bodyQuery)
        closeResponseSearchHistoryMenu()
      }
      return !prev
    })
  }

  function toggleResponseSearchHistoryMenu(anchorEl: HTMLElement) {
    if (!isJson) {
      closeResponseSearchHistoryMenu()
      return
    }
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

  useDismissibleLayer({
    open: schemaMenuOpen,
    onDismiss: closeSchemaMenu,
    isInsideTarget: target => {
      const wrap = schemaMenuWrapRef.current
      return !!(target && wrap && wrap.contains(target))
    },
  })

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
      logWarn('ResponseViewer.saveSchemaWithName', 'Schema save dialog aborted or failed', { error: e, fileName })
      if ((e as Error | null)?.name !== 'AbortError') throw e
    }
  }

  async function confirmSaveSchema() {
    await saveSchemaWithName(schemaFileBaseName)
    saveSchemaDialogRef.current?.close()
  }

  const inFlightCount = props.inFlightCount ?? 0
  const statusLine = inFlightCount > 0 ? 'Sending...' : 'Run a request to see the response.'

  function handleTabChange(nextTab: 'body' | 'headers' | 'history' | 'tests') {
    if (nextTab !== 'body') {
      setResponseSearchOpen(false)
      closeResponseSearchHistoryMenu()
    }
    if (nextTab !== 'history') closeHistoryInfoMenu()
    props.onTabChange(nextTab)
  }

  function closeTestDetailsDialog() {
    setSelectedTestResultId(null)
    testDetailsDialogRef.current?.close()
  }

  function openTestDetailsDialog(testId: string) {
    setSelectedTestResultId(testId)
    testDetailsDialogRef.current?.showModal()
  }

  useEffect(() => {
    if (!responseSearchOpen || tab !== 'body') return
    const t = window.setTimeout(() => responseSearchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [responseSearchOpen, tab])

  useDismissibleLayer({
    open: responseSearchHistoryOpen,
    onDismiss: closeResponseSearchHistoryMenu,
    isInsideTarget: target => {
      const t = target as HTMLElement | null
      if (!t) return false
      if (responseSearchHistoryPanelRef.current && responseSearchHistoryPanelRef.current.contains(t)) return true
      if (t.closest?.('[data-response-search-history-btn]')) return true
      return false
    },
  })

  useEffect(() => {
    if (!historyInfoOpenId) return
    if (historyItems.some(item => item.id === historyInfoOpenId)) return
    closeHistoryInfoMenu()
  }, [historyInfoOpenId, historyItems])

  useEffect(() => {
    if (!selectedTestResultId) return
    if (selectedTestResult) return
    closeTestDetailsDialog()
  }, [selectedTestResult, selectedTestResultId])

  useDismissibleLayer({
    open: !!historyInfoOpenId,
    onDismiss: closeHistoryInfoMenu,
    isInsideTarget: target => {
      const t = target as HTMLElement | null
      if (!t) return false
      if (historyInfoPanelRef.current && historyInfoPanelRef.current.contains(t)) return true
      if (t.closest?.('[data-history-info-btn]')) return true
      return false
    },
  })

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
    <div className="responseViewer" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {result ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`badge ${statusClass(result.status)}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            HTTP {result.status}{result.statusText ? ` ${compactStatusText(result.statusText)}` : ''}
          </span>
          <span className="small" style={{ opacity: 0.6, whiteSpace: 'nowrap', flex: '0 0 auto' }}>·</span>
          <span className="small" style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}>{formatResponseTime(result.timeMs)}</span>
          <span className="small" style={{ opacity: 0.6, whiteSpace: 'nowrap', flex: '0 0 auto' }}>·</span>
          <span
            ref={sizePopoverAnchorRef}
            className="small sizePopoverWrap"
            style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}
            tabIndex={0}
            onMouseEnter={openSizePopover}
            onMouseLeave={scheduleCloseSizePopover}
            onFocus={openSizePopover}
            onBlur={scheduleCloseSizePopover}
          >
            <span className="sizePopoverTrigger">{formatBytes(result.responseBytes)}</span>
          </span>
          {inFlightCount > 0 ? <span className="small">Sending…</span> : null}
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
        <button className={`tab ${tab === 'body' ? 'tabActive' : ''}`} onClick={() => handleTabChange('body')}>
          Body
        </button>
        <button className={`tab ${tab === 'headers' ? 'tabActive' : ''}`} onClick={() => handleTabChange('headers')}>
          Headers
        </button>
        <button className={`tab ${tab === 'history' ? 'tabActive' : ''}`} onClick={() => handleTabChange('history')}>
          History
        </button>
        <button className={`tab ${tab === 'tests' ? 'tabActive' : ''} ${testsTabStatusClass}`.trim()} onClick={() => handleTabChange('tests')}>
          Tests
        </button>
      </div>

      {tab === 'history' ? (
        <div className="historyList" style={{ flex: 1, minHeight: 0 }}>
          {historyItems.length ? (
            <div style={{ overflow: 'auto', minHeight: 0, display: 'grid', gap: 8, marginTop: 10 }}>
              {historyItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="historyItem"
                  title="Load"
                  onClick={() => {
                    closeHistoryInfoMenu()
                    props.onSelectHistoryItem?.(item)
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'nowrap' }}>
                        <span className={`badge ${historyStatusClass(item)}`}>
                          {formatHistoryStatus(item)}
                        </span>
                        <div className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                          {item.method}
                        </div>
                        <div className="small" style={{ fontSize: 13, opacity: 0.75, whiteSpace: 'nowrap' }}>
                          {formatDateTime24(item.createdAt)}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="iconBtn historyInfoBtn"
                      title="Details"
                      aria-label="History item details"
                      data-history-info-btn
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleHistoryInfoMenu(item.id, e.currentTarget)
                      }}
                    >
                      <span className="historyInfoGlyph">i</span>
                    </button>

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
            <div className="small" style={{ fontSize: 13, opacity: 0.75, marginTop: 10 }}>
              No history yet.
            </div>
          )}
        </div>
      ) : tab === 'body' ? (
        <div style={{ display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden', marginTop: 10, minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            <div className="codeWithGutterRows" style={{ fontSize: 13 }}>
              {bodyLines.map((line, idx) => (
                <div key={idx} className="codeRow">
                  <div className="mono codeRowGutter" style={{ width: `${bodyGutterWidthCh}ch` }} aria-hidden="true">
                    {idx + 1}
                  </div>
                  <div className="mono codeRowText">
                    {isJson ? renderJsonLineSyntax(line, bodyHighlightPlan) : isXmlBody ? renderXmlLineSyntax(line) : line}
                  </div>
                </div>
              ))}
            </div>

            {result?.file ? (
              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={onDownloadFile}>
                  Download file
                </button>
                <div className="small" style={{ opacity: 0.75 }}>
                  <span className="mono">{result.file.fileName}</span>{result.file.size ? ` · ${formatBytes(result.file.size)}` : ''}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : tab === 'tests' ? (
        <div style={{ display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden', marginTop: 10, minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            {result?.testResults?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {result.testResults.map((test, idx) => (
                  <button
                    key={`${test.source}:${test.name}:${idx}`}
                    type="button"
                    className="historyInfoRow testResultItemBtn"
                    onClick={() => openTestDetailsDialog(`${test.source}:${test.name}:${idx}`)}
                    style={{
                      border: '1px solid rgba(255,255,255,.1)',
                      background: 'rgba(255,255,255,.03)',
                      borderRadius: 10,
                      padding: '8px 10px',
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge testResultBadge ${test.passed ? 'status2xx' : 'status5xx'}`}>{test.passed ? 'PASS' : 'FAIL'}</span>
                      <span className="mono" style={{ fontSize: 13 }}>{test.name}</span>
                      <span className="small" style={{ opacity: 0.75 }}>{test.source}</span>
                      <span className="small" style={{ opacity: 0.75 }}>{formatResponseTime(test.durationMs)}</span>
                    </div>
                    {(() => {
                      const msg = (test.message || '').trim().toLowerCase()
                      const hideDefaultMessage = msg === 'passed' || msg === 'returned false' || msg === 'returned falsy value'
                      return test.passed && !hideDefaultMessage
                        ? <div className="small" style={{ marginTop: 6, opacity: 0.9 }}>{test.message}</div>
                        : null
                    })()}
                    {test.error ? <pre className="historyInfoBody mono" style={{ marginTop: 6 }}>{test.error}</pre> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="small" style={{ fontSize: 13, opacity: 0.75 }}>
                No test results for this response.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateRows: '1fr', overflow: 'hidden', marginTop: 10, minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            <div className="small" style={{ opacity: 0.85, marginBottom: 6 }}>
              Request Headers
            </div>
            <div className="codeWithGutterRows" style={{ fontSize: 13 }}>
              {requestHeadersLines.map((line, idx) => (
                <div key={idx} className="codeRow">
                  <div className="mono codeRowGutter" style={{ width: `${requestHeadersGutterWidthCh}ch` }} aria-hidden="true">
                    {idx + 1}
                  </div>
                  <div className="mono codeRowText">{line}</div>
                </div>
              ))}
            </div>

            <div className="small" style={{ opacity: 0.85, marginTop: 12, marginBottom: 6 }}>
              Response Headers
            </div>
            <div className="codeWithGutterRows" style={{ fontSize: 13 }}>
              {responseHeadersLines.map((line, idx) => (
                <div key={idx} className="codeRow">
                  <div className="mono codeRowGutter" style={{ width: `${responseHeadersGutterWidthCh}ch` }} aria-hidden="true">
                    {idx + 1}
                  </div>
                  <div className="mono codeRowText">{line}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {historyInfoOpenId && historyInfoAnchor && activeHistoryInfoItem
        ? createPortal(
          <div
            className="selectMenuPanel historyInfoPanel"
            ref={historyInfoPanelRef}
            style={{
              position: 'fixed',
              left: historyInfoAnchor.left,
              top: historyInfoAnchor.top,
              width: historyInfoAnchor.width,
              maxHeight: historyInfoMaxHeightPx ? `${historyInfoMaxHeightPx}px` : undefined,
              transform: historyInfoAnchor.placement === 'above' ? 'translateY(-100%)' : undefined,
              zIndex: 230,
            }}
          >
            <div className="historyInfoSection">
              <div className="historyInfoTitle">URL</div>
              {activeHistoryInfoUrl
                ? (
                  <div className="historyInfoList">
                    <div className="historyInfoRow">
                      <div className="mono historyInfoValue historyInfoUrlValue">{activeHistoryInfoUrl}</div>
                    </div>
                  </div>
                )
                : <div className="historyInfoEmpty small">No URL</div>}
            </div>

            <div className="historyInfoSection">
              <div className="historyInfoTitle">Headers</div>
              {(() => {
                const headers = getSortedRecordEntries(activeHistoryInfoItem.draft?.headers)
                return headers.length ? (
                  <div className="historyInfoList">
                    {headers.map(entry => (
                      <div key={entry.key} className="historyInfoRow">
                        <div className="mono historyInfoValue">{`${entry.key}: ${entry.value || ''}`}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="historyInfoEmpty small">No headers</div>
                )
              })()}
            </div>

            <div className="historyInfoSection">
              <div className="historyInfoTitle">Params</div>
              {(() => {
                const path = getSortedRecordEntries(activeHistoryInfoItem.draft?.pathParams).map(x => ({ ...x, key: `path.${x.key}` }))
                const query = getSortedRecordEntries(activeHistoryInfoItem.draft?.queryParams).map(x => ({ ...x, key: `query.${x.key}` }))
                const all = [...path, ...query]
                return all.length ? (
                  <div className="historyInfoList">
                    {all.map(entry => (
                      <div key={entry.key} className="historyInfoRow">
                        <div className="mono historyInfoValue">{`${entry.key}: ${entry.value || ''}`}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="historyInfoEmpty small">No params</div>
                )
              })()}
            </div>

            <div className="historyInfoSection">
              <div className="historyInfoTitle">Body</div>
              {typeof activeHistoryInfoItem.draft?.bodyText === 'string' && activeHistoryInfoItem.draft.bodyText.trim()
                ? <pre className="historyInfoBody mono">{activeHistoryInfoItem.draft.bodyText}</pre>
                : <div className="historyInfoEmpty small">No body</div>}
            </div>

            <div className="historyInfoSection">
              <div className="historyInfoTitle">File</div>
              {(() => {
                const rawRows: HistoryFileRow[] = Array.isArray(activeHistoryInfoItem.draft?.fileRows) ? activeHistoryInfoItem.draft.fileRows : []
                const files = rawRows
                  .map(row => {
                    const fieldName = typeof row?.fieldName === 'string' ? row.fieldName.trim() : ''
                    const fileName = typeof row?.fileName === 'string' ? row.fileName.trim() : ''
                    const isActive = row?.isActive !== false
                    return { fieldName, fileName, isActive }
                  })
                  .filter(row => row.isActive && row.fieldName && row.fileName)
                  .sort((a, b) => a.fieldName.localeCompare(b.fieldName))

                return files.length ? (
                  <div className="historyInfoList">
                    {files.map((entry, idx) => (
                      <div key={`${entry.fieldName}:${entry.fileName}:${idx}`} className="historyInfoRow">
                        <div className="mono historyInfoValue">{`${entry.fieldName}: ${entry.fileName}`}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="historyInfoEmpty small">No files</div>
                )
              })()}
            </div>
          </div>,
          document.body,
        )
        : null}

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
                  placeholder="Examples: id = 5 | id = 24, 25 | name ~ Max | height >= 166 | $..id"
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
                title="Help"
                aria-label="Search help"
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
                onClick={toggleResponseSearch}
                disabled={!result || tab !== 'body'}
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
              <b>How to use search</b>
              <button
                className="iconBtn"
                onClick={() => responseSearchHelpDialogRef.current?.close()}
                aria-label="Close"
                title="Close"
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
                    A query starts with <span className="mono">$</span> and runs against the JSON response.
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Examples: <span className="mono">$..id</span>, <span className="mono">$.data.items[*].name</span>, <span className="mono">$[0]</span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Docs:{' '}
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
                  <div><b>Filter</b></div>
                  <div>
                    Format: <span className="mono">field op value</span>. Matches across all objects inside the JSON (recursively).
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Examples: <span className="mono">id = 5</span>, <span className="mono">status != 404</span>, <span className="mono">height &gt;= 166</span>, <span className="mono">name ~ "Max"</span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Operators: <span className="mono">= == != &gt;= &lt;= &gt; &lt; ~ !~</span> (for <span className="mono">~</span>, substring match, case-insensitive).
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Lists: <span className="mono">id = 1, 2, 3</span>. Strings can be quoted: <span className="mono">"text"</span> or <span className="mono">'text'</span>.
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Field paths: <span className="mono">user.name = "Bob"</span> (dot-separated).
                  </div>
                </div>
              </div>
            </div>
          </dialog>

          <dialog
            ref={testDetailsDialogRef}
            className="modal"
            style={{ fontSize: 13 }}
            onCancel={e => {
              e.preventDefault()
              closeTestDetailsDialog()
            }}
            onClick={e => {
              if (e.target === e.currentTarget) closeTestDetailsDialog()
            }}
          >
            <div className="modalHeader">
              <b>Test Result Details</b>
              <button className="iconBtn" onClick={closeTestDetailsDialog} aria-label="Close" title="Close">
                <CloseIcon />
              </button>
            </div>

            {selectedTestResult ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`badge testResultBadge ${selectedTestResult.passed ? 'status2xx' : 'status5xx'}`}>{selectedTestResult.passed ? 'PASS' : 'FAIL'}</span>
                  <span className="mono">{selectedTestResult.name}</span>
                  <span className="small" style={{ opacity: 0.75 }}>{selectedTestResult.source}</span>
                  <span className="small" style={{ opacity: 0.75 }}>{formatResponseTime(selectedTestResult.durationMs)}</span>
                </div>

                {!!selectedTestResult.message.trim()
                  && typeof selectedTestResult.expected === 'undefined'
                  && typeof selectedTestResult.actual === 'undefined' ? (
                  <div className="small" style={{ opacity: 0.9 }}>{selectedTestResult.message}</div>
                ) : null}

                {selectedTestResult.error ? <pre className="historyInfoBody mono">{selectedTestResult.error}</pre> : null}

                {typeof selectedTestResult.expected !== 'undefined' || typeof selectedTestResult.actual !== 'undefined'
                  ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="small" style={{ marginBottom: 6, opacity: 0.85 }}>Expected</div>
                        <pre className="historyInfoBody mono">{formatUnknownForPanel(selectedTestResult.expected)}</pre>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="small" style={{ marginBottom: 6, opacity: 0.85 }}>Actual</div>
                        <pre className="historyInfoBody mono">{formatUnknownForPanel(selectedTestResult.actual)}</pre>
                      </div>
                    </div>
                  )
                  : null}
              </div>
            ) : (
              <div className="small" style={{ opacity: 0.75 }}>Test result not found.</div>
            )}
          </dialog>
      </div>
    </div>
  )
}
