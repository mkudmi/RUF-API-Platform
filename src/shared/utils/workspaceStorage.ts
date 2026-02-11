import type { Workspace, WorkspaceFolder } from '../types/workspace'
import { logError } from './logger'

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

    function parseFolder(v: unknown): WorkspaceFolder | null {
      if (!isRecord(v)) return null
      const id = typeof v.id === 'string' ? v.id : ''
      const name = typeof v.name === 'string' ? v.name : ''
      const collectionIdsRaw = Array.isArray(v.collectionIds) ? v.collectionIds : []
      const collectionIds = collectionIdsRaw.filter((x): x is string => typeof x === 'string' && !!x.trim())
      if (!id || !name) return null

      const foldersRaw = Array.isArray(v.folders) ? v.folders : []
      const folders: WorkspaceFolder[] = []
      for (const child of foldersRaw) {
        const parsed = parseFolder(child)
        if (parsed) folders.push(parsed)
      }

      return folders.length ? { id, name, collectionIds, folders } : { id, name, collectionIds }
    }

    const folders: WorkspaceFolder[] = []
    for (const f of foldersRaw) {
      const parsed = parseFolder(f)
      if (parsed) folders.push(parsed)
    }

    return { folders }
  } catch (error) {
    logError('loadWorkspace', error)
    return { folders: [] }
  }
}

export function saveWorkspace(next: Workspace) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next))
}
