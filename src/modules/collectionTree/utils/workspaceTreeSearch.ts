import type { Collection, Folder, RequestItem } from '../types'
import type { WorkspaceFolder } from '../../../shared/types/workspace'

export function normalizeWorkspaceTreeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function requestMatchesSearch(req: RequestItem, searchTerm: string): boolean {
  const method = req.method.toLowerCase()
  const name = req.name.toLowerCase()
  const path = req.path.toLowerCase()
  const urlTemplate = req.urlTemplate.toLowerCase()
  return method.includes(searchTerm) || name.includes(searchTerm) || path.includes(searchTerm) || urlTemplate.includes(searchTerm)
}

function filterCollectionFolder(folder: Folder, searchTerm: string): Folder | null {
  const nameMatches = folder.name.toLowerCase().includes(searchTerm)
  const nextRequests = folder.requests.filter(req => requestMatchesSearch(req, searchTerm))
  const nextFolders = (folder.folders ?? [])
    .map(child => filterCollectionFolder(child, searchTerm))
    .filter((child): child is Folder => child !== null)

  if (!nameMatches && !nextRequests.length && !nextFolders.length) return null
  return {
    ...folder,
    requests: nextRequests,
    folders: nextFolders.length ? nextFolders : undefined,
  }
}

function filterCollection(collection: Collection, searchTerm: string): Collection | null {
  if (!searchTerm) return collection

  const collectionNameMatches = collection.name.toLowerCase().includes(searchTerm)
  const baseUrlMatches = (collection.baseUrl ?? '').toLowerCase().includes(searchTerm)
  const nextRootRequests = (collection.requests ?? []).filter(req => requestMatchesSearch(req, searchTerm))
  const nextFolders = collection.folders
    .map(folder => filterCollectionFolder(folder, searchTerm))
    .filter((folder): folder is Folder => folder !== null)

  if (!collectionNameMatches && !baseUrlMatches && !nextRootRequests.length && !nextFolders.length) return null
  return {
    ...collection,
    requests: nextRootRequests,
    folders: nextFolders,
  }
}

function filterWorkspaceFolder(
  folder: WorkspaceFolder,
  visibleCollectionsById: Set<string>,
  searchTerm: string,
): WorkspaceFolder | null {
  const nameMatches = folder.name.toLowerCase().includes(searchTerm)
  const nextCollectionIds = folder.collectionIds.filter(id => visibleCollectionsById.has(id))
  const nextFolders = (folder.folders ?? [])
    .map(child => filterWorkspaceFolder(child, visibleCollectionsById, searchTerm))
    .filter((child): child is WorkspaceFolder => child !== null)

  if (!nameMatches && !nextCollectionIds.length && !nextFolders.length) return null
  return {
    ...folder,
    collectionIds: nextCollectionIds,
    folders: nextFolders.length ? nextFolders : undefined,
  }
}

export function getVisibleWorkspaceSearchTree(
  collections: Collection[],
  workspaceFolders: WorkspaceFolder[],
  searchTerm: string,
): { visibleCollections: Collection[], visibleWorkspaceFolders: WorkspaceFolder[] } {
  if (!searchTerm) return { visibleCollections: collections, visibleWorkspaceFolders: workspaceFolders }

  const visibleCollections = collections
    .map(collection => filterCollection(collection, searchTerm))
    .filter((collection): collection is Collection => collection !== null)

  const visibleCollectionIds = new Set(visibleCollections.map(collection => collection.id))
  const visibleWorkspaceFolders = workspaceFolders
    .map(folder => filterWorkspaceFolder(folder, visibleCollectionIds, searchTerm))
    .filter((folder): folder is WorkspaceFolder => folder !== null)

  return { visibleCollections, visibleWorkspaceFolders }
}

export function getSearchOpenWorkspaceFolders(
  visibleWorkspaceFolders: WorkspaceFolder[],
  searchTerm: string,
): Set<string> | null {
  if (!searchTerm) return null

  const openIds = new Set<string>()

  function visit(folder: WorkspaceFolder) {
    const childFolders = folder.folders ?? []
    const hasVisibleCollection = folder.collectionIds.length > 0
    let hasVisibleChildFolder = false
    for (const child of childFolders) {
      visit(child)
      hasVisibleChildFolder = true
    }

    if (hasVisibleCollection || hasVisibleChildFolder) openIds.add(folder.id)
  }

  for (const folder of visibleWorkspaceFolders) visit(folder)
  return openIds
}

export function getEffectiveWorkspaceSearchTreeOpenCommand(args: {
  searchTerm: string
  treeOpenCommand?: { action: 'expand' | 'collapse', nonce: number } | null
  visibleWorkspaceFolderCount: number
  visibleCollectionCount: number
}) {
  if (!args.searchTerm) return args.treeOpenCommand
  return {
    action: 'expand' as const,
    nonce: args.visibleWorkspaceFolderCount + args.visibleCollectionCount + args.searchTerm.length,
  }
}
