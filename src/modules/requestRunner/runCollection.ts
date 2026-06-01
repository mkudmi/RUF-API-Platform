import type { Collection, Folder, RequestItem } from '../collectionTree'
import { walkCollection } from '../collectionTree/utils/collectionTraversal'
import type { Environment } from '../../shared/types/environment'
import type { RequestDraft } from '../../shared/types/requestHistory'
import { loadRequestDraft } from '../requestEditor/utils/draftStorage'
import { computeEffectiveBaseUrl, isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { runRequest, type RunResult } from './runRequest'

type BodyFormat = NonNullable<RequestDraft['bodyFormat']>

export type CollectionRunQueueItem = {
  request: RequestItem
  folderPath: string
}

export type CollectionRunPreparedRequest = {
  request: RequestItem
  draft: RequestDraft | null
  folderPath: string
  baseUrl: string
  urlTemplateOverride: string
  variables: Record<string, string>
  pathParams: Record<string, string>
  queryParams: Record<string, string>
  headers: Record<string, string>
  headerEntries: Array<[string, string]>
  bodyText: string
}

export type CollectionRunItemReport = {
  iteration: number
  requestId: string
  requestName: string
  folderPath: string
  method: string
  path: string
  runId: string
  status: number
  statusText: string
  ok: boolean
  timeMs: number
  requestBytes: number
  responseBytes: number
  responseBodyText: string
  errorMessage?: string
}

function normalizeDraftRows(raw: unknown): Array<{ name: string, value: string, isActive: boolean }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ name: string, value: string, isActive: boolean }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { name?: unknown, value?: unknown, isActive?: unknown }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const value = typeof row.value === 'string' ? row.value : ''
    const isActive = typeof row.isActive === 'boolean' ? row.isActive : true
    if (!name || value === '') continue
    out.push({ name, value, isActive })
  }
  return out
}

function requestDefaultBodyText(request: RequestItem) {
  const body = request.body?.example
  if (body === undefined) return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body, null, 2)
}

function isHeaderInactive(inactiveHeaderNames: Record<string, true>, headerName: string): boolean {
  const needle = headerName.toLowerCase()
  for (const k of Object.keys(inactiveHeaderNames)) {
    if (k.toLowerCase() === needle) return true
  }
  return false
}

function setHeaderActivity(prev: Record<string, true>, headerNameRaw: string, active: boolean): Record<string, true> {
  const headerName = headerNameRaw.trim()
  if (!headerName) return prev
  const needle = headerName.toLowerCase()

  let changed = false
  const next: Record<string, true> = {}
  for (const k of Object.keys(prev)) {
    if (k.toLowerCase() === needle) {
      changed = true
      continue
    }
    next[k] = true
  }

  if (!active) {
    if (!(headerName in next)) {
      next[headerName] = true
      changed = true
    }
  }

  return changed ? next : prev
}

function removeInactiveHeaders(headers: Record<string, string>, inactiveHeaderNames: Record<string, true>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (isHeaderInactive(inactiveHeaderNames, k)) continue
    next[k] = v
  }
  return next
}

function findHeaderKeyCaseInsensitive(headers: Record<string, unknown>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === needle) return k
  }
  return undefined
}

function setHeaderCaseInsensitive(headers: Record<string, string>, name: string, value: string) {
  const existingKey = findHeaderKeyCaseInsensitive(headers, name)
  if (existingKey && existingKey !== name) delete headers[existingKey]
  headers[name] = value
}

function deleteHeaderCaseInsensitive(headers: Record<string, unknown>, name: string): boolean {
  const existingKey = findHeaderKeyCaseInsensitive(headers, name)
  if (!existingKey) return false
  delete headers[existingKey]
  return true
}

function mergeHeadersCaseInsensitive(...sources: Array<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const source of sources) {
    for (const [k, v] of Object.entries(source)) setHeaderCaseInsensitive(next, k, v)
  }
  return next
}

function setKeyActivity(prev: Record<string, true>, keyRaw: string, active: boolean): Record<string, true> {
  const key = keyRaw.trim()
  if (!key) return prev
  if (active) {
    if (!(key in prev)) return prev
    const next = { ...prev }
    delete next[key]
    return next
  }
  if (key in prev) return prev
  return { ...prev, [key]: true }
}

function contentTypeForBodyFormat(format: Exclude<BodyFormat, 'auto'>) {
  switch (format) {
    case 'json': return 'application/json'
    case 'xml': return 'application/xml'
    case 'yaml': return 'application/yaml'
    case 'text': return 'text/plain'
  }
}

function applySchemeIfHostLike(url: string, scheme: 'http' | 'https') {
  const raw = url.trim().replace(/\/+$/, '')
  if (!raw) return ''
  if (isAbsoluteUrl(raw) || raw.startsWith('/') || raw.startsWith('//')) return raw

  const looksLikeHost =
    /^localhost(?::\d+)?(?:\/.*)?$/i.test(raw) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(raw) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)

  if (!looksLikeHost) return raw
  return `${scheme}://${raw}`.replace(/\/+$/, '')
}

function resolveBaseUrlAndVariables(args: {
  environment: Environment
  collection: Collection
  draft: RequestDraft | null
}) {
  const envVars = args.environment.variables ?? {}
  const envKey = args.environment.baseUrlKey || 'baseUrl'
  const preferredKey = args.draft?.baseUrlKey || envKey
  const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
  const selectedBaseUrl = envVars[resolvedKey] ?? ''
  const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
  const effective = computeEffectiveBaseUrl(selectedBaseUrl, args.collection.baseUrl)
  const baseUrl = applySchemeIfHostLike(effective, scheme)
  const variables = { ...envVars, scheme, baseUrl }
  return { baseUrl, variables }
}

function buildQueue(collection: Collection): CollectionRunQueueItem[] {
  const folderPathByKey = new Map<string, string>()
  const out: CollectionRunQueueItem[] = []

  walkCollection({
    collection,
    onFolder: (_folder, pathParts, pathKey) => {
      folderPathByKey.set(pathKey, pathParts.join(' / '))
    },
    onRequest: (request, folderPathKey) => {
      out.push({
        request,
        folderPath: folderPathByKey.get(folderPathKey) ?? '',
      })
    },
  })

  return out
}

export function buildCollectionRunQueue(collection: Collection): CollectionRunQueueItem[] {
  return buildQueue(collection)
}

function findFolderWithPath(folders: Folder[], folderId: string, parentPath: string[]): { folder: Folder, pathParts: string[] } | null {
  for (const folder of folders) {
    const pathParts = [...parentPath, folder.name]
    if (folder.id === folderId) return { folder, pathParts }
    const child = findFolderWithPath(Array.isArray(folder.folders) ? folder.folders : [], folderId, pathParts)
    if (child) return child
  }
  return null
}

function collectFolderQueue(folder: Folder, pathParts: string[], out: CollectionRunQueueItem[]) {
  out.push(
    ...(folder.requests ?? []).map(request => ({
      request,
      folderPath: pathParts.join(' / '),
    })),
  )

  for (const child of Array.isArray(folder.folders) ? folder.folders : []) {
    collectFolderQueue(child, [...pathParts, child.name], out)
  }
}

export function buildFolderRunQueue(collection: Collection, folderId: string): CollectionRunQueueItem[] {
  const found = findFolderWithPath(collection.folders, folderId, [])
  if (!found) return []
  const out: CollectionRunQueueItem[] = []
  collectFolderQueue(found.folder, found.pathParts, out)
  return out
}

export function prepareCollectionRunRequest(args: {
  collection: Collection
  request: RequestItem
  environment: Environment
  folderPath?: string
}): CollectionRunPreparedRequest {
  const draft = loadRequestDraft(args.request.id)
  const { baseUrl, variables } = resolveBaseUrlAndVariables({
    environment: args.environment,
    collection: args.collection,
    draft,
  })

  const pathParams = { ...(draft?.pathParams ?? {}) }

  const queryParamsBase = { ...(draft?.queryParams ?? {}) }
  const queryRows = normalizeDraftRows(draft?.queryDraftRows)
  for (const row of queryRows) queryParamsBase[row.name] = row.value

  let inactiveQueryParamNames: Record<string, true> = (
    draft?.inactiveQueryParamNames && typeof draft.inactiveQueryParamNames === 'object'
      ? { ...draft.inactiveQueryParamNames }
      : {}
  )
  for (const row of queryRows) {
    inactiveQueryParamNames = setKeyActivity(inactiveQueryParamNames, row.name, row.isActive)
  }

  const queryParams: Record<string, string> = {}
  for (const [k, v] of Object.entries(queryParamsBase)) {
    if (inactiveQueryParamNames[k]) continue
    queryParams[k] = v
  }

  const envHeaders = args.environment.headers ?? {}
  const requestBaseHeaders = args.request.headers ?? {}
  const headerOverrides = (
    draft?.headerOverrides && typeof draft.headerOverrides === 'object'
      ? draft.headerOverrides
      : {}
  )
  const disabledHeaderNames = (
    draft?.disabledHeaderNames && typeof draft.disabledHeaderNames === 'object'
      ? draft.disabledHeaderNames
      : {}
  )
  const inactiveHeaderNames = (
    draft?.inactiveHeaderNames && typeof draft.inactiveHeaderNames === 'object'
      ? { ...draft.inactiveHeaderNames }
      : {}
  )
  const headerRows = normalizeDraftRows(draft?.headerDraftRows)
  const activeCommittedHeaderNeedles = (() => {
    const merged = mergeHeadersCaseInsensitive(envHeaders, requestBaseHeaders, headerOverrides)
    for (const key of Object.keys(disabledHeaderNames)) deleteHeaderCaseInsensitive(merged, key)
    return new Set(Object.keys(removeInactiveHeaders(merged, inactiveHeaderNames)).map(k => k.toLowerCase()))
  })()
  const activeDraftHeaderNeedles = new Set(
    headerRows
      .filter(row => row.isActive)
      .map(row => row.name.trim().toLowerCase())
      .filter(Boolean),
  )
  const headerRowsToApply = headerRows.filter(row => {
    if (row.isActive) return true
    const needle = row.name.trim().toLowerCase()
    if (!needle) return false
    return !activeDraftHeaderNeedles.has(needle) && !activeCommittedHeaderNeedles.has(needle)
  })

  const nextHeaderOverridesForSend = (() => {
    if (!headerRowsToApply.length) return headerOverrides
    const next = { ...headerOverrides }
    for (const row of headerRowsToApply) setHeaderCaseInsensitive(next, row.name, row.value)
    return next
  })()

  const nextDisabledHeaderNamesForSend = (() => {
    if (!headerRowsToApply.length) return disabledHeaderNames
    const next = { ...disabledHeaderNames }
    for (const row of headerRowsToApply) {
      deleteHeaderCaseInsensitive(next, row.name)
    }
    return next
  })()

  const nextInactiveHeaderNamesForSend = (() => {
    if (!headerRowsToApply.length) return inactiveHeaderNames
    let next = inactiveHeaderNames
    for (const row of headerRowsToApply) next = setHeaderActivity(next, row.name, row.isActive)
    return next
  })()

  const baseHeadersForSend = (() => {
    const merged = mergeHeadersCaseInsensitive(envHeaders, requestBaseHeaders, nextHeaderOverridesForSend)
    for (const key of Object.keys(nextDisabledHeaderNamesForSend)) deleteHeaderCaseInsensitive(merged, key)
    return removeInactiveHeaders(merged, nextInactiveHeaderNamesForSend)
  })()

  const bodyText = draft?.bodyText ?? requestDefaultBodyText(args.request)
  const bodyFormat = draft?.bodyFormat ?? 'auto'
  const methodAllowsBody = args.request.method !== 'GET' && args.request.method !== 'HEAD'
  const hasAnyBodyInput = !!bodyText.trim()
  const headers = (() => {
    if (!hasAnyBodyInput || !methodAllowsBody || bodyFormat === 'auto') return baseHeadersForSend
    if (isHeaderInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) return baseHeadersForSend
    const next = { ...baseHeadersForSend }
    setHeaderCaseInsensitive(next, 'Content-Type', contentTypeForBodyFormat(bodyFormat))
    return next
  })()

  const baseCommittedHeadersForSend = (() => {
    const merged = mergeHeadersCaseInsensitive(envHeaders, requestBaseHeaders, headerOverrides)
    for (const key of Object.keys(disabledHeaderNames)) deleteHeaderCaseInsensitive(merged, key)
    return removeInactiveHeaders(merged, nextInactiveHeaderNamesForSend)
  })()
  const draftHeaderNeedlesForSend = new Set(headerRowsToApply.map(row => row.name.trim().toLowerCase()).filter(Boolean))
  const committedHeaderEntriesForSend = (() => {
    const withoutDraftRows = (entries: Array<[string, string]>) =>
      entries.filter(([name]) => !draftHeaderNeedlesForSend.has(name.toLowerCase()))
    if (!hasAnyBodyInput || !methodAllowsBody || bodyFormat === 'auto') return withoutDraftRows(Object.entries(baseCommittedHeadersForSend))
    if (isHeaderInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) return withoutDraftRows(Object.entries(baseCommittedHeadersForSend))
    const next = { ...baseCommittedHeadersForSend }
    setHeaderCaseInsensitive(next, 'Content-Type', contentTypeForBodyFormat(bodyFormat))
    return withoutDraftRows(Object.entries(next))
  })()
  const activeDraftHeaderEntriesForSend = headerRowsToApply
    .filter(row => row.isActive && row.name.trim() && row.value !== '')
    .map(row => [row.name, row.value] as [string, string])
  const headerEntries = [...committedHeaderEntriesForSend, ...activeDraftHeaderEntriesForSend]

  return {
    request: args.request,
    draft,
    folderPath: args.folderPath ?? '',
    baseUrl,
    urlTemplateOverride: draft?.urlTemplateOverride ?? '',
    variables,
    pathParams,
    queryParams,
    headers,
    headerEntries,
    bodyText,
  }
}

export async function runCollectionRequest(prepared: CollectionRunPreparedRequest, signal?: AbortSignal): Promise<RunResult> {
  return runRequest({
    request: prepared.request,
    baseUrl: prepared.baseUrl,
    urlTemplateOverride: prepared.urlTemplateOverride,
    variables: prepared.variables,
    pathParams: prepared.pathParams,
    queryParams: prepared.queryParams,
    headers: prepared.headers,
    headerEntries: prepared.headerEntries,
    bodyText: prepared.bodyText,
    signal,
  })
}

function resolveDisplayUrl(prepared: CollectionRunPreparedRequest): string {
  const override = prepared.urlTemplateOverride.trim()
  let url = ''
  if (override) {
    if (isAbsoluteUrl(override) || override.startsWith('//')) url = override
    else if (prepared.baseUrl) url = joinUrlParts(prepared.baseUrl, override)
    else url = override
  } else {
    url = prepared.baseUrl
      ? joinUrlParts(prepared.baseUrl, prepared.request.path)
      : prepared.request.urlTemplate.replace('{{baseUrl}}', '')
  }
  return url
}

export function buildCollectionRunHistoryDraft(prepared: CollectionRunPreparedRequest): RequestDraft {
  return {
    pathParams: prepared.pathParams,
    queryParams: prepared.queryParams,
    headers: prepared.headers,
    headerEntries: prepared.headerEntries.map(([name, value]) => ({ name, value })),
    bodyText: prepared.bodyText,
    urlTemplateOverride: prepared.urlTemplateOverride || undefined,
    baseUrlKey: prepared.draft?.baseUrlKey || undefined,
  }
}

export function buildCollectionRunHistoryUrl(prepared: CollectionRunPreparedRequest): string {
  return resolveDisplayUrl(prepared)
}
