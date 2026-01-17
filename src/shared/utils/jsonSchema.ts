type JsonSchemaType = 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object'

export type JsonSchema = {
  $schema?: string
  title?: string
  type?: JsonSchemaType
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function schemaSignature(schema: JsonSchema): string {
  if (schema.anyOf?.length) return `anyOf(${schema.anyOf.map(schemaSignature).sort().join('|')})`
  if (schema.type === 'object') return `object(${Object.keys(schema.properties ?? {}).sort().join(',')})`
  if (schema.type === 'array') return `array(${schema.items ? schemaSignature(schema.items) : 'any'})`
  return String(schema.type ?? 'any')
}

function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (a.anyOf?.length || b.anyOf?.length) {
    const options = [...(a.anyOf ?? [a]), ...(b.anyOf ?? [b])]
    return mergeAnyOf(options)
  }

  if (a.type === 'integer' && b.type === 'number') return { type: 'number' }
  if (a.type === 'number' && b.type === 'integer') return { type: 'number' }
  if (a.type !== b.type) return mergeAnyOf([a, b])

  if (a.type === 'object') {
    const aProps = a.properties ?? {}
    const bProps = b.properties ?? {}
    const properties: Record<string, JsonSchema> = {}
    const keys = new Set([...Object.keys(aProps), ...Object.keys(bProps)])
    for (const k of keys) {
      const sa = aProps[k]
      const sb = bProps[k]
      if (sa && sb) properties[k] = mergeSchemas(sa, sb)
      else properties[k] = (sa ?? sb) as JsonSchema
    }

    const aReq = new Set(a.required ?? [])
    const bReq = new Set(b.required ?? [])
    const required = [...keys].filter(k => aReq.has(k) && bReq.has(k))

    return { type: 'object', properties, required: required.length ? required : undefined }
  }

  if (a.type === 'array') {
    const items = a.items && b.items ? mergeSchemas(a.items, b.items) : (a.items ?? b.items)
    return { type: 'array', items }
  }

  return { type: a.type }
}

function mergeAnyOf(options: JsonSchema[]): JsonSchema {
  const bySig = new Map<string, JsonSchema>()
  for (const s of options) bySig.set(schemaSignature(s), s)
  const unique = [...bySig.values()]

  if (unique.length === 0) return {}
  if (unique.length === 1) return unique[0]

  const byType = new Map<string, JsonSchema[]>()
  for (const s of unique) {
    const t = s.type ?? 'any'
    byType.set(t, [...(byType.get(t) ?? []), s])
  }

  const merged: JsonSchema[] = []
  for (const group of byType.values()) {
    merged.push(group.reduce((acc, cur) => mergeSchemas(acc, cur)))
  }

  if (merged.length === 1) return merged[0]
  return { anyOf: merged }
}

function schemaFor(value: unknown): JsonSchema {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} }
    const itemSchemas = value.map(schemaFor)
    const items = itemSchemas.reduce((acc, cur) => mergeSchemas(acc, cur))
    return { type: 'array', items }
  }

  if (isPlainObject(value)) {
    const properties: Record<string, JsonSchema> = {}
    const keys = Object.keys(value)
    for (const k of keys) properties[k] = schemaFor(value[k])
    return { type: 'object', properties, required: keys.length ? keys : undefined }
  }

  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
  return {}
}

export function generateJsonSchema(value: unknown, title = 'requestResponseSchema'): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    ...schemaFor(value),
  }
}

