import type { ReactNode } from 'react'
import type { AiProviderSettings, CaCertificate, ClientTlsIdentity, JiraIntegrationSettings } from '../../shared/utils/appSettings'

export type AppSettingsTabContext = {
  closeSettings: () => void
  appVersion: string | null
  aiSettings: AiProviderSettings
  setAiSettings: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
  jiraSettings: JiraIntegrationSettings
  setJiraSettings: (next: JiraIntegrationSettings | ((prev: JiraIntegrationSettings) => JiraIntegrationSettings)) => void
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  aiTestMessage: string | null
  aiTestError: string | null
  jiraTestBusy: boolean
  jiraTestMessage: string | null
  jiraTestError: string | null
  runJiraSettingsConnectionTest: () => void
}

export type AppSettingsTabExtension = {
  id: string
  label: string
  order?: number
  render?: (context: AppSettingsTabContext) => ReactNode
}
