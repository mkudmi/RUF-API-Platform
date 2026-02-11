import { getDefaultRequestEditorTabExtensions } from './defaultTabs'
import { customRequestEditorTabExtensions } from './customTabs'
import type { RequestEditorTabExtension } from './types'

export function buildRequestEditorTabExtensions(extraTabs?: RequestEditorTabExtension[]): RequestEditorTabExtension[] {
  const tabs = [
    ...getDefaultRequestEditorTabExtensions(),
    ...customRequestEditorTabExtensions,
    ...(extraTabs ?? []),
  ]
  return tabs
    .filter(tab => !!tab?.id)
    .sort((a, b) => (a.order ?? 1_000) - (b.order ?? 1_000))
}
