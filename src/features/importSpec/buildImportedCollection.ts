import { loadOpenApiFromText, parseJsonOrYaml } from './openapiLoader'
import { buildCollectionFromV3 } from '../collections/buildCollection'
import { buildCollectionFromPostman, isPostmanCollection } from '../importPostman/postmanCollection'
import type { Collection } from '../../shared/types/collection'

function inferCollectionName(spec: any) {
  const title = spec?.info?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  return 'Imported API'
}

export async function buildImportedCollectionFromText(args: {
  text: string
  name?: string
  sourceOrigin?: string
}): Promise<Collection> {
  const parsed = parseJsonOrYaml(args.text)
  if (isPostmanCollection(parsed)) {
    return buildCollectionFromPostman(parsed, args.name)
  }

  const specV3 = await loadOpenApiFromText(args.text)
  const name = (args.name || inferCollectionName(specV3)).trim() || 'Imported API'
  return buildCollectionFromV3(specV3, name, args.sourceOrigin)
}

