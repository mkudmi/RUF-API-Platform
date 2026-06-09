import type { RequestDraft } from '../../../shared/types/requestHistory'
import { logWarn } from '../../../shared/utils/logger'
import { beautifyBody, type BeautifyBodyFormat } from './bodyBeautify'

export type BodyFormat = NonNullable<RequestDraft['bodyFormat']>

export function labelForBodyFormat(format: BodyFormat) {
  switch (format) {
    case 'json': return 'JSON'
    case 'xml': return 'XML'
    case 'yaml': return 'YAML'
    case 'text': return 'Plain Text'
    case 'auto': return 'Auto'
  }
}

export function contentTypeForBodyFormat(format: Exclude<BodyFormat, 'auto'>) {
  switch (format) {
    case 'json': return 'application/json'
    case 'xml': return 'application/xml'
    case 'yaml': return 'application/yaml'
    case 'text': return 'text/plain'
  }
}

export function inferBodyFormatFromContentType(contentType: string): BeautifyBodyFormat {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('yaml') || ct.includes('yml')) return 'yaml'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('text/plain')) return 'text'
  return 'text'
}

export function inferBodyFormatFromBodyText(bodyText: string): Exclude<BodyFormat, 'auto'> | null {
  const raw = (bodyText || '').trim()
  if (!raw) return null

  if ((raw.startsWith('{') || raw.startsWith('['))) {
    try {
      JSON.parse(raw)
      return 'json'
    } catch (error) {
      logWarn('inferBodyFormatFromBodyText.json', 'JSON parse failed during format inference', { error })
    }
  }

  if (raw.startsWith('<')) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(raw, 'application/xml')
      if (!doc.getElementsByTagName('parsererror')?.length) return 'xml'
    } catch (error) {
      logWarn('inferBodyFormatFromBodyText.xml', 'XML parse failed during format inference', { error })
    }
  }

  const looksLikeYaml =
    raw.startsWith('---') ||
    /^[\t ]*[^#\s][^:\n]*:[^\n]*$/m.test(raw) ||
    /^[\t ]*-\s+\S+/m.test(raw)

  if (looksLikeYaml) {
    try {
      beautifyBody(raw, 'yaml')
      return 'yaml'
    } catch (error) {
      logWarn('inferBodyFormatFromBodyText.yaml', 'YAML parse failed during format inference', { error })
    }
  }

  return null
}

export function templateForBodyFormat(format: BodyFormat): string {
  switch (format) {
    case 'json': return '{\n  \n}'
    case 'xml': return '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  \n</root>'
    case 'yaml': return '---\nkey: value\n'
    case 'text': return ''
    case 'auto': return ''
  }
}
