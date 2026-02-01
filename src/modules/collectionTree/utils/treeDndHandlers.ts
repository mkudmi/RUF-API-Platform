import type { DragEvent } from 'react'
import type { Collection } from '../types'
import { readDraggedCollection, readDraggedFolder, readDraggedRequest, readDraggedWorkspaceFolder, setDraggedCollection, setDraggedFolder, setDraggedRequest, setDraggedWorkspaceFolder } from './treeDragDrop'

export function onDragOverMove<T extends HTMLElement>(e: DragEvent<T>) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
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
  },
) {
  e.preventDefault()
  e.stopPropagation()

  const draggedFolder = readDraggedFolder(e.dataTransfer)
  if (draggedFolder) {
    if (draggedFolder.collectionId !== opts.collectionId) return
    if (opts.targetFolderId && draggedFolder.folderId === opts.targetFolderId) return
    opts.onMoveFolder(opts.collectionId, draggedFolder.folderId, opts.targetFolderId)
    return
  }

  const draggedReq = readDraggedRequest(e.dataTransfer)
  if (!draggedReq) return
  if (draggedReq.collectionId !== opts.collectionId) return
  opts.onMoveRequest(opts.collectionId, draggedReq.requestId, opts.targetFolderId)
}

export function handleWorkspaceDrop<T extends HTMLElement>(
  e: DragEvent<T>,
  opts: {
    targetWorkspaceFolderId: string | null
    onMoveWorkspaceFolder: (workspaceFolderId: string, targetParentWorkspaceFolderId: string | null) => void
    onMoveCollectionToWorkspaceFolder: (collectionId: string, workspaceFolderId: string | null) => void
  },
) {
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
