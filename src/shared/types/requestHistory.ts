import type { HttpMethod } from './collection'

export type RequestDraft = {
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  queryParamKeyOverrides?: Record<string, string>
  disabledQueryParamNames?: Record<string, true>
  headers?: Record<string, string>
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
