import type { Collection, Folder, RequestItem } from '../types'

export type FolderPathKey = string

export function makeFolderPathKey(parts: string[]): FolderPathKey {
  return parts.join('\u0000')
}

export function getChildFolders(folder: Folder): Folder[] {
  return Array.isArray(folder.folders) ? folder.folders : []
}

export function walkFolders(args: {
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

export function requestMatchKey(folderPathKey: FolderPathKey, req: RequestItem): string {
  return `${folderPathKey}\u0001${req.method}\u0001${req.path}`
}

export function rootFolderPathKey(): FolderPathKey {
  return makeFolderPathKey([])
}

export function walkCollection(args: {
  collection: Collection
  onFolder: (folder: Folder, pathParts: string[], pathKey: FolderPathKey) => void
  onRequest: (req: RequestItem, folderPathKey: FolderPathKey) => void
}) {
  const rootKey = rootFolderPathKey()
  for (const req of args.collection.requests ?? []) args.onRequest(req, rootKey)
  walkFolders({
    folders: args.collection.folders,
    pathParts: [],
    onFolder: (folder, parts, key) => {
      args.onFolder(folder, parts, key)
      for (const req of folder.requests) args.onRequest(req, key)
    },
  })
}
