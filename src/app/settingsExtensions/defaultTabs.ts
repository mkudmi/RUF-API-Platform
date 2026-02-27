import type { AppSettingsTabExtension } from './types'

const generalTab: AppSettingsTabExtension = { id: 'general', label: 'General', order: 10 }
const updateTab: AppSettingsTabExtension = { id: 'update', label: 'Update', order: 20 }
const sqlTab: AppSettingsTabExtension = { id: 'sql', label: 'SQL', order: 30 }

export function getDefaultSettingsTabExtensions(): AppSettingsTabExtension[] {
  return [generalTab, updateTab, sqlTab]
}
