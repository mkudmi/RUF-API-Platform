import type { ReactNode } from 'react'
import type { AiProviderSettings, JiraIntegrationSettings } from '../../shared/utils/appSettings'

export type AppSettingsTabContext = {
  closeSettings: () => void
  appVersion: string | null
  aiSettings: AiProviderSettings
  setAiSettings: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
  jiraSettings: JiraIntegrationSettings
  setJiraSettings: (next: JiraIntegrationSettings | ((prev: JiraIntegrationSettings) => JiraIntegrationSettings)) => void
  aiTestMessage: string | null
  aiTestError: string | null
}

export type AppSettingsTabExtension = {
  id: string
  label: string
  order?: number
  render?: (context: AppSettingsTabContext) => ReactNode
}
