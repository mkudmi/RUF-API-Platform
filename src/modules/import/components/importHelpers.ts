import type { Collection } from '../../collectionTree'
import { buildImportedCollectionFromText } from '../buildImportedCollection'
import { loadSpecFromUrl } from '../loadSpecFromUrl'

type CollectionMeta = {
  sourceOrigin?: string
  sourceUrl?: string
  sourceType?: 'file' | 'url'
  sourceFileName?: string
}

function withCollectionMeta(collection: Collection, meta: CollectionMeta): Collection {
  return {
    ...collection,
    ...(meta.sourceOrigin ? { sourceOrigin: meta.sourceOrigin } : null),
    ...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : null),
    ...(meta.sourceType ? { sourceType: meta.sourceType } : null),
    ...(meta.sourceFileName ? { sourceFileName: meta.sourceFileName } : null),
  }
}

export async function importCollectionFromText(args: {
  text: string
  name?: string
  sourceOrigin?: string
  sourceUrl?: string
  sourceType?: 'file' | 'url'
  sourceFileName?: string
}): Promise<Collection> {
  const col = await buildImportedCollectionFromText({
    text: args.text,
    name: args.name,
    sourceOrigin: args.sourceOrigin,
  })
  return withCollectionMeta(col, {
    sourceOrigin: args.sourceOrigin,
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    sourceFileName: args.sourceFileName,
  })
}

export async function importCollectionFromFile(file: File, args?: { name?: string }): Promise<Collection> {
  const text = await file.text()
  return importCollectionFromText({
    text,
    name: args?.name,
    sourceType: 'file',
    sourceFileName: file.name,
  })
}

export async function loadImportSourceFromUrl(rawUrl: string): Promise<{ text: string, url: string, origin: string }> {
  const url = rawUrl.trim()
  if (!url) throw new Error('Enter a URL.')
  return loadSpecFromUrl(url)
}

export async function importCollectionFromUrl(args: { rawUrl: string, name?: string }): Promise<Collection> {
  const loaded = await loadImportSourceFromUrl(args.rawUrl)
  if (!loaded.text.trim()) throw new Error('Empty response.')
  return importCollectionFromText({
    text: loaded.text,
    name: args.name,
    sourceOrigin: loaded.origin,
    sourceUrl: loaded.url,
    sourceType: 'url',
  })
}
