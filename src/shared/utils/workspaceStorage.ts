import type { Workspace, WorkspaceFolder } from '../types/workspace'

const WORKSPACE_KEY = 'ruf_workspace_v1'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (!raw) return { folders: [] }
    const parsed: unknown = JSON.parse(raw)
    const foldersValue = isRecord(parsed) ? parsed.folders : null
    const foldersRaw: unknown[] = Array.isArray(foldersValue) ? foldersValue : []

    const folders: WorkspaceFolder[] = []
    for (const f of foldersRaw) {
      if (!isRecord(f)) continue
      const id = typeof f.id === 'string' ? f.id : ''
      const name = typeof f.name === 'string' ? f.name : ''
      const collectionIdsRaw = Array.isArray(f.collectionIds) ? f.collectionIds : []
      const collectionIds = collectionIdsRaw.filter((x): x is string => typeof x === 'string' && !!x.trim())
      if (!id || !name) continue
      folders.push({ id, name, collectionIds })
    }
    return { folders }
  } catch {
    return { folders: [] }
  }
}

export function saveWorkspace(next: Workspace) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next))
}
