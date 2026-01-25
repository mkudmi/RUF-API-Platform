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

function inc(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n)
}

function collectCounts(col: Collection): { folderCounts: Map<string, number>, requestCounts: Map<string, number> } {
  const folderCounts = new Map<string, number>()
  const requestCounts = new Map<string, number>()

  const rootKey = makeFolderPathKey([])
  for (const req of col.requests ?? []) inc(requestCounts, requestMatchKey(rootKey, req))

  walkFolders({
    folders: col.folders,
    pathParts: [],
    onFolder: (folder, _parts, key) => {
      inc(folderCounts, key)
      for (const req of folder.requests) inc(requestCounts, requestMatchKey(key, req))
    },
  })

  return { folderCounts, requestCounts }
}

function diffCounts(existing: Map<string, number>, incoming: Map<string, number>) {
  let added = 0
  let removed = 0
  const keys = new Set<string>([...existing.keys(), ...incoming.keys()])
  for (const key of keys) {
    const prev = existing.get(key) ?? 0
    const next = incoming.get(key) ?? 0
    if (next > prev) added += next - prev
    if (prev > next) removed += prev - next
  }
  return { added, removed }
}

export function summarizeCollectionDiff(existing: Collection, incoming: Collection) {
  const a = collectCounts(existing)
  const b = collectCounts(incoming)

  const folder = diffCounts(a.folderCounts, b.folderCounts)
  const req = diffCounts(a.requestCounts, b.requestCounts)

  return {
    addedFolders: folder.added,
    removedFolders: folder.removed,
    addedRequests: req.added,
    removedRequests: req.removed,
  }
}

