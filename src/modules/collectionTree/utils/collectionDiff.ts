import type { Collection } from '../types'
import { requestMatchKey, walkCollection } from './collectionTraversal'

function inc(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n)
}

function collectCounts(col: Collection): { folderCounts: Map<string, number>, requestCounts: Map<string, number> } {
  const folderCounts = new Map<string, number>()
  const requestCounts = new Map<string, number>()

  walkCollection({
    collection: col,
    onFolder: (_folder, _parts, key) => inc(folderCounts, key),
    onRequest: (req, folderPathKey) => inc(requestCounts, requestMatchKey(folderPathKey, req)),
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
