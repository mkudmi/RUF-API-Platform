import type { ReactNode } from 'react'
import type { AiProviderSettings, CaCertificate, ClientTlsIdentity, McpServerSettings } from '../../shared/utils/appSettings'

export type AppSettingsTabContext = {
  closeSettings: () => void
  appVersion: string | null
  aiSettings: AiProviderSettings
  setAiSettings: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
  mcpSettings: McpServerSettings[]
  setMcpSettings: (next: McpServerSettings[] | ((prev: McpServerSettings[]) => McpServerSettings[])) => void
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  aiTestMessage: string | null
  aiTestError: string | null
}

export type AppSettingsTabExtension = {
  id: string
  label: string
  order?: number
  render?: (context: AppSettingsTabContext) => ReactNode
}
