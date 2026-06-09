import { useCallback, useRef } from 'react'
import type { RequestItem, RequestParam } from '../../collectionTree'
import type { RequestDraft, RequestHistoryItem } from '../../../shared/types/requestHistory'
import { uid } from '../../../shared/utils/id'
import { isAbsoluteUrl, joinUrlParts } from '../../../shared/utils/url'
import { logWarn } from '../../../shared/utils/logger'
import { runRequest, type RunResult } from '../../requestRunner/runRequest'
import { getLocalMockServerStatus } from '../utils/localMockServer'
import { setFlagForKey } from '../state/params/keyState'
import {
  deleteHeaderCaseInsensitive,
  findHeaderKeyCaseInsensitive,
  headerIsInactive,
  mergeHeadersCaseInsensitive,
  removeInactiveHeaders,
  setFlagForHeaderName,
  setHeaderCaseInsensitive,
} from '../state/headers/headerState'
import { executeResponseTests, type TestFunctionRef } from '../../tests'
import type { FileRow, HeaderDraftRowState, QueryDraftRowState } from '../types'
import { runDbSql } from '../../environment'

type BodyFormat = NonNullable<RequestDraft['bodyFormat']>

type SelectedSqlConnection = {
  type: Parameters<typeof runDbSql>[0]['type']
  connectionString: string
} | null

type BuildSendSnapshotResult = {
  nextHeaderOverridesForSend: Record<string, string>
  nextDisabledHeaderNamesForSend: Record<string, true>
  nextInactiveHeaderNamesForSend: Record<string, true>
  effectiveHeadersForSend: Record<string, string>
  headerEntriesForSend: Array<[string, string]>
  effectiveQueryParamsForCommit: Record<string, string>
  nextInactiveQueryParamNamesForSend: Record<string, true>
  effectiveQueryParamsForSend: Record<string, string>
  effectiveDisabledQueryParamNamesForSend: Record<string, true>
  formFields?: Record<string, string>
  filesForMultipart?: Array<{ fieldName: string, file: File }>
  emptyFileFieldNamesForMultipart?: string[]
  fileForOctetStream?: File | null
  fileFieldName: string
}

type SendWithVariablesArgs = {
  variablesOverride?: Record<string, string>
  abortController?: AbortController
  requestIdKey?: string
  dataRow?: Record<string, string>
}

export function useRequestEditorSend(params: {
  request: RequestItem
  pathParams: Record<string, string>
  pathParamsList: RequestParam[]
  groupedQueryParams: RequestParam[]
  queryDraftRows: QueryDraftRowState[]
  querySpecNames: Set<string>
  queryParams: Record<string, string>
  effectiveQueryParams: Record<string, string>
  inactiveQueryParamNames: Record<string, true>
  disabledQueryParamNames: Record<string, true>
  queryParamKeyOverrides: Record<string, string>
  headerDraftRows: HeaderDraftRowState[]
  headerOverrides: Record<string, string>
  disabledHeaderNames: Record<string, true>
  inactiveHeaderNames: Record<string, true>
  committedHeaders: Record<string, string>
  envHeaders: Record<string, string>
  requestBaseHeaders: Record<string, string>
  fileRows: FileRow[]
  bodyText: string
  bodyFormat: BodyFormat
  bodyFormatForDisplay: Exclude<BodyFormat, 'auto'> | 'auto'
  effectiveContentType: string
  methodAllowsBody: boolean
  isMultipartForm: boolean
  supportsFileSend: boolean
  baseUrl: string
  baseUrlKey: string
  urlTemplateOverride: string
  variables: Record<string, string>
  displayUrl: string
  dataDrivenInput: string
  selectedTestFunction: string
  requestTestScript: string
  availableGlobalTestFunctions: TestFunctionRef[]
  preSqlScript: string
  postSqlScript: string
  preSqlScriptIsActive: boolean
  postSqlScriptIsActive: boolean
  selectedSqlConnectionId: string | null
  selectedSqlConnection: SelectedSqlConnection
  runDbSqlFn: typeof runDbSql
  onBeforeSend?: (requestId: string, item: RequestHistoryItem) => void
  onSendStart?: (requestId: string, runId: string) => void
  onSendEnd?: (requestId: string, runId: string) => void
  onResult: (requestId: string, result: RunResult, runId: string) => void
  applyVariablesForDisplay: (text: string, vars: Record<string, string>) => string
  contentTypeForBodyFormat: (format: Exclude<BodyFormat, 'auto'>) => string
}) {
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  const cancelInFlightSend = useCallback((requestId: string = params.request.id) => {
    const controller = abortControllersRef.current.get(requestId)
    if (!controller) return
    controller.abort()
    abortControllersRef.current.delete(requestId)
  }, [params.request.id])

  const abortAllSends = useCallback(() => {
    for (const controller of abortControllersRef.current.values()) controller.abort()
    abortControllersRef.current.clear()
  }, [])

  const parseFormFieldsFromBodyText = useCallback((text: string): Record<string, string> => {
    const raw = text.trim()
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!k.trim()) continue
        if (v === null || v === undefined) continue
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
      }
      return out
    } catch (error) {
      logWarn('parseFormFieldsFromBodyText', 'Failed to parse multipart helper JSON body', { error })
      return {}
    }
  }, [])

  const buildSendSnapshot = useCallback((): BuildSendSnapshotResult => {
    const headerDraftRowsToCommit = params.headerDraftRows.filter(r => r.name.trim() && r.value !== '')
    const hasDraftHeadersToCommit = headerDraftRowsToCommit.length > 0
    const activeCommittedHeaderNeedlesForSend = new Set(
      Object.keys(removeInactiveHeaders(params.committedHeaders, params.inactiveHeaderNames)).map(k => k.toLowerCase()),
    )
    const activeDraftHeaderNeedlesForSend = new Set(
      headerDraftRowsToCommit
        .filter(row => row.isActive)
        .map(row => row.name.trim().toLowerCase())
        .filter(Boolean),
    )
    const headerDraftRowsToApply = headerDraftRowsToCommit.filter(row => {
      if (row.isActive) return true
      const needle = row.name.trim().toLowerCase()
      if (!needle) return false
      return !activeDraftHeaderNeedlesForSend.has(needle) && !activeCommittedHeaderNeedlesForSend.has(needle)
    })

    const nextHeaderOverridesForSend = hasDraftHeadersToCommit
      ? (() => {
        const next = { ...params.headerOverrides }
        for (const row of headerDraftRowsToApply) {
          const key = row.name.trim()
          if (!key) continue
          setHeaderCaseInsensitive(next, key, row.value)
        }
        return next
      })()
      : params.headerOverrides

    const nextDisabledHeaderNamesForSend = hasDraftHeadersToCommit
      ? (() => {
        let changed = false
        const next = { ...params.disabledHeaderNames }
        for (const row of headerDraftRowsToApply) {
          const key = row.name.trim()
          if (!key) continue
          const existingKey = findHeaderKeyCaseInsensitive(next, key)
          if (existingKey) {
            delete next[existingKey]
            changed = true
          }
        }
        return changed ? next : params.disabledHeaderNames
      })()
      : params.disabledHeaderNames

    const nextInactiveHeaderNamesForSend = hasDraftHeadersToCommit
      ? (() => {
        let next = params.inactiveHeaderNames
        for (const row of headerDraftRowsToApply) {
          const key = row.name.trim()
          if (!key) continue
          next = setFlagForHeaderName(next, key, row.isActive)
        }
        return next
      })()
      : params.inactiveHeaderNames

    const baseHeadersForSend = (() => {
      const merged = mergeHeadersCaseInsensitive(params.envHeaders, params.requestBaseHeaders, nextHeaderOverridesForSend)
      for (const key of Object.keys(nextDisabledHeaderNamesForSend)) deleteHeaderCaseInsensitive(merged, key)
      return removeInactiveHeaders(merged, nextInactiveHeaderNamesForSend)
    })()

    const activeFileRows = params.fileRows.filter(r => r.isActive)
    const hasAnyFileInput = params.supportsFileSend && activeFileRows.some(r => !!r.file)
    const hasAnyBodyInput =
      !!params.bodyText.trim() ||
      hasAnyFileInput ||
      !!(params.methodAllowsBody && params.isMultipartForm && Object.keys(parseFormFieldsFromBodyText(params.bodyText)).length)

    const effectiveHeadersForSend = (() => {
      if (!hasAnyBodyInput) return baseHeadersForSend
      if (params.bodyFormat === 'auto') {
        if (params.bodyFormatForDisplay !== 'json') return baseHeadersForSend
        const next = { ...baseHeadersForSend }
        if (!headerIsInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) setHeaderCaseInsensitive(next, 'Content-Type', 'application/json')
        return next
      }
      const next = { ...baseHeadersForSend }
      if (!headerIsInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) setHeaderCaseInsensitive(next, 'Content-Type', params.contentTypeForBodyFormat(params.bodyFormat))
      return next
    })()

    const committedHeadersForSendWithoutDraftRows = (() => {
      const merged = mergeHeadersCaseInsensitive(params.envHeaders, params.requestBaseHeaders, params.headerOverrides)
      for (const key of Object.keys(params.disabledHeaderNames)) deleteHeaderCaseInsensitive(merged, key)
      return removeInactiveHeaders(merged, nextInactiveHeaderNamesForSend)
    })()

    const draftHeaderNeedlesForSend = new Set(headerDraftRowsToApply.map(row => row.name.trim().toLowerCase()).filter(Boolean))
    const committedHeaderEntriesForSend = (() => {
      const withoutDraftRows = (entries: Array<[string, string]>) =>
        entries.filter(([name]) => !draftHeaderNeedlesForSend.has(name.toLowerCase()))
      if (!hasAnyBodyInput) return withoutDraftRows(Object.entries(committedHeadersForSendWithoutDraftRows))
      if (params.bodyFormat === 'auto') {
        if (params.bodyFormatForDisplay !== 'json') return withoutDraftRows(Object.entries(committedHeadersForSendWithoutDraftRows))
        const next = { ...committedHeadersForSendWithoutDraftRows }
        if (!headerIsInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) setHeaderCaseInsensitive(next, 'Content-Type', 'application/json')
        return withoutDraftRows(Object.entries(next))
      }
      const next = { ...committedHeadersForSendWithoutDraftRows }
      if (!headerIsInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) setHeaderCaseInsensitive(next, 'Content-Type', params.contentTypeForBodyFormat(params.bodyFormat))
      return withoutDraftRows(Object.entries(next))
    })()

    const activeDraftHeaderEntriesForSend = headerDraftRowsToApply
      .filter(row => row.isActive)
      .map(row => [row.name.trim(), row.value] as [string, string])
    const headerEntriesForSend = [...committedHeaderEntriesForSend, ...activeDraftHeaderEntriesForSend]

    const queryDraftRowsToCommit = params.queryDraftRows.filter(r => r.name.trim() && r.value !== '')
    const hasDraftQueryToCommit = queryDraftRowsToCommit.length > 0
    const effectiveQueryParamsForCommit = hasDraftQueryToCommit ? params.effectiveQueryParams : params.queryParams
    const nextInactiveQueryParamNamesForSend = hasDraftQueryToCommit
      ? (() => {
        let next = params.inactiveQueryParamNames
        for (const row of queryDraftRowsToCommit) {
          const key = row.name.trim()
          if (!key) continue
          next = setFlagForKey(next, key, row.isActive)
        }
        return next
      })()
      : params.inactiveQueryParamNames

    const effectiveQueryParamsForSend = (() => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(effectiveQueryParamsForCommit)) {
        if (nextInactiveQueryParamNamesForSend[k]) continue
        out[k] = v
      }
      return out
    })()

    const effectiveDisabledQueryParamNamesForSend = hasDraftQueryToCommit
      ? (() => {
        let changed = false
        const next = { ...params.disabledQueryParamNames }
        for (const row of params.queryDraftRows) {
          const key = row.name.trim()
          if (!key) continue
          if (row.value === '') continue
          if (!params.querySpecNames.has(key)) continue
          if (key in next) {
            delete next[key]
            changed = true
          }
        }
        return changed ? next : params.disabledQueryParamNames
      })()
      : params.disabledQueryParamNames

    const formFields = params.supportsFileSend && params.effectiveContentType.toLowerCase().includes('multipart/form-data')
      ? parseFormFieldsFromBodyText(params.bodyText)
      : undefined

    const filesForMultipart = params.supportsFileSend && params.effectiveContentType.toLowerCase().includes('multipart/form-data')
      ? activeFileRows
        .map(r => ({ fieldName: r.fieldName.trim() || 'file', file: r.file }))
        .filter((x): x is { fieldName: string, file: File } => !!x.file)
      : undefined

    const emptyFileFieldNamesForMultipart = params.supportsFileSend && params.effectiveContentType.toLowerCase().includes('multipart/form-data')
      ? activeFileRows
        .filter(r => !r.file && !!r.fieldName.trim())
        .map(r => r.fieldName.trim())
      : undefined

    const firstFileForOctetStream = activeFileRows.find(r => r.file)?.file ?? null
    const fileForOctetStream = params.supportsFileSend ? firstFileForOctetStream : undefined
    const fileFieldName = (activeFileRows[0]?.fieldName || params.fileRows[0]?.fieldName || 'file').trim() || 'file'

    return {
      nextHeaderOverridesForSend,
      nextDisabledHeaderNamesForSend,
      nextInactiveHeaderNamesForSend,
      effectiveHeadersForSend,
      headerEntriesForSend,
      effectiveQueryParamsForCommit,
      nextInactiveQueryParamNamesForSend,
      effectiveQueryParamsForSend,
      effectiveDisabledQueryParamNamesForSend,
      formFields,
      filesForMultipart,
      emptyFileFieldNamesForMultipart,
      fileForOctetStream,
      fileFieldName,
    }
  }, [params, parseFormFieldsFromBodyText])

  const getSqlErrorResult = useCallback((statusText: string, message: string): RunResult => ({
    ok: false,
    status: 0,
    statusText,
    timeMs: 0,
    requestHeadersBytes: 0,
    requestBodyBytes: 0,
    requestBytes: 0,
    responseHeadersBytes: 0,
    responseBodyBytes: 0,
    responseBytes: 0,
    requestHeaders: {},
    responseHeaders: {},
    bodyText: message,
  }), [])

  const getCanceledResult = useCallback((): RunResult => ({
    ok: false,
    status: 0,
    statusText: 'Canceled',
    timeMs: 0,
    requestHeadersBytes: 0,
    requestBodyBytes: 0,
    requestBytes: 0,
    responseHeadersBytes: 0,
    responseBodyBytes: 0,
    responseBytes: 0,
    requestHeaders: {},
    responseHeaders: {},
    bodyText: 'Request was canceled.',
  }), [])

  const sendWithVariables = useCallback(async (args?: SendWithVariablesArgs) => {
    const effectiveVariables = args?.variablesOverride ?? params.variables
    const dataRow = args?.dataRow ?? null
    const requestIdKey = args?.requestIdKey ?? params.request.id
    const abortController = args?.abortController ?? new AbortController()
    const isExternalAbortController = !!args?.abortController
    if (!isExternalAbortController) abortControllersRef.current.set(requestIdKey, abortController)

    const runId = uid('run')
    params.onSendStart?.(params.request.id, runId)
    try {
      const snapshot = buildSendSnapshot()
      const effectivePathParamsForSend = (() => {
        if (!dataRow) return params.pathParams
        const knownPathKeys = new Set(params.pathParamsList.map(p => p.name).filter(Boolean))
        const next = { ...params.pathParams }
        for (const [k, v] of Object.entries(dataRow)) {
          if (!knownPathKeys.has(k)) continue
          next[k] = v
        }
        return next
      })()

      const knownQueryKeys = new Set<string>([
        ...Object.keys(snapshot.effectiveQueryParamsForCommit),
        ...Object.keys(snapshot.effectiveQueryParamsForSend),
        ...params.groupedQueryParams.map(p => p.name).filter(Boolean),
        ...params.queryDraftRows.map(r => r.name.trim()).filter(Boolean),
      ])

      const effectiveQueryParamsForCommit = (() => {
        if (!dataRow) return snapshot.effectiveQueryParamsForCommit
        const next = { ...snapshot.effectiveQueryParamsForCommit }
        for (const [k, v] of Object.entries(dataRow)) {
          if (!knownQueryKeys.has(k)) continue
          next[k] = v
        }
        return next
      })()

      const effectiveQueryParamsForSend = (() => {
        if (!dataRow) return snapshot.effectiveQueryParamsForSend
        const next = { ...snapshot.effectiveQueryParamsForSend }
        for (const [k, v] of Object.entries(dataRow)) {
          if (!knownQueryKeys.has(k)) continue
          next[k] = v
        }
        return next
      })()

      const resolvedPathParamsForHistory = Object.fromEntries(
        Object.entries(effectivePathParamsForSend).map(([key, value]) => [key, params.applyVariablesForDisplay(value, effectiveVariables)]),
      )
      const resolvedQueryParamsForHistory = Object.fromEntries(
        Object.entries(effectiveQueryParamsForCommit).map(([key, value]) => [key, params.applyVariablesForDisplay(value, effectiveVariables)]),
      )
      const resolvedHeadersForHistory = Object.fromEntries(
        Object.entries(snapshot.effectiveHeadersForSend).map(([key, value]) => [key, params.applyVariablesForDisplay(value, effectiveVariables)]),
      )
      const resolvedHeaderEntriesForHistory = snapshot.headerEntriesForSend.map(([name, value]) => ({
        name,
        value: params.applyVariablesForDisplay(value, effectiveVariables),
      }))
      const resolvedBodyTextForHistory = params.applyVariablesForDisplay(params.bodyText, effectiveVariables)

      params.onBeforeSend?.(params.request.id, {
        id: uid('hist'),
        createdAt: Date.now(),
        method: params.request.method,
        url: params.applyVariablesForDisplay(params.displayUrl, effectiveVariables),
        runId,
        responseStatus: null,
        draft: {
          pathParams: resolvedPathParamsForHistory,
          queryParams: resolvedQueryParamsForHistory,
          inactiveQueryParamNames: snapshot.nextInactiveQueryParamNamesForSend,
          queryParamKeyOverrides: params.queryParamKeyOverrides,
          disabledQueryParamNames: snapshot.effectiveDisabledQueryParamNamesForSend,
          headers: resolvedHeadersForHistory,
          headerEntries: resolvedHeaderEntriesForHistory,
          headerOverrides: snapshot.nextHeaderOverridesForSend,
          disabledHeaderNames: snapshot.nextDisabledHeaderNamesForSend,
          inactiveHeaderNames: snapshot.nextInactiveHeaderNamesForSend,
          preSqlScript: params.preSqlScript,
          postSqlScript: params.postSqlScript,
          preSqlScriptIsActive: params.preSqlScriptIsActive,
          postSqlScriptIsActive: params.postSqlScriptIsActive,
          sqlConnectionId: params.selectedSqlConnectionId ?? undefined,
          bodyText: resolvedBodyTextForHistory,
          bodyFormat: params.bodyFormat,
          fileFieldName: snapshot.fileFieldName,
          fileFieldNames: params.fileRows.map(r => r.fieldName.trim()).filter(Boolean),
          fileRows: params.fileRows.map(r => ({ fieldName: r.fieldName.trim(), fileName: r.file?.name ?? r.fileName, isActive: r.isActive })),
          baseUrlKey: params.baseUrlKey,
          urlTemplateOverride: params.urlTemplateOverride,
          dataDrivenInput: params.dataDrivenInput,
          selectedTestFunction: params.selectedTestFunction,
          requestTestScript: params.requestTestScript,
        },
      })

      const preSql = params.preSqlScriptIsActive ? params.preSqlScript.trim() : ''
      const postSql = params.postSqlScriptIsActive ? params.postSqlScript.trim() : ''
      const shouldRunSql = !!(preSql || postSql)

      if (shouldRunSql) {
        if (!params.selectedSqlConnection) {
          const result = getSqlErrorResult('SQL Failed', 'Missing database connection. Select it in SQL tab.')
          params.onResult(params.request.id, result, runId)
          return result
        }

        if (preSql) {
          const r = await params.runDbSqlFn({
            type: params.selectedSqlConnection.type,
            connectionString: params.selectedSqlConnection.connectionString,
            sql: params.applyVariablesForDisplay(preSql, effectiveVariables),
          })
          if (!r.ok) {
            const result = getSqlErrorResult('SQL Pre Script Failed', r.message || 'Pre script failed.')
            params.onResult(params.request.id, result, runId)
            return result
          }
        }

        if (abortController.signal.aborted) {
          const canceled = getCanceledResult()
          params.onResult(params.request.id, canceled, runId)
          return canceled
        }
      }

      let sendBaseUrl = params.baseUrl
      let sendUrlTemplateOverride = params.urlTemplateOverride
      let usedLocalMockServer = false
      const originalBaseUrl = params.baseUrl
      const originalUrlTemplateOverride = params.urlTemplateOverride
      try {
        const localServer = await getLocalMockServerStatus()
        if (localServer?.running && localServer.baseUrl) {
          usedLocalMockServer = true
          sendBaseUrl = localServer.baseUrl.trim()
          const overrideRaw = (params.urlTemplateOverride || '').trim()
          if (overrideRaw) {
            if (isAbsoluteUrl(overrideRaw) || overrideRaw.startsWith('//')) {
              try {
                const parsed = new URL(overrideRaw, 'http://localhost')
                sendUrlTemplateOverride = parsed.pathname || params.request.path
              } catch {
                sendUrlTemplateOverride = params.request.path
              }
            } else {
              sendUrlTemplateOverride = overrideRaw
            }
          } else {
            let pathPrefix = ''
            try {
              const parsedBase = new URL(params.baseUrl)
              pathPrefix = (parsedBase.pathname || '').trim()
            } catch {
              pathPrefix = ''
            }
            const normalizedPrefix = pathPrefix ? (pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`) : ''
            const cleanedPrefix = normalizedPrefix.replace(/\/+$/, '')
            sendUrlTemplateOverride = cleanedPrefix && cleanedPrefix !== '/'
              ? joinUrlParts(cleanedPrefix, params.request.path)
              : params.request.path
          }
        }
      } catch (error) {
        logWarn('sendWithVariables.localMockServerStatus', 'Failed to read local mock server status before send', { error })
      }

      let result = await runRequest({
        request: params.request,
        baseUrl: sendBaseUrl,
        urlTemplateOverride: sendUrlTemplateOverride,
        variables: effectiveVariables,
        pathParams: effectivePathParamsForSend,
        queryParams: effectiveQueryParamsForSend,
        headers: snapshot.effectiveHeadersForSend,
        headerEntries: snapshot.headerEntriesForSend,
        bodyText: params.bodyText,
        files: snapshot.filesForMultipart,
        emptyFileFieldNames: snapshot.emptyFileFieldNamesForMultipart,
        file: snapshot.fileForOctetStream,
        fileFieldName: snapshot.fileFieldName,
        formFields: snapshot.formFields,
        signal: abortController.signal,
      })

      if (usedLocalMockServer && result.status === 404) {
        const missHeader = (() => {
          for (const [k, v] of Object.entries(result.responseHeaders || {})) {
            if (k.toLowerCase() === 'x-ruf-local-mock-miss') return String(v || '')
          }
          return ''
        })()
        const isMissByBody = /"error"\s*:\s*"mock route not found"/i.test(result.bodyText || '')
        const isLocalMockMiss = missHeader === '1' || isMissByBody

        if (isLocalMockMiss && !abortController.signal.aborted) {
          result = await runRequest({
            request: params.request,
            baseUrl: originalBaseUrl,
            urlTemplateOverride: originalUrlTemplateOverride,
            variables: effectiveVariables,
            pathParams: effectivePathParamsForSend,
            queryParams: effectiveQueryParamsForSend,
            headers: snapshot.effectiveHeadersForSend,
            headerEntries: snapshot.headerEntriesForSend,
            bodyText: params.bodyText,
            files: snapshot.filesForMultipart,
            emptyFileFieldNames: snapshot.emptyFileFieldNamesForMultipart,
            file: snapshot.fileForOctetStream,
            fileFieldName: snapshot.fileFieldName,
            formFields: snapshot.formFields,
            signal: abortController.signal,
          })
        }
      }

      if (shouldRunSql && postSql) {
        if (abortController.signal.aborted) {
          const canceled = getCanceledResult()
          params.onResult(params.request.id, canceled, runId)
          return canceled
        }
        if (params.selectedSqlConnection) {
          const r = await params.runDbSqlFn({
            type: params.selectedSqlConnection.type,
            connectionString: params.selectedSqlConnection.connectionString,
            sql: params.applyVariablesForDisplay(postSql, effectiveVariables),
          })
          if (!r.ok) {
            result = {
              ...result,
              ok: false,
              bodyText: `${result.bodyText}\n\n-- SQL Post Script Failed --\n${r.message || 'Post script failed.'}\n`,
            }
          }
        } else {
          result = {
            ...result,
            ok: false,
            bodyText: `${result.bodyText}\n\n-- SQL Post Script Failed --\nMissing database connection. Select it in SQL tab.\n`,
          }
        }
      }

      const testResults = executeResponseTests({
        selectedGlobalTestFunction: params.selectedTestFunction,
        globalTestFunctions: params.availableGlobalTestFunctions,
        requestTestScript: params.requestTestScript,
        request: params.request,
        result,
      })
      result = { ...result, testResults }

      params.onResult(params.request.id, result, runId)
      return result
    } finally {
      if (!isExternalAbortController && abortControllersRef.current.get(requestIdKey) === abortController) {
        abortControllersRef.current.delete(requestIdKey)
      }
      params.onSendEnd?.(params.request.id, runId)
    }
  }, [buildSendSnapshot, getCanceledResult, getSqlErrorResult, params])

  const send = useCallback(async () => {
    await sendWithVariables()
  }, [sendWithVariables])

  return {
    buildSendSnapshot,
    send,
    sendWithVariables,
    cancelInFlightSend,
    abortAllSends,
  }
}
