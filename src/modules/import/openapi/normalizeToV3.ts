function guessBaseUrl(swagger2: any): string | undefined {
  const host = typeof swagger2?.host === 'string' ? swagger2.host.trim() : ''
  const basePath = typeof swagger2?.basePath === 'string' ? swagger2.basePath.trim() : ''
  const schemes: any[] = Array.isArray(swagger2?.schemes) ? swagger2.schemes : []

  if (!host) return undefined
  const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https'
  const bp = basePath ? (basePath.startsWith('/') ? basePath : `/${basePath}`) : ''
  return `${scheme}://${host}${bp}`
}

function normalizeConsumes(consumes: any): string[] {
  if (!Array.isArray(consumes)) return []
  return consumes.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
}

function swagger2ParamsToV3(opOrPathItem: any): any[] {
  const params = Array.isArray(opOrPathItem?.parameters) ? opOrPathItem.parameters : []
  return params.filter(Boolean)
}

function resolveRef(doc: any, ref: string): any {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
  const parts = ref.slice(2).split('/').filter(Boolean).map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))
  let cur: any = doc
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function exampleFromSwagger2SchemaShallow(schema: any, doc: any, depth = 0): any {
  if (!schema || typeof schema !== 'object') return undefined
  if (depth > 6) return undefined

  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(doc, schema.$ref)
    if (resolved) return exampleFromSwagger2SchemaShallow(resolved, doc, depth + 1)
  }

  if (schema.example !== undefined) return schema.example
  if (schema['x-example'] !== undefined) return schema['x-example']
  if (schema.default !== undefined) return schema.default
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]

  return undefined
}

function exampleFromSwagger2BodyParam(bodyParam: any, doc: any): any {
  if (!bodyParam || typeof bodyParam !== 'object') return undefined
  if (bodyParam.example !== undefined) return bodyParam.example
  if (bodyParam['x-example'] !== undefined) return bodyParam['x-example']
  if (bodyParam.schema) return exampleFromSwagger2SchemaShallow(bodyParam.schema, doc)
  return undefined
}

function buildRequestBodyFromSwagger2Params(params: any[], consumes: string[], doc: any) {
  const ct =
    consumes.find(x => x === 'application/json') ||
    consumes[0] ||
    'application/json'

  const bodyParam = params.find(p => p?.in === 'body' && p?.schema)
  if (bodyParam?.schema) {
    const example = exampleFromSwagger2BodyParam(bodyParam, doc)
    return {
      content: {
        [ct]: example === undefined ? { schema: bodyParam.schema } : { schema: bodyParam.schema, example },
      },
    }
  }

  const formParams = params.filter(p => p?.in === 'formData' && typeof p?.name === 'string' && p.name)
  if (formParams.length) {
    const props: Record<string, any> = {}
    for (const p of formParams) {
      const ex = p.example ?? p['x-example']
      props[p.name] = ex === undefined ? { type: p.type || 'string' } : { type: p.type || 'string', example: ex }
    }

    const formCt =
      consumes.find(x => x === 'multipart/form-data') ||
      consumes.find(x => x === 'application/x-www-form-urlencoded') ||
      ct

    return {
      content: {
        [formCt]: { schema: { type: 'object', properties: props }, example: {} },
      },
    }
  }

  return undefined
}

function swagger2ParamToV3Param(p: any) {
  if (!p || typeof p !== 'object') return undefined
  if (p.in !== 'path' && p.in !== 'query' && p.in !== 'header') return undefined
  if (typeof p.name !== 'string' || !p.name) return undefined

  const required = p.in === 'path' ? true : !!p.required
  const schema =
    p.schema && typeof p.schema === 'object'
      ? p.schema
      : { type: p.type || 'string' }

  // Swagger 2 non-body params often put `enum` on the parameter itself.
  if (!Array.isArray(schema.enum) && Array.isArray(p.enum) && p.enum.length) {
    schema.enum = p.enum
  }

  return {
    name: p.name,
    in: p.in,
    required,
    schema,
    example: p.example,
  }
}

function swagger2ToV3Like(swagger2: any): any {
  const baseUrl = guessBaseUrl(swagger2)
  const globalConsumes = normalizeConsumes(swagger2?.consumes)

  const outPaths: Record<string, any> = {}
  const paths = swagger2?.paths && typeof swagger2.paths === 'object' ? swagger2.paths : {}

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path]
    if (!pathItem || typeof pathItem !== 'object') continue

    const pathLevelParams = swagger2ParamsToV3(pathItem)

    const v3PathItem: Record<string, any> = {}
    for (const method of Object.keys(pathItem)) {
      if (method === 'parameters') continue
      const op = pathItem[method]
      if (!op || typeof op !== 'object') continue

      const consumes = normalizeConsumes(op?.consumes)
      const ctList = consumes.length ? consumes : globalConsumes

      const opParams = swagger2ParamsToV3(op)
      const mergedParams = [...pathLevelParams, ...opParams]

      const requestBody = buildRequestBodyFromSwagger2Params(mergedParams, ctList, swagger2)
      const parameters = mergedParams
        .map(swagger2ParamToV3Param)
        .filter(Boolean)

      v3PathItem[method] = {
        summary: op.summary,
        description: op.description,
        operationId: op.operationId,
        tags: Array.isArray(op.tags) ? op.tags : undefined,
        parameters: parameters.length ? parameters : undefined,
        requestBody,
      }
    }

    outPaths[path] = v3PathItem
  }

  return {
    openapi: '3.0.0',
    servers: baseUrl ? [{ url: baseUrl }] : undefined,
    paths: outPaths,
  }
}

export async function normalizeToV3(api: any): Promise<any> {
  if (typeof api?.openapi === 'string' && api.openapi.startsWith('3.')) return api
  if (api?.swagger === '2.0') return swagger2ToV3Like(api)
  return api
}
