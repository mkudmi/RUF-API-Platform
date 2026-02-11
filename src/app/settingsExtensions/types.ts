import type { ReactNode } from 'react'

export type AppSettingsTabContext = {
  closeSettings: () => void
  appVersion: string | null
}

export type AppSettingsTabExtension = {
  id: string
  label: string
  order?: number
  render?: (context: AppSettingsTabContext) => ReactNode
}
