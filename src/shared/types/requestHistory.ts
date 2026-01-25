import type { HttpMethod } from '../../modules/collectionTree'

export type RequestDraft = {
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  inactiveQueryParamNames?: Record<string, true>
  queryParamKeyOverrides?: Record<string, string>
  disabledQueryParamNames?: Record<string, true>
  preSqlScript?: string
  postSqlScript?: string
  /**
   * Effective headers snapshot used for a run (stored in request history).
   * Prefer `headerOverrides`/`disabledHeaderNames` for per-request editing state.
   */
  headers?: Record<string, string>
  headerOverrides?: Record<string, string>
  disabledHeaderNames?: Record<string, true>
  inactiveHeaderNames?: Record<string, true>
  bodyText?: string
  bodyFormat?: 'auto' | 'json' | 'xml' | 'yaml' | 'text'
  fileFieldName?: string
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
