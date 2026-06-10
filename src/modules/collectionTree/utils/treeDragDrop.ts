const RUF_MIME_FOLDER = 'application/x-ruf-folder'
const RUF_MIME_REQUEST = 'application/x-ruf-request'
const RUF_MIME_COLLECTION = 'application/x-ruf-collection'
const RUF_MIME_WORKSPACE_FOLDER = 'application/x-ruf-workspace-folder'

const RUF_TEXT_PREFIX = 'ruf-dnd:'

type DraggedFolder = { collectionId: string, folderId: string }
type DraggedRequest = { collectionId: string, requestId: string }
type DraggedCollection = { collectionId: string }
type DraggedWorkspaceFolder = { workspaceFolderId: string }

type DraggedAny =
  | ({ kind: 'folder' } & DraggedFolder)
  | ({ kind: 'request' } & DraggedRequest)
  | ({ kind: 'collection' } & DraggedCollection)
  | ({ kind: 'workspace-folder' } & DraggedWorkspaceFolder)

function setFallbackText(dt: DataTransfer, payload: DraggedAny) {
  dt.setData('text/plain', `${RUF_TEXT_PREFIX}${JSON.stringify(payload)}`)
}

function readFallbackText(dt: DataTransfer): DraggedAny | null {
  try {
    const raw = dt.getData('text/plain')
    if (!raw?.startsWith(RUF_TEXT_PREFIX)) return null
    const parsed = JSON.parse(raw.slice(RUF_TEXT_PREFIX.length)) as any
    const kind = parsed?.kind
    if (kind !== 'folder' && kind !== 'request' && kind !== 'collection' && kind !== 'workspace-folder') return null
    return parsed as DraggedAny
  } catch (error) {
    logWarn('readFallbackText', 'Failed to parse fallback drag payload', { error })
    return null
  }
}

export function readDraggedKind(dt: DataTransfer): DraggedAny['kind'] | null {
  const folder = readDraggedFolder(dt)
  if (folder) return 'folder'
  const request = readDraggedRequest(dt)
  if (request) return 'request'
  const collection = readDraggedCollection(dt)
  if (collection) return 'collection'
  const workspaceFolder = readDraggedWorkspaceFolder(dt)
  if (workspaceFolder) return 'workspace-folder'
  return null
}

export function setDraggedFolder(dt: DataTransfer, payload: DraggedFolder) {
  dt.effectAllowed = 'move'
  const full: DraggedAny = { kind: 'folder', ...payload }
  dt.setData(RUF_MIME_FOLDER, JSON.stringify(full))
  setFallbackText(dt, full)
}

export function setDraggedRequest(dt: DataTransfer, payload: DraggedRequest) {
  dt.effectAllowed = 'move'
  const full: DraggedAny = { kind: 'request', ...payload }
  dt.setData(RUF_MIME_REQUEST, JSON.stringify(full))
  setFallbackText(dt, full)
}

export function setDraggedCollection(dt: DataTransfer, payload: DraggedCollection) {
  dt.effectAllowed = 'move'
  const full: DraggedAny = { kind: 'collection', ...payload }
  dt.setData(RUF_MIME_COLLECTION, JSON.stringify(full))
  setFallbackText(dt, full)
}

export function readDraggedFolder(dt: DataTransfer): DraggedFolder | null {
  try {
    const raw = dt.getData(RUF_MIME_FOLDER)
    if (!raw) {
      const fb = readFallbackText(dt)
      if (fb?.kind !== 'folder') return null
      const collectionId = typeof fb?.collectionId === 'string' ? fb.collectionId : ''
      const folderId = typeof fb?.folderId === 'string' ? fb.folderId : ''
      if (!collectionId || !folderId) return null
      return { collectionId, folderId }
    }
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    const folderId = typeof parsed?.folderId === 'string' ? parsed.folderId : ''
    if (!collectionId || !folderId) return null
    return { collectionId, folderId }
  } catch (error) {
    logWarn('readDraggedFolder', 'Failed to parse dragged folder payload', { error })
    return null
  }
}

export function readDraggedRequest(dt: DataTransfer): DraggedRequest | null {
  try {
    const raw = dt.getData(RUF_MIME_REQUEST)
    if (!raw) {
      const fb = readFallbackText(dt)
      if (fb?.kind !== 'request') return null
      const collectionId = typeof fb?.collectionId === 'string' ? fb.collectionId : ''
      const requestId = typeof fb?.requestId === 'string' ? fb.requestId : ''
      if (!collectionId || !requestId) return null
      return { collectionId, requestId }
    }
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : ''
    if (!collectionId || !requestId) return null
    return { collectionId, requestId }
  } catch (error) {
    logWarn('readDraggedRequest', 'Failed to parse dragged request payload', { error })
    return null
  }
}

export function readDraggedCollection(dt: DataTransfer): DraggedCollection | null {
  try {
    const raw = dt.getData(RUF_MIME_COLLECTION)
    if (!raw) {
      const fb = readFallbackText(dt)
      if (fb?.kind !== 'collection') return null
      const collectionId = typeof fb?.collectionId === 'string' ? fb.collectionId : ''
      if (!collectionId) return null
      return { collectionId }
    }
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    if (!collectionId) return null
    return { collectionId }
  } catch (error) {
    logWarn('readDraggedCollection', 'Failed to parse dragged collection payload', { error })
    return null
  }
}

export function setDraggedWorkspaceFolder(dt: DataTransfer, payload: DraggedWorkspaceFolder) {
  dt.effectAllowed = 'move'
  const full: DraggedAny = { kind: 'workspace-folder', ...payload }
  dt.setData(RUF_MIME_WORKSPACE_FOLDER, JSON.stringify(full))
  setFallbackText(dt, full)
}

export function readDraggedWorkspaceFolder(dt: DataTransfer): DraggedWorkspaceFolder | null {
  try {
    const raw = dt.getData(RUF_MIME_WORKSPACE_FOLDER)
    if (!raw) {
      const fb = readFallbackText(dt)
      if (fb?.kind !== 'workspace-folder') return null
      const workspaceFolderId = typeof fb?.workspaceFolderId === 'string' ? fb.workspaceFolderId : ''
      if (!workspaceFolderId) return null
      return { workspaceFolderId }
    }
    const parsed = JSON.parse(raw) as any
    const workspaceFolderId = typeof parsed?.workspaceFolderId === 'string' ? parsed.workspaceFolderId : ''
    if (!workspaceFolderId) return null
    return { workspaceFolderId }
  } catch (error) {
    logWarn('readDraggedWorkspaceFolder', 'Failed to parse dragged workspace folder payload', { error })
    return null
  }
}
import { logWarn } from '../../../shared/utils/logger'
