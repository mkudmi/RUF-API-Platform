import type { HttpMethod } from '../../modules/collectionTree'

export type RequestDraft = {
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  queryKeyOrder?: string[]
  queryDraftRows?: Array<{ id?: string, name?: string, value?: string, isActive?: boolean }>
  inactiveQueryParamNames?: Record<string, true>
  queryParamKeyOverrides?: Record<string, string>
  disabledQueryParamNames?: Record<string, true>
  preSqlScript?: string
  postSqlScript?: string
  preSqlScriptIsActive?: boolean
  postSqlScriptIsActive?: boolean
  sqlConnectionId?: string
  /**
   * Effective headers snapshot used for a run (stored in request history).
   * Prefer `headerOverrides`/`disabledHeaderNames` for per-request editing state.
   */
  headers?: Record<string, string>
  headerOverrides?: Record<string, string>
  headerKeyOrder?: string[]
  headerDraftRows?: Array<{ id?: string, name?: string, value?: string, isActive?: boolean }>
  disabledHeaderNames?: Record<string, true>
  inactiveHeaderNames?: Record<string, true>
  bodyText?: string
  bodyFormat?: 'auto' | 'json' | 'xml' | 'yaml' | 'text'
  fileFieldName?: string
  fileFieldNames?: string[]
  fileRows?: Array<{ fieldName?: string, isActive?: boolean }>
  baseUrlKey?: string
  urlTemplateOverride?: string
}

export type RequestHistoryItem = {
  id: string
  createdAt: number
  method: HttpMethod
  url: string
  draft: RequestDraft
}
