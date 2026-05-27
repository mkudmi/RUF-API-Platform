import type { ReactNode } from 'react'
import type { Collection } from '../../modules/collectionTree'
import type { AiProviderSettings, CaCertificate, ClientTlsIdentity, McpServerSettings } from '../../shared/utils/appSettings'
import type { Environment, GlobalSqlConnectionItem } from '../../shared/types/environment'

export type AppDrawerRenderContext = {
  openDrawerId: string | null
  closeDrawer: () => void
  openSettings: (tabId?: string) => void
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  globalSqlConnections: GlobalSqlConnectionItem[]
  aiSettings: AiProviderSettings
  mcpSettings: McpServerSettings[]
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  appVersion: string | null
}

export type AppSidebarToolExtension = {
  id: string
  label: string
  title: string
  icon: ReactNode
  order?: number
  buttonClassName?: string
  render: (context: AppDrawerRenderContext) => ReactNode
}
