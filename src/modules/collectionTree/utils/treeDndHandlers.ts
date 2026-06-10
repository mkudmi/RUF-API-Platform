import type { DragEvent } from 'react'
import type { Collection, TreeDropPosition } from '../types'
import { readDraggedCollection, readDraggedFolder, readDraggedKind, readDraggedRequest, readDraggedWorkspaceFolder, setDraggedCollection, setDraggedFolder, setDraggedRequest, setDraggedWorkspaceFolder } from './treeDragDrop'

function isFileDrag(dt: DataTransfer | null) {
  if (!dt) return false
  return Array.from(dt.types).includes('Files')
}

export function onDragOverMove<T extends HTMLElement>(e: DragEvent<T>) {
  e.preventDefault()
  e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer) ? 'copy' : 'move'
}

export function getDragKind<T extends HTMLElement>(e: DragEvent<T>) {
  if (isFileDrag(e.dataTransfer)) return null
  return readDraggedKind(e.dataTransfer)
}

export function getDropPosition<T extends HTMLElement>(e: DragEvent<T>, opts?: { allowInside?: boolean }): TreeDropPosition {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - rect.top
  const allowInside = opts?.allowInside ?? true
  if (!allowInside) return y < rect.height / 2 ? 'before' : 'after'
  const edge = Math.min(12, rect.height * 0.25)
  if (y <= edge) return 'before'
  if (y >= rect.height - edge) return 'after'
  return 'inside'
}

export function onCollectionDragStart<T extends HTMLElement>(e: DragEvent<T>, collectionId: string) {
  setDraggedCollection(e.dataTransfer, { collectionId })
}

export function onFolderDragStart<T extends HTMLElement>(e: DragEvent<T>, collectionId: string, folderId: string) {
  setDraggedFolder(e.dataTransfer, { collectionId, folderId })
}

export function onRequestDragStart<T extends HTMLElement>(e: DragEvent<T>, collectionId: string, requestId: string) {
  setDraggedRequest(e.dataTransfer, { collectionId, requestId })
}

export function onWorkspaceFolderDragStart<T extends HTMLElement>(e: DragEvent<T>, workspaceFolderId: string) {
  setDraggedWorkspaceFolder(e.dataTransfer, { workspaceFolderId })
}

export function handleCollectionTreeDrop<T extends HTMLElement>(
  e: DragEvent<T>,
  opts: {
    collectionId: string
    targetFolderId: string | null
    onMoveFolder: (collectionId: string, folderId: string, targetParentFolderId: string | null) => void
    onMoveRequest: (collectionId: string, requestId: string, targetFolderId: string | null) => void
    onMoveFolderToCollection?: (sourceCollectionId: string, folderId: string, targetCollectionId: string, targetParentFolderId: string | null) => void
    onMoveRequestToCollection?: (sourceCollectionId: string, requestId: string, targetCollectionId: string, targetFolderId: string | null) => void
  },
) {
  if (isFileDrag(e.dataTransfer)) return

  e.preventDefault()
  e.stopPropagation()

  const draggedFolder = readDraggedFolder(e.dataTransfer)
  if (draggedFolder) {
    if (draggedFolder.collectionId === opts.collectionId && opts.targetFolderId && draggedFolder.folderId === opts.targetFolderId) return
    if (draggedFolder.collectionId === opts.collectionId) {
      opts.onMoveFolder(opts.collectionId, draggedFolder.folderId, opts.targetFolderId)
      return
    }
    opts.onMoveFolderToCollection?.(draggedFolder.collectionId, draggedFolder.folderId, opts.collectionId, opts.targetFolderId)
    return
  }

  const draggedReq = readDraggedRequest(e.dataTransfer)
  if (!draggedReq) return
  if (draggedReq.collectionId === opts.collectionId) {
    opts.onMoveRequest(opts.collectionId, draggedReq.requestId, opts.targetFolderId)
    return
  }
  opts.onMoveRequestToCollection?.(draggedReq.collectionId, draggedReq.requestId, opts.collectionId, opts.targetFolderId)
}

export function handleWorkspaceDrop<T extends HTMLElement>(
  e: DragEvent<T>,
  opts: {
    targetWorkspaceFolderId: string | null
    onMoveWorkspaceFolder: (workspaceFolderId: string, targetParentWorkspaceFolderId: string | null) => void
    onMoveCollectionToWorkspaceFolder: (collectionId: string, workspaceFolderId: string | null) => void
  },
) {
  if (isFileDrag(e.dataTransfer)) return

  e.preventDefault()
  e.stopPropagation()

  const draggedWorkspaceFolder = readDraggedWorkspaceFolder(e.dataTransfer)
  if (draggedWorkspaceFolder) {
    if (opts.targetWorkspaceFolderId && draggedWorkspaceFolder.workspaceFolderId === opts.targetWorkspaceFolderId) return
    opts.onMoveWorkspaceFolder(draggedWorkspaceFolder.workspaceFolderId, opts.targetWorkspaceFolderId)
    return
  }

  const draggedCollection = readDraggedCollection(e.dataTransfer)
  if (!draggedCollection) return
  opts.onMoveCollectionToWorkspaceFolder(draggedCollection.collectionId, opts.targetWorkspaceFolderId)
}

export function asCollectionDropArgs(col: Collection, targetFolderId: string | null) {
  return { collectionId: col.id, targetFolderId }
}
