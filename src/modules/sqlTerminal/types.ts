import type { Collection } from '../collectionTree'
import type { AiProviderSettings, McpServerSettings } from '../../shared/utils/appSettings'
import type { Environment, GlobalSqlConnectionItem } from '../../shared/types/environment'

export type DbConnOption = {
  id: string
  label: string
  type: 'postgres' | 'mysql'
  connectionString: string
  connectionPreview: string
  variables: Record<string, string>
}

export type OutputEntry = {
  kind: 'sys' | 'out' | 'err' | 'in'
  text: string
}

export type PopupPosition = {
  top: number
  left: number
}

export type ResultPagingState = {
  enabled: boolean
  loading: boolean
  hasMore: boolean
  loadAll: boolean
  baseSql: string
}

export type ExecuteSqlOptions = {
  scopeLabel: 'selection' | 'statement' | 'script' | 'ai'
}

export type SqlTerminalSelectedConnection = {
  type: 'postgres' | 'mysql'
  connectionString: string
}

export type SqlTerminalDrawerProps = {
  open: boolean
  onClose: () => void
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  extraConnections?: GlobalSqlConnectionItem[]
  aiSettings: AiProviderSettings
  mcpSettings: McpServerSettings[]
}
