import { parse as parseYaml } from 'yaml'
import { normalizeToV3 } from './normalizeToV3'

export function parseJsonOrYaml(text: string): any {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty spec')

  try {
    return JSON.parse(trimmed)
  } catch {
    // ignore
  }

  try {
    return parseYaml(trimmed)
  } catch (e: any) {
    throw new Error(e?.message || 'Invalid YAML/JSON')
  }
}

function decodeJsonPointerToken(token: string) {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

function getByJsonPointer(root: any, ref: string): any {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined

  const parts = ref
    .slice(2)
    .split('/')
    .map(decodeJsonPointerToken)

  let cur = root
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = (cur as any)[p]
    else return undefined
  }
  return cur
}

function dereferenceLocalRefs(root: any): any {
  const cache = new Map<string, any>()
  const inProgress = new Set<string>()

  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(walk)

    const ref = (node as any).$ref
    if (typeof ref === 'string' && ref.startsWith('#/')) {
      const { $ref: _omit, ...rest } = node as any

      if (cache.has(ref)) {
        const cached = cache.get(ref)
        return Object.keys(rest).length ? { ...cached, ...walk(rest) } : cached
      }
      if (inProgress.has(ref)) return node

      const target = getByJsonPointer(root, ref)
      if (target === undefined) return node

      inProgress.add(ref)
      const resolved = walk(target)
      inProgress.delete(ref)

      cache.set(ref, resolved)
      return Object.keys(rest).length ? { ...resolved, ...walk(rest) } : resolved
    }

    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v)
    return out
  }

  return walk(root)
}

export async function loadOpenApiFromText(text: string) {
  const parsed = parseJsonOrYaml(text)
  const deref = dereferenceLocalRefs(parsed)
  return normalizeToV3(deref)
}
