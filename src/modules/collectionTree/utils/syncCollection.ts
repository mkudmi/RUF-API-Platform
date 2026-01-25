import type { Collection, Folder, RequestItem } from '../types'
import { getChildFolders, makeFolderPathKey, requestMatchKey, rootFolderPathKey, walkFolders, type FolderPathKey } from './collectionTraversal'

export function syncCollectionKeepingIds(args: {
  existing: Collection
  incoming: Collection
}): Collection {
  const existingFolderIdByPath = new Map<FolderPathKey, string>()
  walkFolders({
    folders: args.existing.folders,
    pathParts: [],
    onFolder: (folder, _parts, key) => {
      existingFolderIdByPath.set(key, folder.id)
    },
  })

  const existingRequestIdsByKey = new Map<string, string[]>()

  function pushRequestKey(folderPathKey: FolderPathKey, req: RequestItem) {
    const key = requestMatchKey(folderPathKey, req)
    const list = existingRequestIdsByKey.get(key)
    if (list) list.push(req.id)
    else existingRequestIdsByKey.set(key, [req.id])
  }

  const rootKey = rootFolderPathKey()
  for (const req of args.existing.requests ?? []) pushRequestKey(rootKey, req)
  walkFolders({
    folders: args.existing.folders,
    pathParts: [],
    onFolder: (folder, _parts, key) => {
      for (const req of folder.requests) pushRequestKey(key, req)
      // folders handled by recursion above
    },
  })

  function takeExistingRequestId(folderPathKey: FolderPathKey, req: RequestItem): string | null {
    const key = requestMatchKey(folderPathKey, req)
    const list = existingRequestIdsByKey.get(key)
    if (!list || list.length === 0) return null
    return list.shift() ?? null
  }

  function mapRequests(folderPathKey: FolderPathKey, incoming: RequestItem[] | undefined) {
    const arr = incoming ?? []
    return arr.map(r => {
      const preservedId = takeExistingRequestId(folderPathKey, r)
      return preservedId ? { ...r, id: preservedId } : r
    })
  }

  function mapFolders(incomingFolders: Folder[], pathParts: string[]): Folder[] {
    return incomingFolders.map(f => {
      const nextParts = [...pathParts, f.name]
      const key = makeFolderPathKey(nextParts)
      const preservedId = existingFolderIdByPath.get(key)
      const folders = mapFolders(getChildFolders(f), nextParts)
      return {
        ...f,
        id: preservedId ?? f.id,
        requests: mapRequests(key, f.requests),
        folders,
      }
    })
  }

  const mappedIncomingFolders = mapFolders(args.incoming.folders, [])
  const mappedIncomingRequests = mapRequests(rootKey, args.incoming.requests)

  return {
    ...args.incoming,
    id: args.existing.id,
    name: args.existing.name,
    sourceUrl: args.existing.sourceUrl ?? args.incoming.sourceUrl,
    baseUrl: args.incoming.baseUrl ?? args.existing.baseUrl,
    variables: args.incoming.variables ?? args.existing.variables,
    requests: (mappedIncomingRequests?.length ? mappedIncomingRequests : undefined) ?? args.existing.requests,
    folders: mappedIncomingFolders,
  }
}
