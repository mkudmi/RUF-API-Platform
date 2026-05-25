import type { ReactNode } from 'react'
import type { Collection, RequestItem } from '../../collectionTree'
import type { RunResult } from '../../requestRunner/runRequest'
import type { Environment, GlobalSqlConnectionItem } from '../../../shared/types/environment'
import type { VariableSuggestion } from '../../../shared/utils/variables'

export type RequestEditorTabContext = {
  collection: Collection
  request: RequestItem
  latestResult?: RunResult | null
  mockRouteMethodDefault: string
  mockRoutePathDefault: string
  mockTargetOriginDefault: string
  environment?: Environment
  globalSqlConnections?: GlobalSqlConnectionItem[]
  variableSuggestions: VariableSuggestion[]
  committedHeaders: Record<string, string>
  setHeaderValue: (headerName: string, value: string) => void
  sqlConnections: Array<{ id: string, label: string, connectionPreview: string }>
  selectedSqlConnectionId: string | null
  setSelectedSqlConnectionId: (id: string | null) => void
  preSqlScript: string
  postSqlScript: string
  preSqlScriptIsActive: boolean
  postSqlScriptIsActive: boolean
  setPreSqlScript: (value: string) => void
  setPostSqlScript: (value: string) => void
  setPreSqlScriptIsActive: (active: boolean) => void
  setPostSqlScriptIsActive: (active: boolean) => void
}

export type RequestEditorTabExtension = {
  id: string
  label: string
  order?: number
  hasData?: (context: RequestEditorTabContext) => boolean
  render: (context: RequestEditorTabContext) => ReactNode
}
