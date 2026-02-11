import type { AppSettingsTabExtension } from './types'

const generalTab: AppSettingsTabExtension = { id: 'general', label: 'General', order: 10 }
const certificatesTab: AppSettingsTabExtension = { id: 'certificates', label: 'Certificates', order: 20 }
const updateTab: AppSettingsTabExtension = { id: 'update', label: 'Update', order: 30 }
const sqlTab: AppSettingsTabExtension = { id: 'sql', label: 'SQL', order: 40 }

export function getDefaultSettingsTabExtensions(): AppSettingsTabExtension[] {
  return [generalTab, certificatesTab, updateTab, sqlTab]
}
