import type { RequestItem, RequestParam } from '../../../collectionTree'
import type { RequestDraft } from '../../../../shared/types/requestHistory'
import { uid } from '../../../../shared/utils/id'
import type { FileRow, HeaderDraftRowState, HeaderDraftState, QueryDraftRowState } from '../../types'
import {
  defaultInactiveHeaderNamesFromSpec,
  deleteHeaderCaseInsensitive,
  findHeaderKeyCaseInsensitive,
  getHeaderCaseInsensitive,
  mergeHeadersCaseInsensitive,
  setHeaderCaseInsensitive,
} from '../headers/headerState'

type DraftRowPrefix = 'qrow' | 'hrow'
type DraftFileRow = { fieldName: string, fileName: string, isActive: boolean }

export type HydratedRequestEditorDraftState = {
  pathParams: Record<string, string>
  queryParams: Record<string, string>
  queryDraftRows: QueryDraftRowState[]
  queryKeyOrder: string[]
  queryParamKeyOverrides: Record<string, string>
  disabledQueryParamNames: Record<string, true>
  inactiveQueryParamNames: Record<string, true>
  headerOverrides: Record<string, string>
  disabledHeaderNames: Record<string, true>
  inactiveHeaderNames: Record<string, true>
  headerDraftRows: HeaderDraftRowState[]
  headerKeyOrder: string[]
  bodyText: string
  bodyFormat: NonNullable<RequestDraft['bodyFormat']>
  baseUrlKey: string
  urlTemplateOverride: string
  fileRows: FileRow[]
  preSqlScript: string
  postSqlScript: string
  preSqlScriptIsActive: boolean
  postSqlScriptIsActive: boolean
  selectedSqlConnectionId: string | null
  dataDrivenInput: string
  selectedTestFunction: string
  requestTestScript: string
}

type HydrateRequestEditorDraftArgs = {
  draft: RequestDraft | null | undefined
  request: RequestItem
  environmentHeaders?: Record<string, string>
  environmentBaseUrlKey?: string
  mode: 'load' | 'apply'
  requestDefaultBodyText: string
  restoreFileRows: (storedRows: DraftFileRow[], fallbackFieldNames: string[]) => FileRow[]
}

export function defaultInactiveQueryParamNamesFromSpec(params: RequestParam[]): Record<string, true> {
  const out: Record<string, true> = {}
  for (const param of params) {
    if (!param || param.in !== 'query') continue
    if (param.required !== false) continue
    const name = (param.name || '').trim()
    if (!name) continue
    out[name] = true
  }
  return out
}

export function normalizeDraftRows(raw: unknown, prefix: DraftRowPrefix): Array<QueryDraftRowState | HeaderDraftRowState> {
  if (!Array.isArray(raw)) return []
  const out: Array<QueryDraftRowState | HeaderDraftRowState> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown, name?: unknown, value?: unknown, isActive?: unknown }
    const name = typeof row.name === 'string' ? row.name : ''
    const value = typeof row.value === 'string' ? row.value : ''
    const isActive = typeof row.isActive === 'boolean' ? row.isActive : true
    const id = typeof row.id === 'string' && row.id ? row.id : uid(prefix)
    out.push({ id, name, value, isActive })
  }
  return out
}

export function normalizeDraftFileRows(raw: unknown): DraftFileRow[] {
  if (!Array.isArray(raw)) return []
  const out: DraftFileRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { fieldName?: unknown, fileName?: unknown, isActive?: unknown }
    out.push({
      fieldName: typeof row.fieldName === 'string' ? row.fieldName : '',
      fileName: typeof row.fileName === 'string' ? row.fileName : '',
      isActive: typeof row.isActive === 'boolean' ? row.isActive : true,
    })
  }
  return out
}

export function createFileRowsRestorer() {
  const fileRowsByRequestId = new Map<string, Array<{ fieldName: string, file: File | null, fileName: string, isActive: boolean }>>()

  return {
    restore(requestId: string, storedRows: DraftFileRow[], fallbackFieldNames: string[]): FileRow[] {
      const cachedRows = fileRowsByRequestId.get(requestId) ?? []
      const sourceRows = storedRows.length
        ? storedRows
        : (fallbackFieldNames.length ? fallbackFieldNames : ['']).map(fieldName => ({ fieldName, fileName: '', isActive: true }))

      return sourceRows.map((row, index) => {
        const cached = cachedRows[index]
        const file = cached?.file ?? null
        const fileName = file?.name ?? row.fileName ?? cached?.fileName ?? ''
        return {
          id: uid('frow'),
          fieldName: row.fieldName,
          file,
          fileName,
          isActive: row.isActive,
        }
      })
    },
    remember(requestId: string, rows: FileRow[]) {
      fileRowsByRequestId.set(
        requestId,
        rows.map(row => ({
          fieldName: row.fieldName,
          file: row.file,
          fileName: row.file?.name ?? row.fileName,
          isActive: row.isActive,
        })),
      )
    },
  }
}

export function hydrateRequestEditorDraft(args: HydrateRequestEditorDraftArgs): HydratedRequestEditorDraftState {
  const draft = args.draft
  const envHeaders = args.environmentHeaders ?? {}
  const requestHeaders = (args.request.headers ?? {}) as Record<string, string>

  const pathParams = draft?.pathParams ?? {}
  const queryParams = draft?.queryParams ?? {}
  const queryDraftRows = normalizeDraftRows(draft?.queryDraftRows, 'qrow') as QueryDraftRowState[]
  const disabledQueryParamNames =
    draft?.disabledQueryParamNames && typeof draft.disabledQueryParamNames === 'object'
      ? draft.disabledQueryParamNames
      : {}
  const inactiveQueryParamNames =
    draft?.inactiveQueryParamNames && typeof draft.inactiveQueryParamNames === 'object'
      ? draft.inactiveQueryParamNames
      : (draft ? {} : defaultInactiveQueryParamNamesFromSpec(args.request.params))

  const headerOverrides = (() => {
    if (draft?.headerOverrides && typeof draft.headerOverrides === 'object') return draft.headerOverrides
    const legacy = draft?.headers && typeof draft.headers === 'object' ? draft.headers : null
    if (!legacy) return {}

    const overrides: Record<string, string> = {}
    for (const [key, value] of Object.entries(legacy)) {
      const baseValue = getHeaderCaseInsensitive(requestHeaders, key)
      const envValue = getHeaderCaseInsensitive(envHeaders, key)
      if (baseValue === undefined && envValue !== undefined && envValue === value) continue
      if (baseValue === undefined || baseValue !== value) setHeaderCaseInsensitive(overrides, key, value)
    }
    return overrides
  })()

  const disabledHeaderNames = (() => {
    if (draft?.disabledHeaderNames && typeof draft.disabledHeaderNames === 'object') return draft.disabledHeaderNames
    if (args.mode !== 'apply') return {}

    const target = draft?.headers && typeof draft.headers === 'object' ? draft.headers : {}
    const disabled: Record<string, true> = {}
    for (const key of Object.keys(mergeHeadersCaseInsensitive(envHeaders, requestHeaders))) {
      if (!findHeaderKeyCaseInsensitive(target, key)) disabled[key] = true
    }
    return disabled
  })()

  const inactiveHeaderNames =
    draft?.inactiveHeaderNames && typeof draft.inactiveHeaderNames === 'object'
      ? draft.inactiveHeaderNames
      : (draft ? {} : defaultInactiveHeaderNamesFromSpec(args.request.params, requestHeaders))

  const headerDraftRows = normalizeDraftRows(draft?.headerDraftRows, 'hrow') as HeaderDraftRowState[]

  const headersForSeedCheck = (() => {
    const next = mergeHeadersCaseInsensitive(envHeaders, requestHeaders, headerOverrides)
    for (const key of Object.keys(disabledHeaderNames)) deleteHeaderCaseInsensitive(next, key)
    return next
  })()

  const queryKeyOrder = (() => {
    const raw = Array.isArray(draft?.queryKeyOrder) ? draft?.queryKeyOrder : null
    const stored = (raw ?? []).filter(item => typeof item === 'string')
    if (stored.length) return stored

    const overrides = draft?.queryParamKeyOverrides && typeof draft.queryParamKeyOverrides === 'object'
      ? draft.queryParamKeyOverrides as Record<string, string>
      : {}
    const overriddenKeys = new Set(Object.values(overrides).filter(Boolean))
    const specRaw = args.request.params.filter(param => param.in === 'query').map(param => param.name).filter(Boolean)
    const disabledSpec = new Set(Object.keys(disabledQueryParamNames).filter(Boolean))
    const specEffective = specRaw
      .filter(name => !disabledSpec.has(name))
      .map(name => overrides[name] ?? name)
      .filter(Boolean)

    const specRawSet = new Set(specRaw)
    const extras = Object.keys(queryParams).filter(key => !specRawSet.has(key) && !overriddenKeys.has(key))
    return [...specEffective, ...extras]
  })()

  const headerKeyOrder = (() => {
    const raw = Array.isArray(draft?.headerKeyOrder) ? draft?.headerKeyOrder : null
    const stored = (raw ?? []).filter(item => typeof item === 'string')
    if (stored.length) return stored

    const spec = args.request.params
      .filter(param => param.in === 'header')
      .map(param => param.name)
      .filter(name => typeof name === 'string' && name && name.toLowerCase() !== 'authorization')

    const combinedKeys = Object.keys(headersForSeedCheck).filter(key => key.toLowerCase() !== 'authorization')
    const out: string[] = []
    for (const key of [...spec, ...combinedKeys]) {
      if (out.some(item => item.toLowerCase() === key.toLowerCase())) continue
      out.push(key)
    }
    return out
  })()

  const hasQueryParamsSpec = args.request.params.some(param => param.in === 'query')
  const hasQueryParamsStore = Object.keys(queryParams).length > 0
  const seededQueryDraftRows = queryDraftRows.length
    ? queryDraftRows
    : (!hasQueryParamsSpec && !hasQueryParamsStore ? [{ id: uid('qrow'), name: '', value: '', isActive: true }] : [])

  const hasHeadersSpec = args.request.params.some(param => param.in === 'header' && param.name.toLowerCase() !== 'authorization')
  const hasHeadersStore = Object.keys(headersForSeedCheck).some(key => key.toLowerCase() !== 'authorization')
  const seededHeaderDraftRows = headerDraftRows.length
    ? headerDraftRows
    : (!hasHeadersSpec && !hasHeadersStore ? [{ id: uid('hrow'), name: '', value: '', isActive: true }] : [])

  const storedRows = normalizeDraftFileRows(draft?.fileRows)
  const rawFileFieldNames = Array.isArray(draft?.fileFieldNames) ? draft.fileFieldNames : null
  const fileFieldNames = (rawFileFieldNames ?? []).filter(item => typeof item === 'string')

  return {
    pathParams,
    queryParams,
    queryDraftRows: seededQueryDraftRows,
    queryKeyOrder,
    queryParamKeyOverrides: draft?.queryParamKeyOverrides ?? {},
    disabledQueryParamNames,
    inactiveQueryParamNames,
    headerOverrides,
    disabledHeaderNames,
    inactiveHeaderNames,
    headerDraftRows: seededHeaderDraftRows,
    headerKeyOrder,
    bodyText: draft?.bodyText ?? args.requestDefaultBodyText,
    bodyFormat: normalizeBodyFormat(draft?.bodyFormat),
    baseUrlKey: draft?.baseUrlKey || args.environmentBaseUrlKey || 'baseUrl',
    urlTemplateOverride: draft?.urlTemplateOverride ?? '',
    fileRows: args.restoreFileRows(storedRows, fileFieldNames),
    preSqlScript: draft?.preSqlScript ?? '',
    postSqlScript: draft?.postSqlScript ?? '',
    preSqlScriptIsActive: draft?.preSqlScriptIsActive !== false,
    postSqlScriptIsActive: draft?.postSqlScriptIsActive !== false,
    selectedSqlConnectionId: draft?.sqlConnectionId ?? null,
    dataDrivenInput: draft?.dataDrivenInput ?? '',
    selectedTestFunction: typeof draft?.selectedTestFunction === 'string' ? draft.selectedTestFunction : '',
    requestTestScript: typeof draft?.requestTestScript === 'string' ? draft.requestTestScript : '',
  }
}

export function toRequestDraft(state: HydratedRequestEditorDraftState): RequestDraft {
  return {
    pathParams: state.pathParams,
    queryParams: state.queryParams,
    queryDraftRows: state.queryDraftRows,
    queryKeyOrder: state.queryKeyOrder,
    inactiveQueryParamNames: state.inactiveQueryParamNames,
    queryParamKeyOverrides: state.queryParamKeyOverrides,
    disabledQueryParamNames: state.disabledQueryParamNames,
    preSqlScript: state.preSqlScript,
    postSqlScript: state.postSqlScript,
    preSqlScriptIsActive: state.preSqlScriptIsActive,
    postSqlScriptIsActive: state.postSqlScriptIsActive,
    sqlConnectionId: state.selectedSqlConnectionId ?? undefined,
    headerOverrides: state.headerOverrides,
    headerDraftRows: state.headerDraftRows,
    headerKeyOrder: state.headerKeyOrder,
    disabledHeaderNames: state.disabledHeaderNames,
    inactiveHeaderNames: state.inactiveHeaderNames,
    bodyText: state.bodyText,
    bodyFormat: state.bodyFormat,
    fileFieldName: (state.fileRows[0]?.fieldName || 'file').trim() || 'file',
    fileFieldNames: state.fileRows.map(row => row.fieldName),
    fileRows: state.fileRows.map(row => ({
      fieldName: row.fieldName,
      fileName: row.file?.name ?? row.fileName,
      isActive: row.isActive,
    })),
    baseUrlKey: state.baseUrlKey,
    urlTemplateOverride: state.urlTemplateOverride,
    dataDrivenInput: state.dataDrivenInput,
    selectedTestFunction: state.selectedTestFunction,
    requestTestScript: state.requestTestScript,
  }
}

export function buildHeaderDraftState(state: Pick<HydratedRequestEditorDraftState, 'headerOverrides' | 'headerDraftRows' | 'headerKeyOrder' | 'disabledHeaderNames' | 'inactiveHeaderNames'>): HeaderDraftState {
  return {
    headerOverrides: state.headerOverrides,
    headerDraftRows: state.headerDraftRows,
    headerKeyOrder: state.headerKeyOrder,
    disabledHeaderNames: state.disabledHeaderNames,
    inactiveHeaderNames: state.inactiveHeaderNames,
  }
}

function normalizeBodyFormat(raw: unknown): NonNullable<RequestDraft['bodyFormat']> {
  if (raw === 'auto' || raw === 'json' || raw === 'xml' || raw === 'yaml' || raw === 'text') return raw
  return 'auto'
}
