import type { Collection, RequestItem } from '../../modules/collectionTree'
import type { ModuleContext } from '../contracts/moduleContext'
import type { Environment } from '../../shared/types/environment'
import type { Workspace } from '../../shared/types/workspace'

export type SavedActiveSelection = { collectionId: string, requestId: string }

export type AppBootstrapState = {
  collections: Collection[]
  workspace: Workspace
  envByCollection: Record<string, Environment>
  active: { col: Collection, req: RequestItem } | null
}

export function findRequestByIds(collections: Collection[], collectionId: string, requestId: string) {
  const col = collections.find(c => c.id === collectionId)
  if (!col) return null
  const collection = col
  const direct = (collection.requests ?? []).find(r => r.id === requestId)
  if (direct) return { col: collection, req: direct }
  function walk(folders: any[]): { col: Collection, req: RequestItem } | null {
    for (const folder of folders) {
      const req = (folder?.requests ?? []).find((r: RequestItem) => r.id === requestId)
      if (req) return { col: collection, req }
      const nested = Array.isArray(folder?.folders) ? folder.folders : []
      const found = walk(nested)
      if (found) return found
    }
    return null
  }
  const found = walk(col.folders as any)
  if (found) return found
  return null
}

export function loadInitialAppBootstrap(context: ModuleContext, savedActiveSelection: SavedActiveSelection | null): AppBootstrapState {
  const collections = context.repositories.collections.load()
  const workspace = context.repositories.workspace.load()
  const envByCollection = context.repositories.environments.loadByCollection()
  const active = savedActiveSelection
    ? findRequestByIds(collections, savedActiveSelection.collectionId, savedActiveSelection.requestId)
    : null

  return {
    collections,
    workspace,
    envByCollection,
    active,
  }
}
