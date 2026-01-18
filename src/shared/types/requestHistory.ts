import type { HttpMethod } from './collection'

export type RequestDraft = {
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  queryParamKeyOverrides?: Record<string, string>
  disabledQueryParamNames?: Record<string, true>
  /**
   * Effective headers snapshot used for a run (stored in request history).
   * Prefer `headerOverrides`/`disabledHeaderNames` for per-request editing state.
   */
  headers?: Record<string, string>
  headerOverrides?: Record<string, string>
  disabledHeaderNames?: Record<string, true>
  bodyText?: string
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
