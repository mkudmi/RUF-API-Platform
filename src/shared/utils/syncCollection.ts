import type { Collection, Folder, RequestItem } from '../types/collection'

type FolderPathKey = string

function makeFolderPathKey(parts: string[]): FolderPathKey {
  return parts.join('\u0000')
}

function getChildFolders(folder: Folder): Folder[] {
  return Array.isArray(folder.folders) ? folder.folders : []
}

function walkFolders(args: {
  folders: Folder[]
  pathParts: string[]
  onFolder: (folder: Folder, pathParts: string[], pathKey: FolderPathKey) => void
}) {
  for (const folder of args.folders) {
    const nextParts = [...args.pathParts, folder.name]
    const key = makeFolderPathKey(nextParts)
    args.onFolder(folder, nextParts, key)
    walkFolders({ folders: getChildFolders(folder), pathParts: nextParts, onFolder: args.onFolder })
  }
}

function requestMatchKey(folderPathKey: FolderPathKey, req: RequestItem): string {
  return `${folderPathKey}\u0001${req.method}\u0001${req.path}`
}

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

  const rootKey = makeFolderPathKey([])
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
