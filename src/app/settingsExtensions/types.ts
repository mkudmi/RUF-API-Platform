import type { ReactNode } from 'react'
import type { AiProviderSettings } from '../../shared/utils/appSettings'

export type AppSettingsTabContext = {
  closeSettings: () => void
  appVersion: string | null
  aiSettings: AiProviderSettings
  setAiSettings: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
}

export type AppSettingsTabExtension = {
  id: string
  label: string
  order?: number
  render?: (context: AppSettingsTabContext) => ReactNode
}
