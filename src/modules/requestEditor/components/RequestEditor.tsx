import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Collection, HttpMethod, RequestItem, RequestParam } from '../../collectionTree'
import type { Environment, GlobalSqlConnectionItem } from '../../../shared/types/environment'
import type { RequestDraft, RequestHistoryItem } from '../../../shared/types/requestHistory'
import { copyText } from '../../../shared/utils/clipboard'
import { uid } from '../../../shared/utils/id'
import { logWarn } from '../../../shared/utils/logger'
import { computeEffectiveBaseUrl, isAbsoluteUrl, joinUrlParts } from '../../../shared/utils/url'
import type { RunResult } from '../../requestRunner/runRequest'
import { buildCurlCommand } from '../../requestRunner/buildCurl'
import { runDbSql } from '../../environment'
import {
  getVariableSuggestions,
  parseDataDrivenDataset,
  type DataDrivenDatasetFormat,
  type DataDrivenRow,
  type VariableSuggestion,
} from '../../../shared/utils/variables'
import { DataDrivenInputEditorSheet } from './sheets/DataDrivenInputEditorSheet'
import { DataDrivenReportSheet, type DataDrivenRunItem, type DataDrivenRunReport } from './sheets/DataDrivenReportSheet'
import { RequestEditorBodyFileSection } from './body/RequestEditorBodyFileSection'
import { RequestEditorToolbar } from './layout/RequestEditorToolbar'
import type { MenuAnchor } from './rows/RequestEditorRows'
import { RequestEditorDataSection, RequestEditorTestsSection } from './sections/RequestEditorAuxSections'
import { RequestEditorFilePicker } from './sections/RequestEditorFileSection'
import { RequestEditorHeadersTab, RequestEditorParamsTab } from './sections/RequestEditorTabSections'
import { loadRequestDraft, saveRequestDraft } from '../state/draft/draftStorage'
import {
  buildHeaderDraftState,
  createFileRowsRestorer,
  hydrateRequestEditorDraft,
  toRequestDraft,
} from '../state/draft/draftState'
import { renameFlagKey, renameStoreKey, replaceKeyInOrder, setFlagForKey } from '../state/params/keyState'
import {
  deleteHeaderCaseInsensitive,
  findHeaderKeyCaseInsensitive,
  findKeyIndexCaseInsensitive,
  getHeaderCaseInsensitive,
  headerIsInactive,
  mergeHeadersCaseInsensitive,
  normalizeHeaderParams,
  removeInactiveHeaders,
  replaceKeyInOrderCaseInsensitive,
  setFlagForHeaderName,
  setHeaderCaseInsensitive,
} from '../state/headers/headerState'
import { addValueHistoryEntry, getHeaderValueHistoryItems, loadValueHistory, removeValueHistoryEntry, saveValueHistory, type ValueHistoryKind, type ValueHistoryStore } from '../state/headers/valueHistory'
import type { FileRow, HeaderDraftRowState, HeaderDraftState, QueryDraftRowState } from '../types'
import { buildRequestEditorTabExtensions, type RequestEditorTabContext, type RequestEditorTabExtension } from '../extensions'
import { useRequestEditorSend } from '../hooks/useRequestEditorSend'
import { beautifyBody, type BeautifyBodyFormat } from '../utils/bodyBeautify'
import { contentTypeForBodyFormat, inferBodyFormatFromBodyText, inferBodyFormatFromContentType, labelForBodyFormat, templateForBodyFormat, type BodyFormat } from '../utils/bodyFormat'
import { applyPathParamsForDisplay, applySchemeIfHostLike, applyVariablesForDisplay, extractPathParamNamesFromTemplate, normalizeMockRoutePath, parseUrlInput, shouldDefaultOpenFileTab } from '../utils/requestUrl'
import { buildRequestEditorSqlConnections } from '../utils/sqlConnections'
import type { TestFunctionRef } from '../../tests'

const DEFAULT_METHOD_OPTIONS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const requestEditorFileRows = createFileRowsRestorer()
const IS_MAC = typeof navigator !== 'undefined'
  && (
    (navigator.platform || '').toLowerCase().includes('mac')
    || navigator.userAgent.toLowerCase().includes('mac os')
  )

export function RequestEditor(props: {
  environment?: Environment
  globalSqlConnections?: GlobalSqlConnectionItem[]
  globalTestFunctions?: TestFunctionRef[]
  tabExtensions?: RequestEditorTabExtension[]
  collection: Collection
  request: RequestItem
  latestResult?: RunResult | null
  inFlightCount?: number
  onBeforeSend?: (requestId: string, item: RequestHistoryItem) => void
  onSendStart?: (requestId: string, runId: string) => void
  onSendEnd?: (requestId: string, runId: string) => void
  onResult: (requestId: string, result: RunResult, runId: string) => void
  onChangeMethod?: (method: HttpMethod) => void
  applyDraft?: { token: string, draft: RequestDraft } | null
}) {
  const bodyFileInputRef = useRef<HTMLInputElement | null>(null)
  const activeFileRowIdRef = useRef<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const urlEditStartRef = useRef('')
  const methodMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const methodAddInputRef = useRef<HTMLInputElement | null>(null)
  const valueHistoryMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const enumMenuPanelRef = useRef<HTMLDivElement | null>(null)

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [queryDraftRows, setQueryDraftRows] = useState<QueryDraftRowState[]>([])
  const [queryKeyOrder, setQueryKeyOrder] = useState<string[]>([])
  const [queryParamKeyOverrides, setQueryParamKeyOverrides] = useState<Record<string, string>>({})
  const [disabledQueryParamNames, setDisabledQueryParamNames] = useState<Record<string, true>>({})
  const [inactiveQueryParamNames, setInactiveQueryParamNames] = useState<Record<string, true>>({})
  const [headerOverrides, setHeaderOverrides] = useState<Record<string, string>>({})
  const [disabledHeaderNames, setDisabledHeaderNames] = useState<Record<string, true>>({})
  const [inactiveHeaderNames, setInactiveHeaderNames] = useState<Record<string, true>>({})
  const [headerDraftRows, setHeaderDraftRows] = useState<HeaderDraftRowState[]>([])
  const [headerKeyOrder, setHeaderKeyOrder] = useState<string[]>([])
  const headerDraftSaveRef = useRef<HeaderDraftState>({
    headerOverrides: {},
    headerDraftRows: [],
    headerKeyOrder: [],
    disabledHeaderNames: {},
    inactiveHeaderNames: {},
  })

  headerDraftSaveRef.current = buildHeaderDraftState({
    headerOverrides,
    headerDraftRows,
    headerKeyOrder,
    disabledHeaderNames,
    inactiveHeaderNames,
  })
  const [valueHistory, setValueHistory] = useState<ValueHistoryStore>(() => loadValueHistory())
  const [valueHistoryMenuOpenId, setValueHistoryMenuOpenId] = useState<string | null>(null)
  const [valueHistoryMenuAnchor, setValueHistoryMenuAnchor] = useState<MenuAnchor | null>(null)
  const [enumMenuOpenId, setEnumMenuOpenId] = useState<string | null>(null)
  const [enumMenuAnchor, setEnumMenuAnchor] = useState<MenuAnchor | null>(null)
  const [fileRows, setFileRows] = useState<FileRow[]>(() => (
    [{ id: uid('frow'), fieldName: '', file: null, fileName: '', isActive: true }]
  ))
  const [loadedRequestId, setLoadedRequestId] = useState(props.request.id)
  const [baseUrlKey, setBaseUrlKey] = useState('baseUrl')
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const copyMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const [urlTemplateOverride, setUrlTemplateOverride] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [urlDraftText, setUrlDraftText] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [customMethodOptions, setCustomMethodOptions] = useState<string[]>([])
  const [isAddingMethod, setIsAddingMethod] = useState(false)
  const [methodAddDraft, setMethodAddDraft] = useState('')
  const [activeTabId, setActiveTabId] = useState('headers')

  function normalizeMethodOption(raw: string) {
    return raw.trim().toUpperCase()
  }

  function appendCustomMethod(method: string) {
    setCustomMethodOptions(prev => {
      if (DEFAULT_METHOD_OPTIONS.includes(method)) return prev
      if (prev.includes(method)) return prev
      return [...prev, method]
    })
  }

  function commitMethodAdd(applyToRequest = false) {
    const next = normalizeMethodOption(methodAddDraft)
    setMethodAddDraft('')
    setIsAddingMethod(false)
    if (!next) return

    appendCustomMethod(next)
    if (applyToRequest) props.onChangeMethod?.(next)
  }

  function startMethodAdd() {
    setMethodAddDraft('')
    setIsAddingMethod(true)
  }

  function cancelMethodAdd() {
    setMethodAddDraft('')
    setIsAddingMethod(false)
  }

  function selectMethod(method: string) {
    setMethodMenuOpen(false)
    props.onChangeMethod?.(method)
  }

  function removeCustomMethod(method: string) {
    if (props.request.method === method) {
      props.onChangeMethod?.('GET')
    }
    setCustomMethodOptions(prev => prev.filter(m => m !== method))
  }

  const headerValueHistoryItems = useMemo(() => getHeaderValueHistoryItems(valueHistory, 10), [valueHistory])

  function recordValueHistory(kind: ValueHistoryKind, key: string, value: string) {
    setValueHistory(prev => {
      const next = addValueHistoryEntry(prev, kind, key, value, 10)
      if (next === prev) return prev
      saveValueHistory(next)
      return next
    })
  }

  function deleteValueHistoryItem(kind: ValueHistoryKind, key: string, value: string) {
    setValueHistory(prev => {
      const next = removeValueHistoryEntry(prev, kind, key, value)
      if (next === prev) return prev
      saveValueHistory(next)
      return next
    })
  }

  function clearAllValueHistory() {
    const empty: ValueHistoryStore = { header: {}, query: {}, path: {} }
    setValueHistory(empty)
    saveValueHistory(empty)
  }

  function persistHeaderDraftPatch(patch: Partial<HeaderDraftState>) {
    if (!props.request.id) return

    const nextHeaderState: HeaderDraftState = {
      ...headerDraftSaveRef.current,
      ...patch,
    }
    headerDraftSaveRef.current = nextHeaderState

    saveRequestDraft(props.request.id, {
      ...(loadRequestDraft(props.request.id) ?? {}),
      ...nextHeaderState,
    })
  }

  function setHeaderDraftRowsAndPersist(updater: (prev: HeaderDraftRowState[]) => HeaderDraftRowState[]) {
    const next = updater(headerDraftSaveRef.current.headerDraftRows)
    headerDraftSaveRef.current = { ...headerDraftSaveRef.current, headerDraftRows: next }
    setHeaderDraftRows(next)
    persistHeaderDraftPatch({ headerDraftRows: next })
  }

  function closeValueHistoryMenu() {
    setValueHistoryMenuOpenId(null)
    setValueHistoryMenuAnchor(null)
  }

  function closeEnumMenu() {
    setEnumMenuOpenId(null)
    setEnumMenuAnchor(null)
  }

  function toggleValueHistoryMenu(menuId: string, anchorEl: HTMLElement) {
    if (valueHistoryMenuOpenId === menuId) {
      closeValueHistoryMenu()
      return
    }

    closeEnumMenu()

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 240

    let width = rect.width
    if (width < 220) width = 220
    if (width > 520) width = 520

    let left = rect.left
    let top = rect.bottom + 6

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    if (top + assumedMaxHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 6 - assumedMaxHeight)
    }

    setValueHistoryMenuOpenId(menuId)
    setValueHistoryMenuAnchor({ left, top, width })
  }

  function toggleEnumMenu(menuId: string, anchorEl: HTMLElement) {
    if (enumMenuOpenId === menuId) {
      closeEnumMenu()
      return
    }

    closeValueHistoryMenu()

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 240

    let width = rect.width
    if (width < 220) width = 220
    if (width > 520) width = 520

    let left = rect.left
    let top = rect.bottom + 6

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    if (top + assumedMaxHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 6 - assumedMaxHeight)
    }

    setEnumMenuOpenId(menuId)
    setEnumMenuAnchor({ left, top, width })
  }

  function commitFocusedValueFieldToState() {
    const active = document.activeElement as (HTMLInputElement | HTMLTextAreaElement | null)
    if (!active || !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return
    if (active.dataset.commitOnBlur === '1') {
      active.blur()
      return
    }

    const wrap = active.closest<HTMLElement>('[data-commit-kind]')
    if (!wrap) return

    const kind = wrap.dataset.commitKind
    const key = wrap.dataset.commitKey ?? ''
    const rawName = wrap.dataset.commitRaw ?? key
    const isSpec = wrap.dataset.commitSpec === '1'
    const rowId = wrap.dataset.commitRowid ?? ''
    const value = String(active.value ?? '')

    if (kind === 'path') {
      setPathParams(prev => {
        if (value !== '') return { ...prev, [key]: value }
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      return
    }

    if (kind === 'query') {
      setQueryParams(prev => {
        const next = { ...prev }
        next[key] = value
        if (isSpec && rawName && key !== rawName) delete next[rawName]
        return next
      })
      return
    }

    if (kind === 'header') {
      if (!key) return
      setHeaderValueForRequest(key, value)
      return
    }

    if (kind === 'queryDraft') {
      if (!rowId) return
      setQueryDraftRows(prev => prev.map(r => (r.id === rowId ? { ...r, value } : r)))
      return
    }

    if (kind === 'headerDraft') {
      if (!rowId) return
      setHeaderDraftRowsAndPersist(prev => prev.map(r => (r.id === rowId ? { ...r, value } : r)))
      return
    }
  }

  useLayoutEffect(() => {
    return () => {
      commitFocusedValueFieldToState()
    }
  }, [props.request.id])

  useEffect(() => {
    if (!valueHistoryMenuOpenId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (valueHistoryMenuPanelRef.current && valueHistoryMenuPanelRef.current.contains(t)) return
      if (t.closest?.('[data-value-history-btn]')) return
      closeValueHistoryMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeValueHistoryMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [valueHistoryMenuOpenId])

  useEffect(() => {
    if (!enumMenuOpenId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (enumMenuPanelRef.current && enumMenuPanelRef.current.contains(t)) return
      if (t.closest?.('[data-enum-anchor]')) return
      closeEnumMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeEnumMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enumMenuOpenId])

  const [preSqlScript, setPreSqlScript] = useState('')
  const [postSqlScript, setPostSqlScript] = useState('')
  const [preSqlScriptIsActive, setPreSqlScriptIsActive] = useState(true)
  const [postSqlScriptIsActive, setPostSqlScriptIsActive] = useState(true)
  const [selectedSqlConnectionId, setSelectedSqlConnectionId] = useState<string | null>(null)

  const sqlConnections = useMemo(
    () => buildRequestEditorSqlConnections({
      collection: props.collection,
      environment: props.environment,
      globalSqlConnections: props.globalSqlConnections,
    }),
    [props.collection, props.environment, props.globalSqlConnections],
  )

  const selectedSqlConnection = useMemo(
    () => sqlConnections.find(x => x.id === selectedSqlConnectionId) ?? null,
    [selectedSqlConnectionId, sqlConnections],
  )

  useEffect(() => {
    setSelectedSqlConnectionId(prev => {
      if (prev && sqlConnections.some(x => x.id === prev)) return prev
      return sqlConnections[0]?.id ?? null
    })
  }, [sqlConnections])

  const baseUrl = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const envKey = props.environment?.baseUrlKey || 'baseUrl'
    const preferredKey = baseUrlKey || envKey
    const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
    const envBaseUrl = envVars[resolvedKey] ?? ''
    const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
    const effective = computeEffectiveBaseUrl(envBaseUrl, props.collection.baseUrl)
    return applySchemeIfHostLike(effective, scheme)
  }, [baseUrlKey, props.collection.baseUrl, props.environment])

  const resolvedBaseUrlDisplayKey = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const envKey = props.environment?.baseUrlKey || 'baseUrl'
    const preferredKey = baseUrlKey || envKey
    const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
    const rawEnvBaseUrl = String(envVars[resolvedKey] ?? '').trim()
    return rawEnvBaseUrl ? resolvedKey : ''
  }, [baseUrlKey, props.environment])

  const variables = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const envKey = props.environment?.baseUrlKey || 'baseUrl'
    const preferredKey = baseUrlKey || envKey
    const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
    const selectedBaseUrl = envVars[resolvedKey] ?? ''
    const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
    const effective = computeEffectiveBaseUrl(selectedBaseUrl, props.collection.baseUrl)
    const effectiveWithScheme = applySchemeIfHostLike(effective, scheme)
    return { ...envVars, scheme, baseUrl: effectiveWithScheme }
  }, [baseUrlKey, props.collection.baseUrl, props.environment])

  const [dataDrivenInput, setDataDrivenInput] = useState('')
  const [dataDrivenInputEditorOpen, setDataDrivenInputEditorOpen] = useState(false)
  const [dataDrivenInputEditorText, setDataDrivenInputEditorText] = useState('')
  const [selectedTestFunction, setSelectedTestFunction] = useState('')
  const testFunctionMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [testFunctionMenuOpen, setTestFunctionMenuOpen] = useState(false)
  const [requestTestScript, setRequestTestScript] = useState('')
  const availableGlobalTestFunctions = props.globalTestFunctions ?? []
  const availableGlobalTestFunctionNames = useMemo(
    () => Array.from(new Set(
      availableGlobalTestFunctions
        .map(item => `${item.className.trim()}.${item.functionName.trim()}`)
        .filter(name => name && name !== '.'),
    )),
    [availableGlobalTestFunctions],
  )

  useEffect(() => {
    if (!selectedTestFunction) return
    if (availableGlobalTestFunctionNames.includes(selectedTestFunction)) return
    if (!selectedTestFunction.includes('.')) {
      const matches = availableGlobalTestFunctionNames.filter(name => name.endsWith(`.${selectedTestFunction}`))
      if (matches.length === 1) {
        setSelectedTestFunction(matches[0])
        return
      }
    }
    setSelectedTestFunction('')
  }, [availableGlobalTestFunctionNames, selectedTestFunction])

  useEffect(() => {
    if (!testFunctionMenuOpen) return
    function onPointerDown(e: PointerEvent) {
      const wrap = testFunctionMenuWrapRef.current
      const target = e.target as Node | null
      if (!wrap || !target) return
      if (wrap.contains(target)) return
      setTestFunctionMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [testFunctionMenuOpen])

  useEffect(() => {
    if (activeTabId === 'tests') return
    setTestFunctionMenuOpen(false)
  }, [activeTabId])
  const [dataDrivenRunReport, setDataDrivenRunReport] = useState<DataDrivenRunReport | null>(null)
  const [dataDrivenRunning, setDataDrivenRunning] = useState(false)
  const [dataDrivenReportSheetOpen, setDataDrivenReportSheetOpen] = useState(false)
  const dataDrivenAbortRef = useRef<AbortController | null>(null)

  const variableSuggestions = useMemo<VariableSuggestion[]>(() => getVariableSuggestions(variables), [variables])
  const dataDrivenParsed = useMemo(() => {
    const text = dataDrivenInput.trim()
    if (!text) return { format: 'json' as DataDrivenDatasetFormat, rows: [] as DataDrivenRow[], error: '' }
    try {
      const parsed = parseDataDrivenDataset(text)
      return { ...parsed, error: '' }
    } catch (error) {
      return {
        format: 'json' as DataDrivenDatasetFormat,
        rows: [] as DataDrivenRow[],
        error: (error as Error | null)?.message || 'Failed to parse data',
      }
    }
  }, [dataDrivenInput])

  const effectiveQueryParams = useMemo(() => {
    const next: Record<string, string> = { ...queryParams }
    for (const row of queryDraftRows) {
      const k = row.name.trim()
      if (!k) continue
      if (row.value === '') continue
      next[k] = row.value
    }
    return next
  }, [queryDraftRows, queryParams])

  const urlEditorText = useMemo(() => {
    const override = urlTemplateOverride.trim()
    const baseTemplate =
      override
        ? (isAbsoluteUrl(override) || override.startsWith('//'))
          ? override
          : baseUrl
            ? joinUrlParts(baseUrl, override)
            : override
        : baseUrl
          ? joinUrlParts(baseUrl, props.request.path)
          : props.request.urlTemplate

    const inactiveDraftKeys = new Set(queryDraftRows.filter(r => !r.isActive).map(r => r.name.trim()).filter(Boolean))
    const pairs: string[] = []
    for (const [k, v] of Object.entries(effectiveQueryParams)) {
      if (inactiveQueryParamNames[k]) continue
      if (inactiveDraftKeys.has(k)) continue
      if (!k) continue
      if (v === '') continue
      pairs.push(`${k}=${v}`)
    }
    if (!pairs.length) return baseTemplate
    return baseTemplate + (baseTemplate.includes('?') ? '&' : '?') + pairs.join('&')
  }, [baseUrl, effectiveQueryParams, inactiveQueryParamNames, props.request.path, props.request.urlTemplate, queryDraftRows, urlTemplateOverride])

  const derivedPathParamNames = useMemo(() => {
    const raw = isEditingUrl ? urlDraftText : urlEditorText
    const parsed = parseUrlInput(raw)
    return extractPathParamNamesFromTemplate(parsed.template || '')
  }, [isEditingUrl, urlDraftText, urlEditorText])

  const pathParamsList = useMemo(() => {
    const spec = props.request.params.filter(p => p.in === 'path')
    const specNames = new Set(spec.map(p => p.name))
    const extras = derivedPathParamNames
      .filter(n => !specNames.has(n))
      .map(n => ({ name: n, in: 'path' as const, required: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...spec, ...extras]
  }, [derivedPathParamNames, props.request.params])

  const envHeaders = (props.environment?.headers ?? {}) as Record<string, string>
  const requestBaseHeaders = (props.request.headers ?? {}) as Record<string, string>



  const committedHeaders = useMemo(() => {
    const next = mergeHeadersCaseInsensitive(envHeaders, requestBaseHeaders, headerOverrides)
    for (const key of Object.keys(disabledHeaderNames)) deleteHeaderCaseInsensitive(next, key)
    return next
  }, [disabledHeaderNames, envHeaders, headerOverrides, requestBaseHeaders])

  const effectiveHeaders = useMemo(() => {
    const next: Record<string, string> = { ...committedHeaders }
    for (const row of headerDraftRows) {
      if (!row.isActive) continue
      const k = row.name.trim()
      if (!k) continue
      if (row.value === '') continue
      setHeaderCaseInsensitive(next, k, row.value)
    }
    return next
  }, [committedHeaders, headerDraftRows])

  const envOnlyHeaderNames = useMemo(() => {
    return Object.keys(envHeaders).filter(k => !findHeaderKeyCaseInsensitive(requestBaseHeaders, k) && k.toLowerCase() !== 'authorization')
  }, [envHeaders, requestBaseHeaders])

  const hasDisabledEnvOnlyHeaders = useMemo(() => {
    return envOnlyHeaderNames.some(k => !!findHeaderKeyCaseInsensitive(disabledHeaderNames, k))
  }, [disabledHeaderNames, envOnlyHeaderNames])

  function reloadFromGlobalHeaders() {
    setDisabledHeaderNames(prev => {
      let changed = false
      const next = { ...prev }
      for (const k of envOnlyHeaderNames) {
        if (deleteHeaderCaseInsensitive(next, k)) changed = true
      }
      return changed ? next : prev
    })

    setHeaderDraftRows(prev => {
      if (prev.some(r => r.name.trim() || r.value !== '')) return prev
      return []
    })
  }

  function setHeaderValueForRequest(headerName: string, nextValue: string) {
    const baseKey = findHeaderKeyCaseInsensitive(requestBaseHeaders, headerName)
    const envKey = findHeaderKeyCaseInsensitive(envHeaders, headerName)
    const baseHas = !!baseKey
    const envHas = !!envKey
    const current = headerDraftSaveRef.current
    const storageKey = baseKey ?? envKey ?? findHeaderKeyCaseInsensitive(current.headerOverrides, headerName) ?? headerName
    const defaultValue = baseKey ? (requestBaseHeaders[baseKey] ?? '') : envKey ? (envHeaders[envKey] ?? '') : ''

    if (nextValue === '') {
      const nextInactiveHeaderNames = setFlagForHeaderName(current.inactiveHeaderNames, headerName, true)
      const existingOverrideKey = findHeaderKeyCaseInsensitive(current.headerOverrides, headerName)
      const nextHeaderOverrides = existingOverrideKey
        ? (() => {
          const next = { ...current.headerOverrides }
          delete next[existingOverrideKey]
          return next
        })()
        : current.headerOverrides
      let nextDisabledHeaderNames = current.disabledHeaderNames

      if (baseHas || envHas) {
        nextDisabledHeaderNames = { ...current.disabledHeaderNames, [storageKey]: true }
      } else {
        const existingKey = findHeaderKeyCaseInsensitive(current.disabledHeaderNames, headerName)
        if (existingKey) {
          const next = { ...current.disabledHeaderNames }
          delete next[existingKey]
          nextDisabledHeaderNames = next
        }
      }

      setInactiveHeaderNames(nextInactiveHeaderNames)
      setHeaderOverrides(nextHeaderOverrides)
      setDisabledHeaderNames(nextDisabledHeaderNames)
      persistHeaderDraftPatch({
        inactiveHeaderNames: nextInactiveHeaderNames,
        headerOverrides: nextHeaderOverrides,
        disabledHeaderNames: nextDisabledHeaderNames,
      })
      return
    }

    const nextInactiveHeaderNames = setFlagForHeaderName(current.inactiveHeaderNames, headerName, true)
    const existingDisabledKey = findHeaderKeyCaseInsensitive(current.disabledHeaderNames, headerName)
    const nextDisabledHeaderNames = existingDisabledKey
      ? (() => {
        const next = { ...current.disabledHeaderNames }
        delete next[existingDisabledKey]
        return next
      })()
      : current.disabledHeaderNames

    const nextHeaderOverrides = (() => {
      if ((baseHas || envHas) && nextValue === defaultValue) {
        const existingKey = findHeaderKeyCaseInsensitive(current.headerOverrides, headerName)
        if (!existingKey) return current.headerOverrides
        const next = { ...current.headerOverrides }
        delete next[existingKey]
        return next
      }

      const next = { ...current.headerOverrides }
      const existingKey = findHeaderKeyCaseInsensitive(next, headerName)
      if (existingKey && existingKey !== storageKey) delete next[existingKey]
      next[storageKey] = nextValue
      return next
    })()

    setInactiveHeaderNames(nextInactiveHeaderNames)
    setDisabledHeaderNames(nextDisabledHeaderNames)
    setHeaderOverrides(nextHeaderOverrides)
    persistHeaderDraftPatch({
      inactiveHeaderNames: nextInactiveHeaderNames,
      disabledHeaderNames: nextDisabledHeaderNames,
      headerOverrides: nextHeaderOverrides,
    })
  }

  const displayUrl = useMemo(() => {
    const override = urlTemplateOverride.trim()
    const url =
      override
        ? (isAbsoluteUrl(override) || override.startsWith('//'))
          ? override
          : baseUrl
            ? joinUrlParts(baseUrl, override)
            : override
        : baseUrl
          ? joinUrlParts(baseUrl, props.request.path)
          : props.request.urlTemplate
    const withPathParams = applyPathParamsForDisplay(url, pathParams)

    const usp = new URLSearchParams()
    const inactiveDraftKeys = new Set(queryDraftRows.filter(r => !r.isActive).map(r => r.name.trim()).filter(Boolean))
    for (const [k, v] of Object.entries(effectiveQueryParams)) {
      if (inactiveQueryParamNames[k]) continue
      if (inactiveDraftKeys.has(k)) continue
      const nextK = applyVariablesForDisplay(k, variables)
      const nextV = applyVariablesForDisplay(v, variables)
      if (nextK && nextV !== '') usp.set(nextK, nextV)
    }
    const qs = usp.toString()
    if (!qs) return withPathParams
    return withPathParams + (withPathParams.includes('?') ? '&' : '?') + qs
  }, [baseUrl, effectiveQueryParams, inactiveQueryParamNames, pathParams, props.request.path, props.request.urlTemplate, queryDraftRows, variables, urlTemplateOverride])

  const editorUrlMainDisplay = useMemo(() => {
    if (!resolvedBaseUrlDisplayKey || !baseUrl) return displayUrl
    if (!displayUrl.startsWith(baseUrl)) return displayUrl
    return `{{${resolvedBaseUrlDisplayKey}}}${displayUrl.slice(baseUrl.length)}`
  }, [baseUrl, displayUrl, resolvedBaseUrlDisplayKey])

  const canSend = useMemo(() => {
    const override = urlTemplateOverride.trim()
    if (!override) return !!baseUrl
    if (isAbsoluteUrl(override) || override.startsWith('//')) return true
    return !!baseUrl
  }, [baseUrl, urlTemplateOverride])

  const variableKeys = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const keys = Object.keys(envVars)
      .filter(k => k !== 'scheme')
      .filter(k => /url/i.test(k))
      .sort((a, b) => a.localeCompare(b))
    if (!keys.length && baseUrlKey) return [baseUrlKey]
    if (baseUrlKey && !keys.includes(baseUrlKey)) return [...keys, baseUrlKey].sort((a, b) => a.localeCompare(b))
    return keys
  }, [baseUrlKey, props.environment])

  const [bodyText, setBodyText] = useState('')
  const [bodyCopied, setBodyCopied] = useState(false)
  const [isBodyOpen, setIsBodyOpen] = useState(!!props.request.body)
  const [isFileOpen, setIsFileOpen] = useState(shouldDefaultOpenFileTab(props.request.method, props.request.body?.contentType))
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>('auto')
  const [autoDetectedBodyFormat, setAutoDetectedBodyFormat] = useState<Exclude<BodyFormat, 'auto'> | null>(null)
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyFormatMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [bodyFormatMenuOpen, setBodyFormatMenuOpen] = useState(false)
  const bodyFormatMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const [bodyFormatMenuAnchor, setBodyFormatMenuAnchor] = useState<MenuAnchor>({
    left: 0,
    top: 0,
    width: 120,
  })
  const inFlightCount = props.inFlightCount ?? 0
  const isSending = inFlightCount > 0
  const sendRef = useRef<(() => void) | null>(null)

  function requestDefaultBodyText() {
    const b = props.request.body?.example
    if (b === undefined) return ''
    if (typeof b === 'string') return b
    return JSON.stringify(b, null, 2)
  }

  function applyHydratedDraftState(nextState: ReturnType<typeof hydrateRequestEditorDraft>, persist = false) {
    setPathParams(nextState.pathParams)
    setQueryParams(nextState.queryParams)
    setQueryDraftRows(nextState.queryDraftRows)
    setQueryParamKeyOverrides(nextState.queryParamKeyOverrides)
    setDisabledQueryParamNames(nextState.disabledQueryParamNames)
    setInactiveQueryParamNames(nextState.inactiveQueryParamNames)
    setQueryKeyOrder(nextState.queryKeyOrder)
    setHeaderOverrides(nextState.headerOverrides)
    setDisabledHeaderNames(nextState.disabledHeaderNames)
    setInactiveHeaderNames(nextState.inactiveHeaderNames)
    setHeaderDraftRows(nextState.headerDraftRows)
    setHeaderKeyOrder(nextState.headerKeyOrder)
    setBaseUrlKey(nextState.baseUrlKey)
    setBodyText(nextState.bodyText)
    setIsBodyOpen(!!props.request.body)
    setBodyFormat(nextState.bodyFormat)
    setAutoDetectedBodyFormat(null)
    setIsFileOpen(shouldDefaultOpenFileTab(props.request.method, props.request.body?.contentType))
    setUrlTemplateOverride(nextState.urlTemplateOverride)
    setIsEditingUrl(false)
    setUrlDraftText('')
    setFileRows(nextState.fileRows)
    setPreSqlScript(nextState.preSqlScript)
    setPostSqlScript(nextState.postSqlScript)
    setPreSqlScriptIsActive(nextState.preSqlScriptIsActive)
    setPostSqlScriptIsActive(nextState.postSqlScriptIsActive)
    setSelectedSqlConnectionId(nextState.selectedSqlConnectionId)
    setDataDrivenInput(nextState.dataDrivenInput)
    setSelectedTestFunction(nextState.selectedTestFunction)
    setRequestTestScript(nextState.requestTestScript)
    setDataDrivenInputEditorText('')
    setDataDrivenInputEditorOpen(false)
    setDataDrivenRunReport(null)
    setDataDrivenRunning(false)
    setDataDrivenReportSheetOpen(false)
    dataDrivenAbortRef.current?.abort()
    dataDrivenAbortRef.current = null
    setLoadedRequestId(props.request.id)

    if (persist) saveRequestDraft(props.request.id, toRequestDraft(nextState))
  }

  const hasExampleBody = props.request.body?.example !== undefined

  function reloadExampleBodyText() {
    const next = requestDefaultBodyText()
    setBodyText(next)
    bodyTextareaRef.current?.focus()
  }

  useLayoutEffect(() => {
    const nextState = hydrateRequestEditorDraft({
      draft: loadRequestDraft(props.request.id),
      request: props.request,
      environmentHeaders: props.environment?.headers,
      environmentBaseUrlKey: props.environment?.baseUrlKey,
      mode: 'load',
      requestDefaultBodyText: requestDefaultBodyText(),
      restoreFileRows: (storedRows, fallbackFieldNames) => requestEditorFileRows.restore(props.request.id, storedRows, fallbackFieldNames),
    })
    applyHydratedDraftState(nextState)
  }, [props.request.body, props.request.headers, props.request.id, props.request.params])

  const applyDraftToken = props.applyDraft?.token ?? null
  const applyDraftRef = useRef<RequestDraft | null>(null)
  useEffect(() => {
    applyDraftRef.current = props.applyDraft?.draft ?? null
  }, [props.applyDraft])

  useEffect(() => {
    const draft = applyDraftRef.current
    if (!applyDraftToken || !draft) return
    const nextState = hydrateRequestEditorDraft({
      draft,
      request: props.request,
      environmentHeaders: props.environment?.headers,
      environmentBaseUrlKey: props.environment?.baseUrlKey,
      mode: 'apply',
      requestDefaultBodyText: requestDefaultBodyText(),
      restoreFileRows: (storedRows, fallbackFieldNames) => requestEditorFileRows.restore(props.request.id, storedRows, fallbackFieldNames),
    })
    applyHydratedDraftState(nextState, true)
  }, [applyDraftToken])

  useEffect(() => {
    if (!props.request.id) return
    if (loadedRequestId !== props.request.id) return
    saveRequestDraft(props.request.id, toRequestDraft({
      pathParams,
      queryParams,
      queryDraftRows,
      queryKeyOrder,
      queryParamKeyOverrides,
      disabledQueryParamNames,
      inactiveQueryParamNames,
      headerOverrides,
      disabledHeaderNames,
      inactiveHeaderNames,
      headerDraftRows,
      headerKeyOrder,
      bodyText,
      bodyFormat,
      baseUrlKey,
      urlTemplateOverride,
      fileRows,
      preSqlScript,
      postSqlScript,
      preSqlScriptIsActive,
      postSqlScriptIsActive,
      selectedSqlConnectionId,
      dataDrivenInput,
      selectedTestFunction,
      requestTestScript,
    }))
  }, [
    baseUrlKey,
    bodyText,
    bodyFormat,
    disabledHeaderNames,
    inactiveHeaderNames,
    fileRows,
    loadedRequestId,
    headerOverrides,
    headerKeyOrder,
    headerDraftRows,
    pathParams,
    postSqlScript,
    preSqlScript,
    preSqlScriptIsActive,
    postSqlScriptIsActive,
    selectedSqlConnectionId,
    props.request.id,
    queryParams,
    queryKeyOrder,
    queryDraftRows,
    inactiveQueryParamNames,
    queryParamKeyOverrides,
    disabledQueryParamNames,
    urlTemplateOverride,
    dataDrivenInput,
    selectedTestFunction,
    requestTestScript,
  ])

  useEffect(() => {
    if (!props.request.id) return
    if (loadedRequestId !== props.request.id) return
    requestEditorFileRows.remember(props.request.id, fileRows)
  }, [fileRows, loadedRequestId, props.request.id])

  const grouped = useMemo(() => {
    const p = props.request.params
    return {
      path: p.filter(x => x.in === 'path'),
      query: p.filter(x => x.in === 'query'),
      header: p.filter(x => x.in === 'header'),
    }
  }, [props.request.params])

  const querySpecNames = useMemo(() => new Set(grouped.query.map(q => q.name)), [grouped.query])
  const disabledQuerySpecNames = useMemo(
    () => new Set(Object.keys(disabledQueryParamNames).filter(Boolean)),
    [disabledQueryParamNames],
  )
  const queryParamsList = useMemo(() => {
    const overriddenKeys = new Set(Object.values(queryParamKeyOverrides).filter(Boolean))
    const spec = grouped.query.filter(Boolean).filter(p => !disabledQuerySpecNames.has(p.name))
    const out: RequestParam[] = [...spec]
    for (const k of Object.keys(queryParams)) {
      if (querySpecNames.has(k)) continue
      if (overriddenKeys.has(k)) continue
      out.push({ name: k, in: 'query', required: false })
    }
    const byName = new Map<string, RequestParam>()
    for (const p of out) {
      const raw = p.name
      const isSpec = querySpecNames.has(raw)
      const key = isSpec ? (queryParamKeyOverrides[raw] ?? raw) : raw
      if (!key || byName.has(key)) continue
      byName.set(key, p)
    }
    const ordered: RequestParam[] = []
    const seen = new Set<string>()

    for (const key of queryKeyOrder) {
      const param = byName.get(key)
      if (!param || seen.has(key)) continue
      seen.add(key)
      ordered.push(param)
    }

    for (const p of out) {
      const raw = p.name
      const isSpec = querySpecNames.has(raw)
      const key = isSpec ? (queryParamKeyOverrides[raw] ?? raw) : raw
      if (!key || seen.has(key)) continue
      seen.add(key)
      ordered.push(p)
    }

    return ordered
  }, [disabledQuerySpecNames, grouped.query, queryKeyOrder, queryParams, queryParamKeyOverrides, querySpecNames])

  useEffect(() => {
    const requiredSpecNames = grouped.query
      .filter(Boolean)
      .filter(p => !!p.required)
      .map(p => (p.name || '').trim())
      .filter(Boolean)

    if (!requiredSpecNames.length) return

    const moves: Array<{ from: string, to: string }> = []
    for (const rawName of requiredSpecNames) {
      const overridden = queryParamKeyOverrides[rawName]
      if (typeof overridden !== 'string' || !overridden.trim()) continue
      if (overridden === rawName) continue
      moves.push({ from: overridden, to: rawName })
    }

    if (!moves.length) return

    setQueryParams(prev => {
      let next = prev
      for (const { from, to } of moves) {
        if (!Object.prototype.hasOwnProperty.call(next, from)) continue
        const v = next[from]
        if (next === prev) next = { ...prev }
        delete next[from]
        if (!Object.prototype.hasOwnProperty.call(next, to)) next[to] = v
      }
      return next
    })
    setInactiveQueryParamNames(prev => {
      let next = prev
      for (const { from, to } of moves) next = renameFlagKey(next, from, to)
      return next
    })
    setQueryKeyOrder(prev => {
      let next = prev
      for (const { from, to } of moves) next = replaceKeyInOrder(next, from, to)
      return next
    })
    setQueryParamKeyOverrides(prev => {
      let changed = false
      const next = { ...prev }
      for (const rawName of requiredSpecNames) {
        if (!(rawName in next)) continue
        delete next[rawName]
        changed = true
      }
      return changed ? next : prev
    })
  }, [grouped.query, queryParamKeyOverrides])

  const headerParams = useMemo(
    () => normalizeHeaderParams(grouped.header, committedHeaders, headerKeyOrder),
    [grouped.header, committedHeaders, headerKeyOrder],
  )
  const headerSpecNames = useMemo(() => new Set(grouped.header.map(h => h.name)), [grouped.header])
  const visibleHeaderParams = useMemo(
    () => headerParams.filter(h => h.name.toLowerCase() !== 'authorization'),
    [headerParams],
  )

  useEffect(() => {
    const overriddenKeys = new Set(Object.values(queryParamKeyOverrides).filter(Boolean))
    const specVisible = grouped.query
      .filter(Boolean)
      .filter(p => !disabledQuerySpecNames.has(p.name))
      .map(p => (queryParamKeyOverrides[p.name] ?? p.name))
      .filter(Boolean)
    const extras = Object.keys(queryParams).filter(k => !querySpecNames.has(k) && !overriddenKeys.has(k))
    const visible = [...specVisible, ...extras]

    setQueryKeyOrder(prev => {
      const keep = new Set(visible)
      const next = prev.filter(k => keep.has(k))
      for (const k of visible) {
        if (!next.includes(k)) next.push(k)
      }
      return next
    })
  }, [disabledQuerySpecNames, grouped.query, queryParamKeyOverrides, queryParams, querySpecNames])

  useEffect(() => {
    const specVisible = grouped.header
      .filter(Boolean)
      .map(h => h.name)
      .filter(n => n && n.toLowerCase() !== 'authorization')
    const extras = Object.keys(committedHeaders).filter(k => k.toLowerCase() !== 'authorization')
    const visible = [...specVisible, ...extras]

    setHeaderKeyOrder(prev => {
      const keepNeedles = new Set(visible.map(k => k.toLowerCase()))
      let next = prev.filter(k => keepNeedles.has((k ?? '').toLowerCase()))
      for (const k of visible) {
        if (findKeyIndexCaseInsensitive(next, k) < 0) next = [...next, k]
      }
      return next
    })
  }, [committedHeaders, grouped.header])

  useEffect(() => {
    if (headerDraftRows.length > 0) return
    if (visibleHeaderParams.length > 0) return
    setHeaderDraftRows([{ id: uid('hrow'), name: '', value: '', isActive: true }])
  }, [headerDraftRows.length, visibleHeaderParams.length])

  useEffect(() => {
    if (queryDraftRows.length > 0) return
    if (queryParamsList.length > 0) return
    setQueryDraftRows([{ id: uid('qrow'), name: '', value: '', isActive: true }])
  }, [queryDraftRows.length, queryParamsList.length])

  const hasAnyEditableVisibleHeaderRow = useMemo(() => {
    return visibleHeaderParams.some(h => {
      const isSpec = headerSpecNames.has(h.name)
      return !isSpec
    })
  }, [envHeaders, headerSpecNames, requestBaseHeaders, visibleHeaderParams])

  const hasParamsTabData = useMemo(() => {
    const hasActivePathValues = Object.entries(pathParams).some(([name, value]) => !!name.trim() && !!String(value ?? '').trim())
    const hasActiveQueryValues = queryParamsList.some(p => {
      const rawName = p.name
      const effectiveName = (queryParamKeyOverrides[rawName] ?? rawName).trim()
      if (!effectiveName) return false
      if (inactiveQueryParamNames[effectiveName]) return false
      return !!String(queryParams[effectiveName] ?? '').trim()
    })
    const hasActiveQueryDraftRows = queryDraftRows.some(r => !!r.isActive && !!r.name.trim() && !!r.value.trim())
    return hasActivePathValues || hasActiveQueryValues || hasActiveQueryDraftRows
  }, [inactiveQueryParamNames, pathParams, queryDraftRows, queryParamKeyOverrides, queryParams, queryParamsList])

  const hasHeadersTabData = useMemo(() => {
    const hasActiveCommittedHeaders = Object.entries(committedHeaders).some(([name, value]) => {
      if (name.toLowerCase() === 'authorization') return false
      if (headerIsInactive(inactiveHeaderNames, name)) return false
      return !!String(value ?? '').trim()
    })
    const hasActiveHeaderDraftRows = headerDraftRows.some(r => {
      const name = r.name.trim().toLowerCase()
      if (!r.isActive) return false
      if (!name || name === 'authorization') return false
      return !!r.value.trim()
    })
    return hasActiveCommittedHeaders || hasActiveHeaderDraftRows
  }, [committedHeaders, headerDraftRows, inactiveHeaderNames])
  const hasDataTabData = useMemo(() => !!dataDrivenInput.trim(), [dataDrivenInput])
  const hasTestsTabData = useMemo(
    () => !!selectedTestFunction.trim() || !!requestTestScript.trim(),
    [requestTestScript, selectedTestFunction],
  )

  const mockRoutePathDefault = useMemo(() => {
    const raw = (isEditingUrl ? urlDraftText : urlEditorText).trim()
    const parsed = parseUrlInput(raw)
    const template = (parsed.template || '').trim()
    if (!template) return normalizeMockRoutePath(props.request.path || '/')

    try {
      if (isAbsoluteUrl(template)) {
        const u = new URL(template)
        return normalizeMockRoutePath(u.pathname || '/')
      }
      if (template.startsWith('//')) {
        const u = new URL(`http:${template}`)
        return normalizeMockRoutePath(u.pathname || '/')
      }
    } catch {
      // Fall through to template-based parsing.
    }

    const withoutQuery = template.split('?')[0] || ''
    return normalizeMockRoutePath(withoutQuery || props.request.path || '/')
  }, [isEditingUrl, props.request.path, urlDraftText, urlEditorText])

  const mockTargetOriginDefault = useMemo(() => {
    const raw = (isEditingUrl ? urlDraftText : urlEditorText).trim()
    const parsed = parseUrlInput(raw)
    const template = (parsed.template || '').trim()

    const tryGetOrigin = (value: string): string => {
      const v = (value || '').trim()
      if (!v) return ''
      try {
        if (isAbsoluteUrl(v)) return new URL(v).origin
        if (v.startsWith('//')) return new URL(`http:${v}`).origin
      } catch {
        return ''
      }
      return ''
    }

    const fromTemplate = tryGetOrigin(template)
    if (fromTemplate) return fromTemplate
    const fromBase = tryGetOrigin(baseUrl)
    if (fromBase) return fromBase
    return ''
  }, [baseUrl, isEditingUrl, urlDraftText, urlEditorText])

  const effectiveContentType = useMemo(() => {
    const activeHeaders = removeInactiveHeaders(effectiveHeaders, inactiveHeaderNames)
    const fromHeadersOrSpec = (getHeaderCaseInsensitive(activeHeaders, 'Content-Type') || props.request.body?.contentType || '').trim()
    return bodyFormat === 'auto' ? fromHeadersOrSpec : contentTypeForBodyFormat(bodyFormat)
  }, [bodyFormat, effectiveHeaders, inactiveHeaderNames, props.request.body?.contentType])
  const isMultipartForm = effectiveContentType.toLowerCase().includes('multipart/form-data')
  const methodAllowsBody = props.request.method !== 'GET' && props.request.method !== 'HEAD'
  const supportsFileSend = methodAllowsBody

  const resolvedBodyFormatForBeautify = useMemo((): BeautifyBodyFormat => {
    if (bodyFormat === 'auto') return inferBodyFormatFromBodyText(bodyText) ?? inferBodyFormatFromContentType(effectiveContentType)
    if (bodyFormat === 'json' || bodyFormat === 'xml' || bodyFormat === 'yaml' || bodyFormat === 'text') return bodyFormat
    return 'text'
  }, [bodyFormat, bodyText, effectiveContentType])

  useEffect(() => {
    if (bodyFormat !== 'auto') {
      setAutoDetectedBodyFormat(prev => (prev === null ? prev : null))
      return
    }

    const raw = bodyText.trim()
    if (!raw) {
      setAutoDetectedBodyFormat(prev => (prev === null ? prev : null))
      return
    }

    // Keep JSON editor active while user types intermediate invalid JSON.
    // This prevents accidental fallback to another format in auto mode.
    if (raw.startsWith('{') || raw.startsWith('[')) {
      setAutoDetectedBodyFormat(prev => (prev === 'json' ? prev : 'json'))
      return
    }

    const inferred = inferBodyFormatFromBodyText(bodyText)
    if (inferred) {
      setAutoDetectedBodyFormat(prev => (prev === inferred ? prev : inferred))
      return
    }

    // Keep the previously detected format while user is typing invalid intermediate text.
    // This prevents editor remount/focus loss in auto mode.
    setAutoDetectedBodyFormat(prev => prev)
  }, [bodyFormat, bodyText])

  const bodyFormatForDisplay = useMemo<BodyFormat>(() => {
    if (bodyFormat !== 'auto') return bodyFormat
    return autoDetectedBodyFormat ?? 'auto'
  }, [autoDetectedBodyFormat, bodyFormat])
  const tabExtensionContext = useMemo<RequestEditorTabContext>(() => ({
    collection: props.collection,
    request: props.request,
    latestResult: props.latestResult,
    mockRouteMethodDefault: props.request.method,
    mockRoutePathDefault,
    mockTargetOriginDefault,
    environment: props.environment,
    globalSqlConnections: props.globalSqlConnections,
    variableSuggestions,
    committedHeaders,
    setHeaderValue: setHeaderValueForRequest,
    sqlConnections,
    selectedSqlConnectionId,
    setSelectedSqlConnectionId,
    preSqlScript,
    postSqlScript,
    preSqlScriptIsActive,
    postSqlScriptIsActive,
    setPreSqlScript,
    setPostSqlScript,
    setPreSqlScriptIsActive,
    setPostSqlScriptIsActive,
  }), [
    committedHeaders,
    props.collection,
    props.environment,
    props.globalSqlConnections,
    props.latestResult,
    props.request,
    variableSuggestions,
    mockRoutePathDefault,
    mockTargetOriginDefault,
    sqlConnections,
    selectedSqlConnectionId,
    preSqlScript,
    postSqlScript,
    preSqlScriptIsActive,
    postSqlScriptIsActive,
  ])

  const requestEditorTabExtensions = useMemo(
    () => buildRequestEditorTabExtensions(props.tabExtensions),
    [props.tabExtensions],
  )

  const tabs = useMemo(() => {
    const coreTabs = [
      { id: 'params', label: 'Params', hasData: hasParamsTabData },
      { id: 'headers', label: 'Headers', hasData: hasHeadersTabData },
      { id: 'data', label: 'Data', hasData: hasDataTabData },
    ]

    const extTabs = requestEditorTabExtensions.map(tab => ({
      id: tab.id,
      label: tab.label,
      hasData: !!tab.hasData?.(tabExtensionContext),
    }))

    const allTabs = [...coreTabs, ...extTabs]
    const dataIndex = allTabs.findIndex(tab => tab.id === 'data')
    const authIndex = allTabs.findIndex(tab => tab.id === 'authorization')
    const next = [...allTabs]
    if (dataIndex >= 0 && authIndex >= 0) {
      ;[next[dataIndex], next[authIndex]] = [next[authIndex], next[dataIndex]]
    }

    const withoutTests = next.filter(tab => tab.id !== 'tests')
    const sqlIndex = withoutTests.findIndex(tab => tab.id === 'sql')
    const dataIndexAfter = withoutTests.findIndex(tab => tab.id === 'data')
    const testsTab = { id: 'tests', label: 'Tests', hasData: hasTestsTabData }
    const insertAt = sqlIndex >= 0
      ? sqlIndex
      : (dataIndexAfter >= 0 ? dataIndexAfter + 1 : withoutTests.length)
    return [
      ...withoutTests.slice(0, insertAt),
      testsTab,
      ...withoutTests.slice(insertAt),
    ]
  }, [hasDataTabData, hasHeadersTabData, hasParamsTabData, hasTestsTabData, requestEditorTabExtensions, tabExtensionContext])

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? 'headers')
    }
  }, [activeTabId, tabs])
  const useJsonBodyEditor = bodyFormatForDisplay === 'json'

  function pickBodyFormat(nextFormat: BodyFormat) {
    setBodyFormatMenuOpen(false)
    setIsBodyOpen(true)
    const isReplaceable = !bodyText.trim() || bodyText.trim() === templateForBodyFormat(bodyFormat).trim()
    setBodyFormat(nextFormat)
    if (isReplaceable) setBodyText(templateForBodyFormat(nextFormat))
  }

  useEffect(() => {
    if (!bodyFormatMenuOpen) return

    function update() {
      const wrap = bodyFormatMenuWrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      setBodyFormatMenuAnchor(prev => {
        const next = { left: rect.left, top: rect.bottom + 6, width: rect.width }
        if (prev.left === next.left && prev.top === next.top && prev.width === next.width) return prev
        return next
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [bodyFormatMenuOpen])

  useEffect(() => {
    if (!bodyFormatMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const wrap = bodyFormatMenuWrapRef.current
      const t = e.target as Node | null
      if (wrap && t && wrap.contains(t)) return
      const panel = bodyFormatMenuPanelRef.current
      if (panel && t && panel.contains(t)) return
      setBodyFormatMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setBodyFormatMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [bodyFormatMenuOpen])

  function addHeaderDraftRow() {
    setHeaderDraftRowsAndPersist(prev => [...prev, { id: uid('hrow'), name: '', value: '', isActive: true }])
  }

  function addQueryDraftRow() {
    setQueryDraftRows(prev => [...prev, { id: uid('qrow'), name: '', value: '', isActive: true }])
  }


  async function startDataDrivenRun() {
    if (dataDrivenRunning || isSending) return
    if (!canSend) return
    if (dataDrivenParsed.error) {
      setDataDrivenRunReport({
        startedAt: Date.now(),
        finishedAt: Date.now(),
        total: 0,
        completed: 0,
        passed: 0,
        failed: 0,
        canceled: false,
        format: dataDrivenParsed.format,
        items: [],
        error: dataDrivenParsed.error,
      })
      return
    }

    const rows = dataDrivenParsed.rows
    if (!rows.length) {
      setDataDrivenRunReport({
        startedAt: Date.now(),
        finishedAt: Date.now(),
        total: 0,
        completed: 0,
        passed: 0,
        failed: 0,
        canceled: false,
        format: dataDrivenParsed.format,
        items: [],
        error: 'No rows to run. Add JSON array/object rows or CSV with header row.',
      })
      return
    }

    const abortController = new AbortController()
    dataDrivenAbortRef.current = abortController
    const startedAt = Date.now()
    setDataDrivenRunning(true)
    setDataDrivenRunReport({
      startedAt,
      finishedAt: null,
      total: rows.length,
      completed: 0,
      passed: 0,
      failed: 0,
      canceled: false,
      format: dataDrivenParsed.format,
      items: [],
    })

    const items: DataDrivenRunItem[] = []
    try {
      for (let i = 0; i < rows.length; i++) {
        if (abortController.signal.aborted) break
        const row = rows[i]
        const effectiveVariables = { ...variables, ...row }
        const result = await sendWithVariables({
          variablesOverride: effectiveVariables,
          abortController,
          requestIdKey: `${props.request.id}:data-driven`,
          dataRow: row,
        })
        if (!result) continue
        const nextItem: DataDrivenRunItem = {
          rowNumber: i + 1,
          status: result.status,
          ok: result.ok,
          timeMs: result.timeMs,
          responseBytes: result.responseBytes,
          responseBodyText: result.bodyText,
          variables: row,
        }
        items.push(nextItem)
        const passed = items.filter(x => x.ok).length
        const completed = items.length
        setDataDrivenRunReport({
          startedAt,
          finishedAt: null,
          total: rows.length,
          completed,
          passed,
          failed: completed - passed,
          canceled: false,
          format: dataDrivenParsed.format,
          items: [...items],
        })
      }
    } finally {
      const completed = items.length
      const passed = items.filter(x => x.ok).length
      setDataDrivenRunReport(prev => ({
        startedAt,
        finishedAt: Date.now(),
        total: rows.length,
        completed,
        passed,
        failed: completed - passed,
        canceled: abortController.signal.aborted,
        format: dataDrivenParsed.format,
        items: prev?.items ?? items,
        error: prev?.error,
      }))
      setDataDrivenRunning(false)
      if (dataDrivenAbortRef.current === abortController) dataDrivenAbortRef.current = null
    }
  }

  function cancelDataDrivenRun() {
    dataDrivenAbortRef.current?.abort()
  }

  function openDataDrivenInputEditor() {
    setDataDrivenInputEditorText(dataDrivenInput)
    setDataDrivenInputEditorOpen(true)
  }

  function closeDataDrivenInputEditorAndSave() {
    setDataDrivenInput(dataDrivenInputEditorText)
    setDataDrivenInputEditorOpen(false)
  }

  function saveDataDrivenInputFromEditor() {
    setDataDrivenInput(dataDrivenInputEditorText)
  }

  const triggerSendShortcut = useCallback((): boolean => {
    if (!canSend || isSending) return false
    commitFocusedValueFieldToState()
    sendRef.current?.()
    return true
  }, [canSend, isSending])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      const target = e.target as HTMLElement | null
      if (target?.closest('dialog')) return
      if (!triggerSendShortcut()) return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [triggerSendShortcut])

  async function copyBodyText() {
    await copyText(bodyText)
    setBodyCopied(true)
    setTimeout(() => setBodyCopied(false), 900)
  }

  function applyBodyTextareaReplacement(rangeStart: number, rangeEnd: number, replacement: string, nextSelStart: number, nextSelEnd: number) {
    const ta = bodyTextareaRef.current
    if (!ta) return

    ta.focus()
    ta.selectionStart = rangeStart
    ta.selectionEnd = rangeEnd

    const ok = document.execCommand?.('insertText', false, replacement) ?? false
    if (!ok) ta.setRangeText(replacement, rangeStart, rangeEnd, 'preserve')

    ta.selectionStart = nextSelStart
    ta.selectionEnd = nextSelEnd
    setBodyText(ta.value)
  }

  function applyBodyEnterIndent() {
    const ta = bodyTextareaRef.current
    if (!ta) return

    const value = ta.value
    const selStart = ta.selectionStart ?? 0
    const selEnd = ta.selectionEnd ?? 0

    const lineStart = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1
    const lineEndBoundary = value.indexOf('\n', selEnd)
    const lineEnd = lineEndBoundary === -1 ? value.length : lineEndBoundary

    const linePrefix = value.slice(lineStart, selStart)
    const currentIndent = (value.slice(lineStart, lineEnd).match(/^[\t ]*/) ?? [''])[0]
    const indentUnit = currentIndent.includes('\t') ? '\t' : '  '

    const lastNonWs = (() => {
      for (let i = linePrefix.length - 1; i >= 0; i--) {
        const c = linePrefix[i]
        if (c !== ' ' && c !== '\t') return c
      }
      return ''
    })()

    const nextNonWs = (() => {
      const suffix = value.slice(selEnd, lineEnd)
      for (let i = 0; i < suffix.length; i++) {
        const c = suffix[i]
        if (c !== ' ' && c !== '\t') return c
      }
      return ''
    })()

    const shouldIncrease = lastNonWs === '{' || lastNonWs === '['
    const shouldSplitClose = shouldIncrease && (nextNonWs === '}' || nextNonWs === ']')

    if (shouldSplitClose) {
      const replacement = `\n${currentIndent}${indentUnit}\n${currentIndent}`
      const caret = selStart + (`\n${currentIndent}${indentUnit}`).length
      applyBodyTextareaReplacement(selStart, selEnd, replacement, caret, caret)
      return
    }

    const replacement = `\n${currentIndent}${shouldIncrease ? indentUnit : ''}`
    const caret = selStart + replacement.length
    applyBodyTextareaReplacement(selStart, selEnd, replacement, caret, caret)
  }

  function beautifyBodyText() {
    const ta = bodyTextareaRef.current
    const raw = ta?.value ?? bodyText
    try {
      const nextValue = beautifyBody(raw, resolvedBodyFormatForBeautify)
      if (ta) applyBodyTextareaReplacement(0, ta.value.length, nextValue, nextValue.length, nextValue.length)
      else setBodyText(nextValue)
    } catch (error) {
      logWarn('beautifyBodyText', 'Failed to beautify request body text', { error })
    }
  }

  function renderFilePicker() {
    return (
      <RequestEditorFilePicker
        bodyFileInputRef={bodyFileInputRef}
        activeFileRowIdRef={activeFileRowIdRef}
        fileRows={fileRows}
        setFileRows={setFileRows}
      />
    )
  }

  function applyBodyTabIndent(isUnindent: boolean) {
    const ta = bodyTextareaRef.current
    if (!ta) return

    const value = ta.value
    const selStart = ta.selectionStart ?? 0
    const selEnd = ta.selectionEnd ?? 0

    const indent = '\t'
    const startLine = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1
    const endLineBoundary = value.indexOf('\n', selEnd)
    const endLine = endLineBoundary === -1 ? value.length : endLineBoundary

    const mid = value.slice(startLine, endLine)
    const lines = mid.split('\n')

    const removeIndentLen = (line: string) => {
      if (line.startsWith('\t')) return 1
      if (line.startsWith('  ')) return 2
      if (line.startsWith(' ')) return 1
      return 0
    }

    const isSingleLine = startLine === endLine || !mid.includes('\n')
    const isCollapsed = selStart === selEnd

    if (!isUnindent && isCollapsed && isSingleLine) {
      applyBodyTextareaReplacement(selStart, selEnd, indent, selStart + indent.length, selStart + indent.length)
      return
    }

    if (isUnindent && isCollapsed) {
      const len = removeIndentLen(value.slice(startLine, startLine + 2))
      if (len > 0) {
        const nextPos = Math.max(startLine, selStart - len)
        applyBodyTextareaReplacement(startLine, startLine + len, '', nextPos, nextPos)
      }
      return
    }

    if (!isUnindent) {
      const nextMid = lines.map(l => indent + l).join('\n')
      const nextSelStart = selStart + indent.length
      const nextSelEnd = selEnd + indent.length * lines.length
      applyBodyTextareaReplacement(startLine, endLine, nextMid, nextSelStart, nextSelEnd)
      return
    }

    const removeLens = lines.map(removeIndentLen)
    const totalRemoved = removeLens.reduce<number>((a, b) => a + b, 0)
    const firstRemoved = removeLens[0] ?? 0
    const nextMid = lines.map((l, i) => l.slice(removeLens[i] ?? 0)).join('\n')
    const nextSelStart = Math.max(startLine, selStart - firstRemoved)
    const nextSelEnd = Math.max(nextSelStart, selEnd - totalRemoved)
    applyBodyTextareaReplacement(startLine, endLine, nextMid, nextSelStart, nextSelEnd)
  }

  function onPlainBodyResizeHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!IS_MAC) return
    const textarea = bodyTextareaRef.current
    if (!textarea) return
    const textareaEl: HTMLTextAreaElement = textarea
    e.preventDefault()
    const startY = e.clientY
    const startHeight = textareaEl.getBoundingClientRect().height
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const next = Math.max(140, startHeight + (ev.clientY - startY))
      textareaEl.style.height = `${next}px`
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const handlePlainBodyKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (triggerSendShortcut()) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      applyBodyTabIndent(e.shiftKey)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      applyBodyEnterIndent()
      return
    }
    if (e.key === '"') {
      const ta = bodyTextareaRef.current
      if (!ta) return

      const selStart = ta.selectionStart ?? 0
      const selEnd = ta.selectionEnd ?? 0

      if (selStart === selEnd && ta.value[selStart] === '"') {
        e.preventDefault()
        e.stopPropagation()
        const nextPos = selStart + 1
        ta.selectionStart = nextPos
        ta.selectionEnd = nextPos
        return
      }

      e.preventDefault()
      e.stopPropagation()

      if (selStart !== selEnd) {
        const selected = ta.value.slice(selStart, selEnd)
        applyBodyTextareaReplacement(selStart, selEnd, `"${selected}"`, selStart + 1, selEnd + 1)
        return
      }

      applyBodyTextareaReplacement(selStart, selEnd, '""', selStart + 1, selStart + 1)
      return
    }
    if (e.key === '{' || e.key === '[') {
      const ta = bodyTextareaRef.current
      if (!ta) return

      const selStart = ta.selectionStart ?? 0
      const selEnd = ta.selectionEnd ?? 0

      e.preventDefault()
      e.stopPropagation()

      const open = e.key
      const close = open === '{' ? '}' : ']'

      if (selStart !== selEnd) {
        const selected = ta.value.slice(selStart, selEnd)
        applyBodyTextareaReplacement(selStart, selEnd, `${open}${selected}${close}`, selStart + 1, selEnd + 1)
        return
      }

      applyBodyTextareaReplacement(selStart, selEnd, `${open}${close}`, selStart + 1, selStart + 1)
    }
  }, [applyBodyEnterIndent, applyBodyTabIndent, applyBodyTextareaReplacement, triggerSendShortcut])

  const { buildSendSnapshot, send, sendWithVariables, cancelInFlightSend, abortAllSends } = useRequestEditorSend({
    request: props.request,
    pathParams,
    pathParamsList,
    groupedQueryParams: grouped.query,
    queryDraftRows,
    querySpecNames,
    queryParams,
    effectiveQueryParams,
    inactiveQueryParamNames,
    disabledQueryParamNames,
    queryParamKeyOverrides,
    headerDraftRows,
    headerOverrides,
    disabledHeaderNames,
    inactiveHeaderNames,
    committedHeaders,
    envHeaders,
    requestBaseHeaders,
    fileRows,
    bodyText,
    bodyFormat,
    bodyFormatForDisplay,
    effectiveContentType,
    methodAllowsBody,
    isMultipartForm,
    supportsFileSend,
    baseUrl,
    baseUrlKey,
    urlTemplateOverride,
    variables,
    displayUrl,
    dataDrivenInput,
    selectedTestFunction,
    requestTestScript,
    availableGlobalTestFunctions,
    preSqlScript,
    postSqlScript,
    preSqlScriptIsActive,
    postSqlScriptIsActive,
    selectedSqlConnectionId,
    selectedSqlConnection,
    runDbSqlFn: runDbSql,
    onBeforeSend: props.onBeforeSend,
    onSendStart: props.onSendStart,
    onSendEnd: props.onSendEnd,
    onResult: props.onResult,
    applyVariablesForDisplay,
    contentTypeForBodyFormat,
  })

  async function copyUrlText() {
    await copyText(displayUrl)
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 900)
  }

  async function copyCurlText() {
    const snapshot = buildSendSnapshot()
    const curl = buildCurlCommand({
      request: props.request,
      baseUrl,
      urlTemplateOverride,
      variables,
      pathParams,
      queryParams: snapshot.effectiveQueryParamsForSend,
      headers: snapshot.effectiveHeadersForSend,
      headerEntries: snapshot.headerEntriesForSend,
      bodyText,
      files: snapshot.filesForMultipart,
      emptyFileFieldNames: snapshot.emptyFileFieldNamesForMultipart,
      file: snapshot.fileForOctetStream,
      fileFieldName: snapshot.fileFieldName,
      formFields: snapshot.formFields,
    })
    await copyText(curl)
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 900)
  }

  useEffect(() => {
    sendRef.current = () => void send()
    return () => {
      sendRef.current = null
    }
  }, [send])

  useEffect(() => {
    return () => {
      abortAllSends()
      dataDrivenAbortRef.current?.abort()
      dataDrivenAbortRef.current = null
    }
  }, [abortAllSends])

  function startUrlEdit(placeCursorAtEnd = false) {
    urlEditStartRef.current = urlEditorText.trim()
    setUrlDraftText(urlEditorText)
    setIsEditingUrl(true)
    window.setTimeout(() => {
      const input = urlInputRef.current
      if (!input) return
      input.focus()
      if (!placeCursorAtEnd) return
      const end = input.value.length
      input.setSelectionRange(end, end)
    }, 0)
  }

  function cancelUrlEdit() {
    setIsEditingUrl(false)
    setUrlDraftText('')
  }

  function commitUrlEdit(nextValue?: string) {
    const raw = (nextValue ?? urlInputRef.current?.value ?? urlDraftText).trim()
    setIsEditingUrl(false)
    if (raw === urlEditStartRef.current) return
    if (!raw) return
    const parsed = parseUrlInput(raw)

    const baseNorm = baseUrl.replace(/\/+$/, '')
    const baseScheme = /^https:\/\//i.test(baseNorm) ? 'https' : 'http'
    const baseWithoutScheme = baseNorm.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    let parsedTemplate = parsed.template.trim()
    if (
      parsedTemplate &&
      !isAbsoluteUrl(parsedTemplate) &&
      !parsedTemplate.startsWith('//') &&
      baseWithoutScheme
    ) {
      const normalizedInput = parsedTemplate.replace(/^\/+/, '')
      if (normalizedInput.toLowerCase().startsWith(baseWithoutScheme.toLowerCase())) {
        parsedTemplate = `${baseScheme}://${normalizedInput}`
      }
    }
    const parsedNorm = parsedTemplate.replace(/\/+$/, '')

    const defaultAbsolute = (baseUrl ? joinUrlParts(baseUrl, props.request.path) : props.request.urlTemplate).trim()
    const defaultAbsoluteNorm = defaultAbsolute.replace(/\/+$/, '')

    const nextOverride = (() => {
      if (!parsedTemplate) return ''
      if (!baseNorm) return parsedTemplate
      if (parsedNorm === defaultAbsoluteNorm) return ''

      if (parsedNorm.startsWith(baseNorm)) {
        const rest = parsedTemplate.slice(baseNorm.length)
        const relative = rest.startsWith('/') ? rest : `/${rest}`
        return relative.trim() === props.request.path.trim() ? '' : relative
      }

      return parsedTemplate
    })()

    setUrlTemplateOverride(nextOverride)

    const specPathNames = props.request.params.filter(p => p.in === 'path').map(p => p.name).filter(Boolean)
    const nextPathNames = new Set<string>([...specPathNames, ...extractPathParamNamesFromTemplate(parsedTemplate || '')])
    setPathParams(prev => {
      let changed = false
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (nextPathNames.has(key)) continue
        delete next[key]
        changed = true
      }
      return changed ? next : prev
    })

    if (parsed.hasQuery) {
      setQueryParams(parsed.query)
      setQueryKeyOrder(Object.keys(parsed.query))
      setInactiveQueryParamNames({})
      setQueryParamKeyOverrides({})
      setDisabledQueryParamNames({})
      setQueryDraftRows([])
    }
  }

  useEffect(() => {
    setMethodMenuOpen(false)
    setIsAddingMethod(false)
    setMethodAddDraft('')
    setCopyMenuOpen(false)
  }, [props.request.id])

  useEffect(() => {
    if (!methodMenuOpen || !isAddingMethod) return
    methodAddInputRef.current?.focus()
    methodAddInputRef.current?.select()
  }, [isAddingMethod, methodMenuOpen])

  useEffect(() => {
    if (!copyMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = copyMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setCopyMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCopyMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [copyMenuOpen])

  useEffect(() => {
    if (!methodMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = methodMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      if (isAddingMethod) commitMethodAdd(true)
      setMethodMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMethodMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isAddingMethod, methodAddDraft, methodMenuOpen])

  const visibleCustomMethodOptions = useMemo(() => {
    const next = [...customMethodOptions]
    const selected = normalizeMethodOption(props.request.method)
    if (selected && !DEFAULT_METHOD_OPTIONS.includes(selected) && !next.includes(selected)) next.push(selected)
    return next
  }, [customMethodOptions, props.request.method])

  return (
    <div className="editor">
      <RequestEditorToolbar
        requestMethod={props.request.method}
        onChangeMethod={props.onChangeMethod}
        methodMenuOpen={methodMenuOpen}
        setMethodMenuOpen={setMethodMenuOpen}
        methodMenuWrapRef={methodMenuWrapRef}
        defaultMethodOptions={DEFAULT_METHOD_OPTIONS}
        visibleCustomMethodOptions={visibleCustomMethodOptions}
        isAddingMethod={isAddingMethod}
        methodAddDraft={methodAddDraft}
        setMethodAddDraft={setMethodAddDraft}
        methodAddInputRef={methodAddInputRef}
        commitMethodAdd={commitMethodAdd}
        cancelMethodAdd={cancelMethodAdd}
        selectMethod={selectMethod}
        startMethodAdd={startMethodAdd}
        removeCustomMethod={removeCustomMethod}
        isEditingUrl={isEditingUrl}
        editorUrlMainDisplay={editorUrlMainDisplay}
        startUrlEdit={startUrlEdit}
        urlInputRef={urlInputRef}
        urlDraftText={urlDraftText}
        setUrlDraftText={setUrlDraftText}
        variableSuggestions={variableSuggestions}
        commitUrlEdit={commitUrlEdit}
        cancelUrlEdit={cancelUrlEdit}
        variableKeys={variableKeys}
        baseUrlKey={baseUrlKey}
        setBaseUrlKey={setBaseUrlKey}
        environmentVariables={props.environment?.variables}
        copyMenuOpen={copyMenuOpen}
        setCopyMenuOpen={setCopyMenuOpen}
        copyMenuWrapRef={copyMenuWrapRef}
        copyOk={copyOk}
        copyUrlText={copyUrlText}
        copyCurlText={copyCurlText}
        isSending={isSending}
        canSend={canSend}
        commitFocusedValueFieldToState={commitFocusedValueFieldToState}
        cancelInFlightSend={() => cancelInFlightSend()}
        send={send}
      />

      {!canSend && (
        <div className="small" style={{ color: '#ff9a9a' }}>
          Set Base URL in "Environment", otherwise the request won't be sent.
        </div>
      )}

      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${activeTabId === tab.id ? 'tabActive' : ''}`}
            onPointerDown={() => {
              if (activeTabId !== tab.id) commitFocusedValueFieldToState()
            }}
            onClick={() => setActiveTabId(tab.id)}
            aria-pressed={activeTabId === tab.id}
          >
            <span className="tabLabelWithIndicator">
              <span>{tab.label}</span>
              {tab.hasData ? <span className="tabIndicatorDot" aria-hidden="true" /> : null}
            </span>
          </button>
        ))}
      </div>

      {requestEditorTabExtensions.some(tab => tab.id === activeTabId) ? (
        <>{requestEditorTabExtensions.find(tab => tab.id === activeTabId)?.render(tabExtensionContext) ?? null}</>
      ) : activeTabId === 'tests' ? (
        <RequestEditorTestsSection
          testFunctionMenuWrapRef={testFunctionMenuWrapRef}
          testFunctionMenuOpen={testFunctionMenuOpen}
          setTestFunctionMenuOpen={setTestFunctionMenuOpen}
          selectedTestFunction={selectedTestFunction}
          setSelectedTestFunction={setSelectedTestFunction}
          availableGlobalTestFunctionNames={availableGlobalTestFunctionNames}
          requestTestScript={requestTestScript}
          setRequestTestScript={setRequestTestScript}
        />
      ) : activeTabId === 'data' ? (
        <RequestEditorDataSection
          dataDrivenRunning={dataDrivenRunning}
          canSend={canSend}
          isSending={isSending}
          dataDrivenInput={dataDrivenInput}
          setDataDrivenInput={setDataDrivenInput}
          dataDrivenParsed={dataDrivenParsed}
          dataDrivenRunReport={dataDrivenRunReport}
          setDataDrivenReportSheetOpen={setDataDrivenReportSheetOpen}
          cancelDataDrivenRun={cancelDataDrivenRun}
          startDataDrivenRun={startDataDrivenRun}
          openDataDrivenInputEditor={openDataDrivenInputEditor}
        />
      ) : activeTabId === 'params' ? (
        <RequestEditorParamsTab
          pathParams={pathParams}
          pathParamsList={pathParamsList}
          setPathParams={setPathParams}
          queryParams={queryParams}
          queryParamsList={queryParamsList}
          querySpecNames={querySpecNames}
          queryParamKeyOverrides={queryParamKeyOverrides}
          inactiveQueryParamNames={inactiveQueryParamNames}
          queryDraftRows={queryDraftRows}
          variableSuggestions={variableSuggestions}
          valueHistory={valueHistory}
          setInactiveQueryParamNames={setInactiveQueryParamNames}
          setQueryParams={setQueryParams}
          setQueryDraftRows={setQueryDraftRows}
          setQueryParamKeyOverrides={setQueryParamKeyOverrides}
          setDisabledQueryParamNames={setDisabledQueryParamNames}
          setQueryKeyOrder={setQueryKeyOrder}
          setFlagForKey={setFlagForKey}
          renameStoreKey={renameStoreKey}
          renameFlagKey={renameFlagKey}
          replaceKeyInOrder={replaceKeyInOrder}
          uid={uid}
          addQueryDraftRow={addQueryDraftRow}
          recordValueHistory={recordValueHistory}
          deleteValueHistoryItem={deleteValueHistoryItem}
          enumMenuOpenId={enumMenuOpenId}
          enumMenuAnchor={enumMenuAnchor}
          onToggleEnumMenu={toggleEnumMenu}
          onCloseEnumMenu={closeEnumMenu}
          enumMenuPanelRef={enumMenuPanelRef}
          valueHistoryMenuOpenId={valueHistoryMenuOpenId}
          valueHistoryMenuAnchor={valueHistoryMenuAnchor}
          onToggleValueHistoryMenu={toggleValueHistoryMenu}
          onCloseValueHistoryMenu={closeValueHistoryMenu}
          valueHistoryMenuPanelRef={valueHistoryMenuPanelRef}
          clearAllValueHistory={clearAllValueHistory}
        />
      ) : (
        <RequestEditorHeadersTab
          visibleHeaderParams={visibleHeaderParams}
          headerSpecNames={headerSpecNames}
          requestBaseHeaders={requestBaseHeaders}
          envHeaders={envHeaders}
          committedHeaders={committedHeaders}
          inactiveHeaderNames={inactiveHeaderNames}
          headerDraftRows={headerDraftRows}
          headerValueHistoryItems={headerValueHistoryItems}
          variableSuggestions={variableSuggestions}
          hasDisabledEnvOnlyHeaders={hasDisabledEnvOnlyHeaders}
          hasAnyEditableVisibleHeaderRow={hasAnyEditableVisibleHeaderRow}
          findHeaderKeyCaseInsensitive={findHeaderKeyCaseInsensitive}
          getHeaderCaseInsensitive={getHeaderCaseInsensitive}
          headerIsInactive={headerIsInactive}
          setFlagForHeaderName={setFlagForHeaderName}
          deleteValueHistoryItem={deleteValueHistoryItem as (kind: 'header', key: string, value: string) => void}
          recordValueHistory={recordValueHistory as (kind: 'header', key: string, value: string) => void}
          setHeaderValueForRequest={setHeaderValueForRequest}
          headerDraftSaveRef={headerDraftSaveRef}
          persistHeaderDraftPatch={persistHeaderDraftPatch}
          setInactiveHeaderNames={setInactiveHeaderNames}
          setHeaderDraftRows={setHeaderDraftRows}
          setHeaderDraftRowsAndPersist={setHeaderDraftRowsAndPersist}
          setDisabledHeaderNames={setDisabledHeaderNames}
          setHeaderOverrides={setHeaderOverrides}
          setHeaderKeyOrder={setHeaderKeyOrder}
          replaceKeyInOrderCaseInsensitive={replaceKeyInOrderCaseInsensitive}
          deleteHeaderCaseInsensitive={deleteHeaderCaseInsensitive}
          setHeaderCaseInsensitive={setHeaderCaseInsensitive}
          addHeaderDraftRow={addHeaderDraftRow}
          reloadFromGlobalHeaders={reloadFromGlobalHeaders}
          uid={uid}
          enumMenuOpenId={enumMenuOpenId}
          enumMenuAnchor={enumMenuAnchor}
          onToggleEnumMenu={toggleEnumMenu}
          onCloseEnumMenu={closeEnumMenu}
          enumMenuPanelRef={enumMenuPanelRef}
          valueHistoryMenuOpenId={valueHistoryMenuOpenId}
          valueHistoryMenuAnchor={valueHistoryMenuAnchor}
          onToggleValueHistoryMenu={toggleValueHistoryMenu}
          onCloseValueHistoryMenu={closeValueHistoryMenu}
          valueHistoryMenuPanelRef={valueHistoryMenuPanelRef}
          clearAllValueHistory={clearAllValueHistory}
        />
      )}

      <RequestEditorBodyFileSection
        isBodyOpen={isBodyOpen}
        onToggleBodyOpen={setIsBodyOpen}
        bodyFormatMenuWrapRef={bodyFormatMenuWrapRef}
        bodyFormatMenuPanelRef={bodyFormatMenuPanelRef}
        bodyFormatMenuOpen={bodyFormatMenuOpen}
        onToggleBodyFormatMenu={() => setBodyFormatMenuOpen(v => !v)}
        bodyFormatId={bodyFormatForDisplay}
        bodyFormatLabel={labelForBodyFormat(bodyFormatForDisplay)}
        bodyFormatOptions={(['auto', 'json', 'xml', 'yaml', 'text'] as BodyFormat[]).map(id => ({ id, label: labelForBodyFormat(id) }))}
        onPickBodyFormat={id => pickBodyFormat(id as BodyFormat)}
        bodyFormatMenuAnchor={bodyFormatMenuAnchor}
        hasExampleBody={hasExampleBody}
        onReloadExampleBody={reloadExampleBodyText}
        onBeautifyBody={beautifyBodyText}
        onCopyBody={() => { void copyBodyText() }}
        bodyCopied={bodyCopied}
        onClearBody={() => setBodyText('')}
        useJsonBodyEditor={useJsonBodyEditor}
        bodyText={bodyText}
        onChangeBodyText={setBodyText}
        onSubmitShortcut={triggerSendShortcut}
        variableSuggestions={variableSuggestions}
        bodyTextareaRef={bodyTextareaRef}
        isMac={IS_MAC}
        onPlainBodyKeyDown={handlePlainBodyKeyDown}
        onPlainBodyResizeHandlePointerDown={onPlainBodyResizeHandlePointerDown}
        isFileOpen={isFileOpen}
        onToggleFileOpen={setIsFileOpen}
        isMultipartForm={isMultipartForm}
        onAddFileRow={() => {
          setIsFileOpen(true)
          setFileRows(prev => [...prev, { id: uid('frow'), fieldName: '', file: null, fileName: '', isActive: true }])
        }}
        filePicker={renderFilePicker()}
      />

      <DataDrivenReportSheet
        open={dataDrivenReportSheetOpen}
        report={dataDrivenRunReport}
        onClose={() => setDataDrivenReportSheetOpen(false)}
        onClearReport={() => setDataDrivenRunReport(null)}
      />

      <DataDrivenInputEditorSheet
        open={dataDrivenInputEditorOpen}
        value={dataDrivenInputEditorText}
        onChange={setDataDrivenInputEditorText}
        onSave={saveDataDrivenInputFromEditor}
        onCloseAndSave={closeDataDrivenInputEditorAndSave}
      />
    </div>
  )
}
