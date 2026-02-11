import { customSettingsTabExtensions } from './customTabs'
import { getDefaultSettingsTabExtensions } from './defaultTabs'
import type { AppSettingsTabExtension } from './types'

export function buildSettingsTabExtensions(extraTabs?: AppSettingsTabExtension[]): AppSettingsTabExtension[] {
  const tabs = [
    ...getDefaultSettingsTabExtensions(),
    ...customSettingsTabExtensions,
    ...(extraTabs ?? []),
  ]
  const dedup = new Map<string, AppSettingsTabExtension>()
  for (const tab of tabs) {
    if (!tab?.id) continue
    dedup.set(tab.id, tab)
  }
  return [...dedup.values()].sort((a, b) => (a.order ?? 1_000) - (b.order ?? 1_000))
}
