import type { Collection } from '../../modules/collectionTree'
import type { RunResult } from '../../modules/requestRunner/runRequest'
import type { AiProviderSettings, CaCertificate, ClientTlsIdentity, JiraIntegrationSettings } from '../../shared/utils/appSettings'
import type { Environment, GlobalSqlConnectionItem, GlobalSqlConnectionSettings } from '../../shared/types/environment'
import type { RequestHistoryItem } from '../../shared/types/requestHistory'
import type { Workspace } from '../../shared/types/workspace'

export type AppSettingsState = {
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  requestTimeoutSec: number
  disableRequestTimeout: boolean
  globalSql: GlobalSqlConnectionSettings
  globalSqlConnections: GlobalSqlConnectionItem[]
  ai: AiProviderSettings
  jira: JiraIntegrationSettings
}

export type HistoryRepository = {
  loadByRequestId: () => Record<string, RequestHistoryItem[]>
  saveByRequestId: (history: Record<string, RequestHistoryItem[]>) => void
  append: (args: {
    historyByRequestId: Record<string, RequestHistoryItem[]>
    requestId: string
    item: RequestHistoryItem
    maxItemsPerRequest?: number
  }) => Record<string, RequestHistoryItem[]>
}

export type StorageRepository = {
  collections: {
    load: () => Collection[]
    save: (collections: Collection[]) => void
  }
  workspace: {
    load: () => Workspace
    save: (workspace: Workspace) => void
  }
  environments: {
    loadByCollection: () => Record<string, Environment>
    saveByCollection: (envs: Record<string, Environment>) => void
  }
}

export type SettingsRepository = {
  load: () => AppSettingsState
  save: (settings: AppSettingsState) => void
}

export type ModuleContext = {
  repositories: StorageRepository & {
    history: HistoryRepository
    settings: SettingsRepository
  }
  clocks: {
    now: () => number
  }
  runtime: {
    requestIdle: (cb: () => void, timeoutMs?: number) => { cancel: () => void }
  }
  transforms: {
    applyRunResultToHistoryItem: (item: RequestHistoryItem, result: RunResult) => RequestHistoryItem
  }
}
