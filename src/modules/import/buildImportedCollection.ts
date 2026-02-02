import { loadOpenApiFromText, parseJsonOrYaml } from './openapi/openapiLoader'
import { buildCollectionFromV3, type Collection } from '../collectionTree'
import { buildCollectionFromPostman, isPostmanCollection } from './postman/postmanCollection'
import { buildCollectionFromInsomnia, isInsomniaExport } from './insomnia/insomniaCollection'
import { buildCollectionFromWsdlText, isWsdlText } from './wsdl/wsdlImporter'
import type { Environment } from '../../shared/types/environment'
import { isDbEnvKey } from '../environment/utils/dbConnection'

function inferCollectionName(spec: any) {
  const title = spec?.info?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  return 'Imported API'
}

function parseRufEnvironment(raw: any): Environment | null {
  if (!raw || typeof raw !== 'object') return null
  const baseUrlKey = typeof (raw as any).baseUrlKey === 'string' && (raw as any).baseUrlKey.trim()
    ? String((raw as any).baseUrlKey).trim()
    : 'baseUrl'

  const varsObj = (raw as any).variables && typeof (raw as any).variables === 'object' ? (raw as any).variables : {}
  const variables: Record<string, string> = {}
  for (const [k, v] of Object.entries(varsObj)) {
    if (typeof k !== 'string' || !k.trim()) continue
    if (isDbEnvKey(k)) continue
    variables[k] = typeof v === 'string' ? v : v == null ? '' : String(v)
  }
  return { baseUrlKey, variables, headers: {} }
}

export async function buildImportedCollectionFromText(args: {
  text: string
  name?: string
  sourceOrigin?: string
}): Promise<Collection> {
  if (isWsdlText(args.text)) {
    return buildCollectionFromWsdlText(args.text, args.name)
  }

  const parsed = parseJsonOrYaml(args.text)
  if (isPostmanCollection(parsed)) {
    const col = buildCollectionFromPostman(parsed, args.name)
    const env = parseRufEnvironment((parsed as any)?.rufEnvironment)
    if (env) {
      Object.defineProperty(col, '__rufEnvironment', {
        value: env,
        enumerable: false,
        configurable: true,
      })
    }
    return col
  }
  if (isInsomniaExport(parsed)) {
    return buildCollectionFromInsomnia(parsed, args.name)
  }

  const specV3 = await loadOpenApiFromText(args.text)
  const name = (args.name || inferCollectionName(specV3)).trim() || 'Imported API'
  return buildCollectionFromV3(specV3, name, args.sourceOrigin)
}
