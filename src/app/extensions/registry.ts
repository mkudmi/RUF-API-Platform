import { getDefaultSidebarToolExtensions } from './defaultSidebarTools'
import { customSidebarToolExtensions } from './customSidebarTools'
import type { AppSidebarToolExtension } from './types'

export function buildSidebarToolExtensions(extraTools?: AppSidebarToolExtension[]): AppSidebarToolExtension[] {
  const tools = [
    ...getDefaultSidebarToolExtensions(),
    ...customSidebarToolExtensions,
    ...(extraTools ?? []),
  ]
  const dedup = new Map<string, AppSidebarToolExtension>()
  for (const tool of tools) {
    if (!tool?.id) continue
    dedup.set(tool.id, tool)
  }
  return [...dedup.values()].sort((a, b) => (a.order ?? 1_000) - (b.order ?? 1_000))
}
