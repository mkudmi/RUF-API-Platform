import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type {
  Collection,
  CollectionTreeDropTarget,
  Folder,
  RequestItem,
  TreeSortMode,
  TreeDropPosition,
  WorkspaceCollectionDropTarget,
} from '../types'
import type { Environment } from '../../../shared/types/environment'
import { copyText } from '../../../shared/utils/clipboard'
import { getDragKind, getDropPosition, onCollectionDragStart as setCollectionDragData, onDragOverMove, onFolderDragStart as setFolderDragData, onRequestDragStart as setRequestDragData } from '../utils/treeDndHandlers'
import { buildPostmanCollectionFromRufCollection } from '../../export/rufCollection/rufCollectionExporter'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'
import { loadLocalStorageJson, saveLocalStorageJson } from '../../../shared/utils/localStorageJson'
import { logWarn } from '../../../shared/utils/logger'
import { readDraggedCollection, readDraggedFolder, readDraggedRequest } from '../utils/treeDragDrop'

const TREE_OPEN_STATE_KEY = 'ruf_tree_open_state_v1'

type FileSystemFileHandleLike = {
  createWritable: () => Promise<{
    write: (data: string | Blob | BufferSource) => Promise<void>
    close: () => Promise<void>
  }>
}

type TreeOpenState = {
  collections: string[]
  folders: string[]
}

function loadTreeOpenState(): TreeOpenState {
  const parsed = loadLocalStorageJson<unknown>(TREE_OPEN_STATE_KEY, { collections: [], folders: [] })
  const record = (parsed && typeof parsed === 'object') ? (parsed as any) : {}
  const collections = Array.isArray(record.collections) ? record.collections.filter((x: unknown): x is string => typeof x === 'string') : []
  const folders = Array.isArray(record.folders) ? record.folders.filter((x: unknown): x is string => typeof x === 'string') : []
  return { collections, folders }
}

function saveTreeOpenState(state: TreeOpenState) {
  saveLocalStorageJson(TREE_OPEN_STATE_KEY, state)
}

function sanitizeFileNameBase(rawName: string) {
  const trimmed = rawName.trim()
  const replaced = trimmed.replaceAll(/[\\/:*?"<>|]/g, '_')
  const cleaned = replaced.replaceAll(/\s+/g, ' ').replaceAll(/[. ]+$/g, '')
  return cleaned || 'collection'
}

const DEFAULT_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function normalizeRufCollectionFileName(rawName: string) {
  const base = sanitizeFileNameBase(rawName)
  const lower = base.toLowerCase()
  if (lower.endsWith('.rufcollection')) return base
  if (lower.endsWith('.ruf_collection')) return `${base.slice(0, -'.ruf_collection'.length)}.rufcollection`
  return `${base}.rufcollection`
}

function getRequestHoverTitle(r: RequestItem) {
  const method = String(r.method || '').trim().toUpperCase()
  const endpoint = String(r.path || r.urlTemplate || '').trim()
  if (method && endpoint) return `${method} ${endpoint}`
  if (endpoint) return endpoint
  if (method) return method
  return r.name
}

async function saveTextWithSuggestedName(args: { suggestedName: string, text: string }) {
  try {
    const w = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike> }
    if (typeof w.showSaveFilePicker === 'function') {
        const handle = await w.showSaveFilePicker({
          suggestedName: args.suggestedName,
          types: [
            {
              description: 'JSON Source file',
              accept: { 'application/json': ['.rufcollection'] },
            },
          ],
        })
      const writable = await handle.createWritable()
      await writable.write(args.text)
      await writable.close()
      return
    }

    const blob = new Blob([args.text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = args.suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    logWarn('saveTextWithSuggestedName', 'Save dialog aborted or failed', { error: e })
    if ((e as Error | null)?.name !== 'AbortError') throw e
  }
}

export function CollectionsTree(props: {
  collections: Collection[]
  scopeId?: string
  workspaceFolderId?: string | null
  draggingItem?: {
    kind: 'collection' | 'folder' | 'request' | 'workspace-folder'
    collectionId?: string
    folderId?: string
    requestId?: string
    workspaceFolderId?: string
  } | null
  onDraggingItemChange?: (item: {
    kind: 'collection' | 'folder' | 'request' | 'workspace-folder'
    collectionId?: string
    folderId?: string
    requestId?: string
    workspaceFolderId?: string
  } | null) => void
  sortMode?: TreeSortMode
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  inFlightCountByRequestId?: Record<string, number>
  sharedOpenMenu?: { scopeId: string, kind: 'collection' | 'folder' | 'request', id: string } | null
  onSharedOpenMenuChange?: (menu: { scopeId: string, kind: 'collection' | 'folder' | 'request', id: string } | null) => void
  treeOpenCommand?: { action: 'expand' | 'collapse', nonce: number } | null
  onOpenStateSummaryChange?: (summary: {
    totalCollections: number
    openCollections: number
    totalFolders: number
    openFolders: number
  }) => void
  onPickRequest: (req: RequestItem, col: Collection) => void
  onOpenEnv: (collectionId: string) => void
  onRunCollection?: (collectionId: string) => void
  onRunFolder?: (collectionId: string, folderId: string) => void
  onUpdateCollectionFromUrl?: (collectionId: string) => void
  onOpenCollectionSwagger?: (collectionId: string) => void
  onReloadCollectionFromFile?: (collectionId: string) => void
  onAddRequest: (collectionId: string) => void
  onAddFolder: (collectionId: string) => void
  onAddRequestToFolder: (collectionId: string, folderId: string) => void
  onAddFolderToFolder: (collectionId: string, folderId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onDuplicateCollection: (collectionId: string) => void
  onDuplicateFolder: (collectionId: string, folderId: string) => void
  onDuplicateRequest: (collectionId: string, requestId: string) => void
  onDropCollectionAtTarget?: (collectionId: string, target: WorkspaceCollectionDropTarget) => void
  onDropFolderAtTarget: (collectionId: string, folderId: string, target: CollectionTreeDropTarget) => void
  onDropRequestAtTarget: (collectionId: string, requestId: string, target: CollectionTreeDropTarget) => void
  onMoveFolder: (collectionId: string, folderId: string, targetParentFolderId: string | null) => void
  onMoveRequest: (collectionId: string, requestId: string, targetFolderId: string | null) => void
  onMoveFolderToCollection?: (sourceCollectionId: string, folderId: string, targetCollectionId: string, targetParentFolderId: string | null) => void
  onMoveRequestToCollection?: (sourceCollectionId: string, requestId: string, targetCollectionId: string, targetFolderId: string | null) => void
  onDeleteFolder: (collectionId: string, folderId: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onDeleteCollection: (collectionId: string) => void
}) {
  type EditingTarget = { kind: 'collection' | 'folder' | 'request', id: string } | null
  type OpenMenuTarget = { kind: 'collection' | 'folder' | 'request', id: string } | null
  type RowDropTarget = { kind: 'collection' | 'folder' | 'request', id: string, position: TreeDropPosition } | null
  type InvalidDropTarget = { kind: 'collection' | 'folder' | 'request', id: string } | null
  const scopeId = props.scopeId ?? 'root'

  const sortMode = props.sortMode ?? 'none'
  const sortedCollections = useMemo(() => {
    if (sortMode === 'none') return props.collections

    const dir = sortMode === 'asc' ? 1 : -1
    const compareName = (aName: string, bName: string) => dir * aName.localeCompare(bName, undefined, { sensitivity: 'base' })

    const sortRequests = (reqs: RequestItem[] | undefined) => {
      if (!reqs?.length) return reqs ?? []
      return [...reqs].sort((a, b) => compareName(a.name, b.name))
    }

    const sortFoldersDeep = (folders: Folder[] | undefined): Folder[] => {
      if (!folders?.length) return []
      const next = [...folders].sort((a, b) => compareName(a.name, b.name))
      return next.map(f => ({
        ...f,
        requests: sortRequests(f.requests),
        folders: f.folders?.length ? sortFoldersDeep(f.folders) : f.folders,
      }))
    }

    return props.collections.map(col => ({
      ...col,
      requests: sortRequests(col.requests),
      folders: sortFoldersDeep(col.folders),
    }))
  }, [props.collections, sortMode])

  const treeNodeIds = useMemo(() => {
    const collectionIds = sortedCollections.map(c => c.id)
    const folderIds: string[] = []

    function visit(folder: Folder) {
      folderIds.push(folder.id)
      for (const child of folder.folders ?? []) visit(child)
    }

    for (const col of sortedCollections) {
      for (const folder of col.folders ?? []) visit(folder)
    }

    return { collectionIds, folderIds }
  }, [sortedCollections])

  const [editing, setEditing] = useState<EditingTarget>(null)
  const [draftName, setDraftName] = useState('')
  const [dropTarget, setDropTarget] = useState<RowDropTarget>(null)
  const [invalidDropTarget, setInvalidDropTarget] = useState<InvalidDropTarget>(null)
  const nameEditableRef = useRef<HTMLElement | null>(null)
  const suppressNextBlurRef = useRef(false)
  const [localOpenMenu, setLocalOpenMenu] = useState<OpenMenuTarget>(null)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const [openCollections, setOpenCollections] = useState<Set<string>>(() => new Set(loadTreeOpenState().collections))
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(loadTreeOpenState().folders))
  const lastAppliedTreeCommandNonceRef = useRef<number | null>(null)
  const [, setDraggingFolder] = useState<{ collectionId: string, folderId: string } | null>(null)
  const [, setDraggingRequest] = useState<{ collectionId: string, requestId: string } | null>(null)
  const draggingItem = props.draggingItem ?? null
  const openMenu = props.sharedOpenMenu?.scopeId === scopeId
    ? { kind: props.sharedOpenMenu.kind, id: props.sharedOpenMenu.id }
    : (props.onSharedOpenMenuChange ? null : localOpenMenu)
  const setOpenMenu = (menu: OpenMenuTarget) => {
    if (props.onSharedOpenMenuChange) {
      props.onSharedOpenMenuChange(menu ? { scopeId, kind: menu.kind, id: menu.id } : null)
      return
    }
    setLocalOpenMenu(menu)
  }

  useEffect(() => {
    function clearDropTarget() {
      setDropTarget(null)
      setInvalidDropTarget(null)
    }

    window.addEventListener('dragend', clearDropTarget)
    window.addEventListener('drop', clearDropTarget)
    return () => {
      window.removeEventListener('dragend', clearDropTarget)
      window.removeEventListener('drop', clearDropTarget)
    }
  }, [])

  useLayoutEffect(() => {
    const cmd = props.treeOpenCommand
    if (!cmd) return
    if (lastAppliedTreeCommandNonceRef.current === cmd.nonce) return
    lastAppliedTreeCommandNonceRef.current = cmd.nonce

    setOpenMenu(null)
    setEditing(null)
    setDraftName('')

    if (cmd.action === 'collapse') {
      setOpenCollections(new Set())
      setOpenFolders(new Set())
      return
    }

    setOpenCollections(new Set(treeNodeIds.collectionIds))
    setOpenFolders(new Set(treeNodeIds.folderIds))
  }, [props.treeOpenCommand, treeNodeIds])

  async function exportCollection(col: Collection) {
    const env = props.environmentsByCollection[col.id]
    const postman = buildPostmanCollectionFromRufCollection({ collection: col, environment: env })
    const text = JSON.stringify(postman, null, 2)
    const fileName = normalizeRufCollectionFileName(col.name || 'collection')
    await saveTextWithSuggestedName({ suggestedName: fileName, text })
  }

  function applyMenuPosition(panel: HTMLDivElement | null) {
    if (!panel) return
    requestAnimationFrame(() => {
      const wrap = panel.parentElement
      const btn = wrap?.querySelector('button.treeMenuBtn') as HTMLButtonElement | null
      if (!btn) return

      panel.style.visibility = 'hidden'
      panel.style.position = 'fixed'
      panel.style.zIndex = '3000'
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      panel.style.left = '0px'
      panel.style.top = '0px'

      const margin = 8
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const btnRect = btn.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()

      let left = btnRect.right - panelRect.width
      if (left < margin) left = btnRect.left
      left = Math.min(Math.max(margin, left), vw - margin - panelRect.width)

      let top = btnRect.bottom + 4
      if (top + panelRect.height > vh - margin) {
        const topUp = btnRect.top - 4 - panelRect.height
        if (topUp >= margin) top = topUp
        else top = Math.min(Math.max(margin, top), vh - margin - panelRect.height)
      }

      panel.style.left = `${Math.round(left)}px`
      panel.style.top = `${Math.round(top)}px`
      panel.style.visibility = 'visible'
    })
  }

  function countRequests(folder: Folder): number {
    const nested = (folder.folders ?? []).reduce((n, f) => n + countRequests(f), 0)
    return folder.requests.length + nested
  }

  function countFolderItems(folder: Folder): number {
    const folderCount = Array.isArray(folder.folders) ? folder.folders.length : 0
    const requestCount = Array.isArray(folder.requests) ? folder.requests.length : 0
    return folderCount + requestCount
  }

  const requestCountByCollection: Record<string, number> = {}
  for (const col of props.collections) {
    requestCountByCollection[col.id] = (col.requests ?? []).length + col.folders.reduce((n, f) => n + countRequests(f), 0)
  }

  function containsFolderId(folder: Folder, targetId: string): boolean {
    if (folder.id === targetId) return true
    return (folder.folders ?? []).some(child => containsFolderId(child, targetId))
  }

  function findFolderInCollections(folderId: string): { collectionId: string, folder: Folder } | null {
    function findInFolders(folders: Folder[], collectionId: string): { collectionId: string, folder: Folder } | null {
      for (const folder of folders) {
        if (folder.id === folderId) return { collectionId, folder }
        const nested = findInFolders(folder.folders ?? [], collectionId)
        if (nested) return nested
      }
      return null
    }

    for (const collection of props.collections) {
      const found = findInFolders(collection.folders, collection.id)
      if (found) return found
    }
    return null
  }

  function clearDropFeedback() {
    setDropTarget(null)
    setInvalidDropTarget(null)
  }

  function markInvalidDrop(kind: NonNullable<InvalidDropTarget>['kind'], id: string) {
    setDropTarget(null)
    setInvalidDropTarget({ kind, id })
  }

  useEffect(() => {
    saveTreeOpenState({ collections: Array.from(openCollections), folders: Array.from(openFolders) })
  }, [openCollections, openFolders])

  useEffect(() => {
    if (!props.onOpenStateSummaryChange) return
    const totalCollections = treeNodeIds.collectionIds.length
    const totalFolders = treeNodeIds.folderIds.length
    const openCollectionsCount = treeNodeIds.collectionIds.reduce((n, id) => n + (openCollections.has(id) ? 1 : 0), 0)
    const openFoldersCount = treeNodeIds.folderIds.reduce((n, id) => n + (openFolders.has(id) ? 1 : 0), 0)
    props.onOpenStateSummaryChange({
      totalCollections,
      openCollections: openCollectionsCount,
      totalFolders,
      openFolders: openFoldersCount,
    })
  }, [openCollections, openFolders, props.onOpenStateSummaryChange, treeNodeIds])

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => {
      const el = nameEditableRef.current
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editing])

  useDismissibleLayer({
    open: !!openMenu,
    onDismiss: () => setOpenMenu(null),
    isInsideTarget: target => {
      const wrap = menuWrapRef.current
      return !!(target && wrap && wrap.contains(target))
    },
  })

  useEffect(() => {
    if (!openMenu) return

    const anchor = menuWrapRef.current
    const scroller = (anchor?.closest?.('.workspaceTreeScroll, .sidebarTreeWrap') as HTMLElement | null) ?? null
    if (!scroller) return

    function onScroll() {
      setOpenMenu(null)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [openMenu])

  function displayMethod(m: string) {
    const normalized = (m ?? '').toUpperCase()
    if (normalized === 'DELETE') return 'DEL'
    if (normalized === 'PATCH') return 'PAT'
    if (normalized === 'OPTIONS') return 'OPT'
    if (!DEFAULT_HTTP_METHODS.has(normalized)) return normalized.slice(0, 3)
    return normalized
  }

  function inFlightMethodClass(requestId: string, method: string): string {
    const inFlight = (props.inFlightCountByRequestId?.[requestId] ?? 0) > 0
    if (!inFlight) return ''
    const normalized = (method ?? '').toUpperCase()
    if (!DEFAULT_HTTP_METHODS.has(normalized)) return 'treeMethodInFlight treeMethodInFlightCustom'
    return `treeMethodInFlight treeMethodInFlight${normalized}`
  }

  function onFolderDragStart(e: DragEvent<HTMLElement>, collectionId: string, folderId: string) {
    setDraggingFolder({ collectionId, folderId })
    props.onDraggingItemChange?.({ kind: 'folder', collectionId, folderId })
    setFolderDragData(e, collectionId, folderId)
  }

  function onFolderDragEnd() {
    setDraggingFolder(null)
    props.onDraggingItemChange?.(null)
  }

  function onRequestDragStart(e: DragEvent<HTMLElement>, collectionId: string, requestId: string) {
    setDraggingRequest({ collectionId, requestId })
    props.onDraggingItemChange?.({ kind: 'request', collectionId, requestId })
    setRequestDragData(e, collectionId, requestId)
  }

  function onRequestDragEnd() {
    setDraggingRequest(null)
    props.onDraggingItemChange?.(null)
  }

  function onCollectionRowDragOver(e: DragEvent<HTMLElement>, collectionId: string) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind) return
    if (dragKind === 'workspace-folder') {
      clearDropFeedback()
      return
    }
    if (dragKind !== 'collection') {
      onDragOverMove(e)
      setInvalidDropTarget(null)
      setDropTarget({ kind: 'collection', id: collectionId, position: 'inside' })
      return
    }
    const draggedCollectionId = draggingItem?.kind === 'collection' ? draggingItem.collectionId : readDraggedCollection(e.dataTransfer)?.collectionId
    if (!draggedCollectionId) return
    if (draggedCollectionId === collectionId) {
      markInvalidDrop('collection', collectionId)
      return
    }
    onDragOverMove(e)
    setInvalidDropTarget(null)
    setDropTarget({ kind: 'collection', id: collectionId, position: getDropPosition(e, { allowInside: false }) })
  }

  function onFolderRowDragOver(e: DragEvent<HTMLElement>, col: Collection, folder: Folder) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind) return
    if (dragKind === 'collection' || dragKind === 'workspace-folder') {
      clearDropFeedback()
      return
    }
    if (dragKind === 'request') {
      onDragOverMove(e)
      setInvalidDropTarget(null)
      setDropTarget({ kind: 'folder', id: folder.id, position: 'inside' })
      return
    }
    const dragged = draggingItem?.kind === 'folder'
      ? { collectionId: draggingItem.collectionId ?? '', folderId: draggingItem.folderId ?? '' }
      : readDraggedFolder(e.dataTransfer)
    if (!dragged?.collectionId || !dragged.folderId) return
    const draggedFolder = findFolderInCollections(dragged.folderId)
    if (
      dragged.folderId === folder.id
      || (dragged.collectionId === col.id && draggedFolder?.folder && containsFolderId(draggedFolder.folder, folder.id))
    ) {
      markInvalidDrop('folder', folder.id)
      return
    }
    onDragOverMove(e)
    setInvalidDropTarget(null)
    setDropTarget({ kind: 'folder', id: folder.id, position: getDropPosition(e, { allowInside: true }) })
  }

  function onRequestRowDragOver(e: DragEvent<HTMLElement>, requestId: string) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind || dragKind !== 'request') {
      clearDropFeedback()
      return
    }
    const draggedRequestId = draggingItem?.kind === 'request' ? draggingItem.requestId : readDraggedRequest(e.dataTransfer)?.requestId
    if (!draggedRequestId) return
    if (draggedRequestId === requestId) {
      markInvalidDrop('request', requestId)
      return
    }
    onDragOverMove(e)
    setInvalidDropTarget(null)
    setDropTarget({ kind: 'request', id: requestId, position: getDropPosition(e, { allowInside: false }) })
  }

  function onCollectionRowDrop(e: DragEvent<HTMLElement>, collectionId: string) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind) return
    e.preventDefault()
    e.stopPropagation()
    const position = dragKind === 'collection' ? getDropPosition(e, { allowInside: false }) : 'inside'
    clearDropFeedback()

    if (dragKind === 'collection') {
      props.onDropCollectionAtTarget?.(collectionId, {
        workspaceFolderId: props.workspaceFolderId ?? null,
        targetCollectionId: collectionId,
        position: position === 'before' ? 'before' : 'after',
      })
      return
    }
    if (dragKind === 'folder') {
      const dragged = draggingItem?.kind === 'folder'
        ? { collectionId: draggingItem.collectionId ?? '', folderId: draggingItem.folderId ?? '' }
        : readDraggedFolder(e.dataTransfer)
      if (!dragged) return
      props.onDropFolderAtTarget(dragged.collectionId, dragged.folderId, {
        collectionId,
        targetType: 'root',
        targetId: null,
        parentFolderId: null,
        position: 'inside',
      })
      return
    }
    if (dragKind === 'request') {
      const dragged = draggingItem?.kind === 'request'
        ? { collectionId: draggingItem.collectionId ?? '', requestId: draggingItem.requestId ?? '' }
        : readDraggedRequest(e.dataTransfer)
      if (!dragged) return
      props.onDropRequestAtTarget(dragged.collectionId, dragged.requestId, {
        collectionId,
        targetType: 'root',
        targetId: null,
        parentFolderId: null,
        position: 'inside',
      })
    }
  }

  function onFolderRowDrop(e: DragEvent<HTMLElement>, col: Collection, folder: Folder) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind) return
    e.preventDefault()
    e.stopPropagation()
    const position = dragKind === 'request' ? 'inside' : getDropPosition(e, { allowInside: true })
    clearDropFeedback()

    const target: CollectionTreeDropTarget = {
      collectionId: col.id,
      targetType: 'folder',
      targetId: folder.id,
      parentFolderId: null,
      position,
    }

    if (dragKind === 'folder') {
      const dragged = draggingItem?.kind === 'folder'
        ? { collectionId: draggingItem.collectionId ?? '', folderId: draggingItem.folderId ?? '' }
        : readDraggedFolder(e.dataTransfer)
      if (!dragged) return
      props.onDropFolderAtTarget(dragged.collectionId, dragged.folderId, target)
      return
    }
    if (dragKind === 'request') {
      const dragged = draggingItem?.kind === 'request'
        ? { collectionId: draggingItem.collectionId ?? '', requestId: draggingItem.requestId ?? '' }
        : readDraggedRequest(e.dataTransfer)
      if (!dragged) return
      props.onDropRequestAtTarget(dragged.collectionId, dragged.requestId, target)
    }
  }

  function onRequestRowDrop(e: DragEvent<HTMLElement>, col: Collection, requestId: string, parentFolderId: string | null) {
    const dragKind = draggingItem?.kind ?? getDragKind(e)
    if (!dragKind || dragKind !== 'request') return
    e.preventDefault()
    e.stopPropagation()
    const position = getDropPosition(e, { allowInside: false })
    clearDropFeedback()
    const dragged = draggingItem?.kind === 'request'
      ? { collectionId: draggingItem.collectionId ?? '', requestId: draggingItem.requestId ?? '' }
      : readDraggedRequest(e.dataTransfer)
    if (!dragged) return
    props.onDropRequestAtTarget(dragged.collectionId, dragged.requestId, {
      collectionId: col.id,
      targetType: 'request',
      targetId: requestId,
      parentFolderId,
      position: position === 'before' ? 'before' : 'after',
    })
  }

  function renderFolder(col: Collection, folder: Folder) {
    const childFolders = folder.folders ?? []
    const reqCount = countFolderItems(folder)
    const isEditing = editing?.kind === 'folder' && editing.id === folder.id
    const isFolderMenuOpen = openMenu?.kind === 'folder' && openMenu.id === folder.id && !isEditing
    const folderDropPosition = dropTarget?.kind === 'folder' && dropTarget.id === folder.id ? dropTarget.position : null
    const isFolderDropInvalid = invalidDropTarget?.kind === 'folder' && invalidDropTarget.id === folder.id

    function startRename() {
      suppressNextBlurRef.current = false
      setOpenMenu(null)
      setEditing({ kind: 'folder', id: folder.id })
      setDraftName(folder.name)
    }

    function cancelRename() {
      setEditing(null)
      setDraftName('')
    }

    function submitRename() {
      const next = (nameEditableRef.current?.innerText ?? draftName).trim()
      cancelRename()
      if (!next || next === folder.name) return
      props.onRenameFolder(col.id, folder.id, next)
    }

    return (
      <details
        key={folder.id}
        className="treeGroup treeGroupInner"
        open={openFolders.has(folder.id)}
        onToggle={e => {
          const isOpen = (e.currentTarget as HTMLDetailsElement).open
          setOpenFolders(prev => {
            const next = new Set(prev)
            if (isOpen) next.add(folder.id)
            else next.delete(folder.id)
            return next
          })
        }}
      >
        <summary
          className="treeSummary treeSummaryFolder"
          onPointerDown={e => {
            if (!isEditing) return
            const target = e.target as HTMLElement | null
            const nameEl = nameEditableRef.current
            const clickedConfirm = !!target?.closest?.('.treeRenameIconConfirm')
            const clickedName = !!(nameEl && target && nameEl.contains(target))
            if (clickedConfirm || clickedName) return
            e.preventDefault()
            e.stopPropagation()
            suppressNextBlurRef.current = true
            cancelRename()
          }}
        >
          <div
            className={`treeSummaryDnd${folderDropPosition ? ` treeDropTarget treeDropTarget${folderDropPosition[0].toUpperCase()}${folderDropPosition.slice(1)}` : ''}${isFolderDropInvalid ? ' treeDropInvalid' : ''}`}
            draggable={!isEditing}
            onDragStart={e => {
              if (isEditing) return
              onFolderDragStart(e, col.id, folder.id)
            }}
            onDragEnd={() => {
              if (isEditing) return
              onFolderDragEnd()
            }}
            onDragOver={e => {
              onFolderRowDragOver(e, col, folder)
            }}
            onDrop={e => {
              onFolderRowDrop(e, col, folder)
            }}
          >
          <span className="treeChevron" aria-hidden="true" />
          <div className="treeSummaryLeft">
            {isEditing ? (
              <span className="treeFolderNameWrap">
                <span
                  ref={nameEditableRef as any}
                  className="treeFolderName treeNameEditing"
                  contentEditable
                  spellCheck={false}
                  suppressContentEditableWarning
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      suppressNextBlurRef.current = true
                      submitRename()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      suppressNextBlurRef.current = true
                      cancelRename()
                    }
                  }}
                  onBlur={() => {
                    if (suppressNextBlurRef.current) {
                      suppressNextBlurRef.current = false
                      return
                    }
                    cancelRename()
                  }}
                  role="textbox"
                  aria-label="Folder name"
                >
                  {draftName}
                </span>
                <span className="small treeFolderCount">{reqCount}</span>
                <button
                  className="treeRenameIcon treeRenameIconConfirm"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    suppressNextBlurRef.current = true
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    submitRename()
                  }}
                  aria-label="Save folder name"
                  title="Save"
                >
                  ƒo"
                </button>
              </span>
            ) : (
              <span className="treeFolderNameWrap">
                <span
                  className="treeFolderName"
                  title={folder.name}
                >
                  {folder.name}
                </span>
                <span className="small treeFolderCount">{reqCount}</span>
                <button
                  className="treeRenameIcon"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    startRename()
                  }}
                  aria-label="Rename folder"
                  title="Rename"
                >
                  ƒoZ
                </button>
              </span>
            )}
          </div>
          <div className="treeSummaryRight">
            {isEditing ? (
              <button
                className="treeRenameIcon treeRenameIconConfirm"
                onPointerDown={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  suppressNextBlurRef.current = true
                }}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  submitRename()
                }}
                aria-label="Save folder name"
                title="Save"
              >
                OK
              </button>
            ) : null}

            <div ref={isFolderMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
              <button
                type="button"
                className="iconBtn treeMenuBtn"
                disabled={isEditing}
                onPointerDown={e => {
                  if (isEditing) return
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={e => {
                  if (isEditing) return
                  e.preventDefault()
                  e.stopPropagation()
                  setOpenMenu(openMenu?.kind === 'folder' && openMenu.id === folder.id ? null : { kind: 'folder', id: folder.id })
                }}
                aria-label="Folder menu"
                title="Menu"
              >
                ...
              </button>

              {isFolderMenuOpen ? (
                <div
                  className="treeMenuPanel"
                  role="menu"
                  ref={applyMenuPosition}
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  <div className="treeMenuSubmenu">
                    <button
                      type="button"
                      className="treeMenuItem treeMenuSubmenuTrigger"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-label="Add"
                    >
                      <span>Add</span>
                      <span className="treeMenuSubmenuCaret" aria-hidden="true">{'>'}</span>
                    </button>
                    <div className="treeMenuSubmenuPanel" role="menu" aria-label="Add menu">
                      <button
                        type="button"
                        className="treeMenuItem"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null)
                          setOpenFolders(prev => new Set(prev).add(folder.id))
                          props.onAddRequestToFolder(col.id, folder.id)
                        }}
                      >
                        Add Request
                      </button>
                      <button
                        type="button"
                        className="treeMenuItem"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null)
                          setOpenFolders(prev => new Set(prev).add(folder.id))
                          props.onAddFolderToFolder(col.id, folder.id)
                        }}
                      >
                        Add Folder
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      void copyText(folder.name)
                    }}
                  >
                    Copy Name
                  </button>
                  {props.onRunFolder ? (
                    <button
                      type="button"
                      className="treeMenuItem"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenu(null)
                        props.onRunFolder?.(col.id, folder.id)
                      }}
                    >
                      Run Folder
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      props.onDuplicateFolder(col.id, folder.id)
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      startRename()
                    }}
                  >
                    Rename
                  </button>
                  <div className="treeMenuDivider" role="separator" />
                  <button
                    type="button"
                    className="treeMenuItem treeMenuItemDanger"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      props.onDeleteFolder(col.id, folder.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </summary>

        {childFolders.map(f => renderFolder(col, f))}

        <div className="treeItems">
          {folder.requests.map(r => {
            const active = props.activeRequestId === r.id
            const isEditingRequest = editing?.kind === 'request' && editing.id === r.id
            const isRequestMenuOpen = openMenu?.kind === 'request' && openMenu.id === r.id && !isEditingRequest
            const requestDropPosition = dropTarget?.kind === 'request' && dropTarget.id === r.id ? dropTarget.position : null
            const isRequestDropInvalid = invalidDropTarget?.kind === 'request' && invalidDropTarget.id === r.id

            function startRenameRequest() {
              suppressNextBlurRef.current = false
              setOpenMenu(null)
              setEditing({ kind: 'request', id: r.id })
              setDraftName(r.name)
            }

            function cancelRenameRequest() {
              setEditing(null)
              setDraftName('')
            }

            function submitRenameRequest() {
              const next = (nameEditableRef.current?.innerText ?? draftName).trim()
              cancelRenameRequest()
              if (!next || next === r.name) return
              props.onRenameRequest(col.id, r.id, next)
            }

            return (
              <div
                key={r.id}
                className={`treeItem ${active ? 'treeItemActive' : ''}${requestDropPosition ? ` treeDropTarget treeDropTarget${requestDropPosition[0].toUpperCase()}${requestDropPosition.slice(1)}` : ''}${isRequestDropInvalid ? ' treeDropInvalid' : ''}`}
                draggable={!isEditingRequest}
                onClick={() => {
                  if (isEditingRequest) return
                  props.onPickRequest(r, col)
                }}
                onDragOver={e => {
                  if (isEditingRequest) return
                  onRequestRowDragOver(e, r.id)
                }}
                onDrop={e => {
                  if (isEditingRequest) return
                  onRequestRowDrop(e, col, r.id, folder.id)
                }}
                onDragStart={e => {
                  if (isEditingRequest) return
                  onRequestDragStart(e, col.id, r.id)
                }}
                onDragEnd={() => {
                  if (isEditingRequest) return
                  onRequestDragEnd()
                }}
              >
                <span className={`mono small treeMethod ${inFlightMethodClass(r.id, r.method)}`}>{displayMethod(r.method)}</span>
                {isEditingRequest ? (
                  <span className="treeItemNameWrap">
                    <span
                      ref={nameEditableRef as any}
                      className="treeItemName treeNameEditing"
                      contentEditable
                      spellCheck={false}
                      suppressContentEditableWarning
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          suppressNextBlurRef.current = true
                          submitRenameRequest()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          suppressNextBlurRef.current = true
                          cancelRenameRequest()
                        }
                      }}
                      onBlur={() => {
                        if (suppressNextBlurRef.current) {
                          suppressNextBlurRef.current = false
                          return
                        }
                        cancelRenameRequest()
                      }}
                      role="textbox"
                      aria-label="Request name"
                    >
                      {draftName}
                    </span>
                    <button
                      className="treeRenameIcon treeRenameIconConfirm"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        suppressNextBlurRef.current = true
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        submitRenameRequest()
                      }}
                      aria-label="Save request name"
                      title="Save"
                    >
                      ƒo"
                    </button>
                  </span>
                ) : (
                  <span className="treeItemNameWrap">
                    <span
                      className="treeItemName"
                      onDoubleClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        startRenameRequest()
                      }}
                      title={getRequestHoverTitle(r)}
                    >
                      {r.name}
                    </span>
                    <button
                      className="treeRenameIcon"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        startRenameRequest()
                      }}
                      aria-label="Rename request"
                      title="Rename"
                    >
                      ƒoZ
                    </button>
                  </span>
                )}

                <div ref={isRequestMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
                  <button
                    type="button"
                    className="iconBtn treeMenuBtn"
                    onPointerDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setOpenMenu(openMenu?.kind === 'request' && openMenu.id === r.id ? null : { kind: 'request', id: r.id })
                    }}
                    aria-label="Request menu"
                    title="Menu"
                  >
                    ...
                  </button>

                  {isRequestMenuOpen ? (
                    <div
                      className="treeMenuPanel"
                      role="menu"
                      ref={applyMenuPosition}
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <div className="treeMenuSubmenu">
                        <button
                          type="button"
                          className="treeMenuItem treeMenuSubmenuTrigger"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-label="Copy"
                        >
                          <span>Copy</span>
                          <span className="treeMenuSubmenuCaret" aria-hidden="true">{'>'}</span>
                        </button>
                        <div className="treeMenuSubmenuPanel" role="menu" aria-label="Copy menu">
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              void copyText(r.name)
                            }}
                          >
                            Copy Name
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              void copyText(getRequestHoverTitle(r))
                            }}
                          >
                            Copy Path
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="treeMenuItem"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null)
                          props.onDuplicateRequest(col.id, r.id)
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="treeMenuItem"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null)
                          startRenameRequest()
                        }}
                      >
                        Rename
                      </button>
                      <div className="treeMenuDivider" role="separator" />
                      <button
                        type="button"
                        className="treeMenuItem treeMenuItemDanger"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null)
                          props.onDeleteRequest(col.id, r.id)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </details>
    )
  }

  return (
    <div className="tree">
      {sortedCollections.map(col => (
        <details
          key={col.id}
          className="treeGroup"
          open={openCollections.has(col.id)}
          onToggle={e => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open
            setOpenCollections(prev => {
              const next = new Set(prev)
              if (isOpen) next.add(col.id)
              else next.delete(col.id)
              return next
            })
          }}
        >
          {(() => {
            const reqCount = requestCountByCollection[col.id] ?? 0
            const isEditing = editing?.kind === 'collection' && editing.id === col.id
            const isMenuOpen = !isEditing && openMenu?.kind === 'collection' && openMenu.id === col.id
            const collectionDropPosition = dropTarget?.kind === 'collection' && dropTarget.id === col.id ? dropTarget.position : null
            const isCollectionDropInvalid = invalidDropTarget?.kind === 'collection' && invalidDropTarget.id === col.id

            function startRename() {
              suppressNextBlurRef.current = false
              setOpenMenu(null)
              setEditing({ kind: 'collection', id: col.id })
              setDraftName(col.name)
            }

            function cancelRename() {
              setEditing(null)
              setDraftName('')
            }

            function submitRename() {
              const next = (nameEditableRef.current?.innerText ?? draftName).trim()
              cancelRename()
              if (!next || next === col.name) return
              props.onRenameCollection(col.id, next)
            }

            return (
              <>
                <summary
                  className="treeSummary"
                  onPointerDown={e => {
                    if (!isEditing) return
                    const target = e.target as HTMLElement | null
                    const nameEl = nameEditableRef.current
                    const clickedConfirm = !!target?.closest?.('.treeRenameIconConfirm')
                    const clickedName = !!(nameEl && target && nameEl.contains(target))
                    if (clickedConfirm || clickedName) return
                    e.preventDefault()
                    e.stopPropagation()
                    suppressNextBlurRef.current = true
                    cancelRename()
                  }}
                >
                  <div
                    className={`treeSummaryDnd${collectionDropPosition ? ` treeDropTarget treeDropTarget${collectionDropPosition[0].toUpperCase()}${collectionDropPosition.slice(1)}` : ''}${isCollectionDropInvalid ? ' treeDropInvalid' : ''}`}
                    draggable={!isEditing}
                    onDragStart={e => {
                      if (isEditing) return
                      props.onDraggingItemChange?.({ kind: 'collection', collectionId: col.id })
                      setCollectionDragData(e, col.id)
                    }}
                    onDragEnd={() => {
                      props.onDraggingItemChange?.(null)
                    }}
                    onDragOver={e => {
                      onCollectionRowDragOver(e, col.id)
                    }}
                    onDrop={e => {
                      onCollectionRowDrop(e, col.id)
                    }}
                  >
                  <span className="treeChevron" aria-hidden="true" />
                  <div className="treeSummaryLeft">
                    {isEditing ? (
                      <span className="treeCollectionNameWrap">
                        <span
                          ref={nameEditableRef as any}
                          className="treeCollectionName treeCollectionNameEditing"
                          contentEditable
                          spellCheck={false}
                          suppressContentEditableWarning
                          onClick={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              suppressNextBlurRef.current = true
                              submitRename()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              suppressNextBlurRef.current = true
                              cancelRename()
                            }
                          }}
                          onBlur={() => {
                            if (suppressNextBlurRef.current) {
                              suppressNextBlurRef.current = false
                              return
                            }
                            cancelRename()
                          }}
                          role="textbox"
                          aria-label="Collection name"
                        >
                          {draftName}
                        </span>
                        <span className="small treeCollectionCount">{reqCount}</span>
                        <button
                          className="treeRenameIcon treeRenameIconConfirm"
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            suppressNextBlurRef.current = true
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            submitRename()
                          }}
                          aria-label="Save collection name"
                          title="Save"
                        >
                          ✓
                        </button>
                      </span>
                    ) : (
                      <span className="treeCollectionNameWrap">
                        <span
                          className="treeCollectionName"
                          onDoubleClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            startRename()
                          }}
                          title={col.name}
                        >
                          {col.name}
                        </span>
                        <span className="small treeCollectionCount">{reqCount}</span>
                        <button
                          className="treeRenameIcon"
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            startRename()
                          }}
                          aria-label="Rename collection"
                          title="Rename"
                        >
                          ✎
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="treeSummaryRight">
                    {isEditing ? (
                      <button
                        className="treeRenameIcon treeRenameIconConfirm"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          suppressNextBlurRef.current = true
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          submitRename()
                        }}
                        aria-label="Save collection name"
                        title="Save"
                      >
                        OK
                      </button>
                    ) : null}

                    <div ref={isMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
                      <button
                        type="button"
                        className="iconBtn treeMenuBtn"
                        disabled={isEditing}
                        onPointerDown={e => {
                          if (isEditing) return
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onClick={e => {
                          if (isEditing) return
                          e.preventDefault()
                          e.stopPropagation()
                          setOpenMenu(openMenu?.kind === 'collection' && openMenu.id === col.id ? null : { kind: 'collection', id: col.id })
                        }}
                        aria-label="Collection menu"
                        title="Menu"
                      >
                        ...
                      </button>

                      {isMenuOpen ? (
                        <div
                          className="treeMenuPanel"
                          role="menu"
                          ref={applyMenuPosition}
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                        >
                          <div className="treeMenuSubmenu">
                            <button
                              type="button"
                              className="treeMenuItem treeMenuSubmenuTrigger"
                              role="menuitem"
                              aria-haspopup="menu"
                              aria-label="Add"
                            >
                              <span>Add</span>
                              <span className="treeMenuSubmenuCaret" aria-hidden="true">{'>'}</span>
                            </button>
                            <div className="treeMenuSubmenuPanel" role="menu" aria-label="Add menu">
                              <button
                                type="button"
                                className="treeMenuItem"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null)
                                  props.onAddRequest(col.id)
                                }}
                              >
                                Add Request
                              </button>
                              <button
                                type="button"
                                className="treeMenuItem"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null)
                                  props.onAddFolder(col.id)
                                }}
                              >
                                Add Folder
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              void copyText(col.name)
                            }}
                          >
                            Copy Name
                          </button>
                          {props.onRunCollection ? (
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                props.onRunCollection?.(col.id)
                              }}
                            >
                              Run Collection
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              props.onDuplicateCollection(col.id)
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              void exportCollection(col).catch(e => {
                                console.error(e)
                                alert((e as Error | null)?.message || 'Export failed')
                              })
                            }}
                          >
                            Export
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              startRename()
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              props.onOpenEnv(col.id)
                            }}
                          >
                            Enviroment
                          </button>
                          {col.sourceUrl && props.onUpdateCollectionFromUrl ? (
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                props.onUpdateCollectionFromUrl?.(col.id)
                              }}
                              title={col.sourceUrl}
                            >
                              Update from URL
                            </button>
                          ) : null}
                          {col.sourceType === 'url'
                            && col.sourceUrl
                            && (col.importFormat === 'openapi' || /(?:swagger|openapi|api-docs)/i.test(col.sourceUrl))
                            && props.onOpenCollectionSwagger ? (
                            <button
                              type="button"
                              className="treeMenuItem treeMenuItemSwagger"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                props.onOpenCollectionSwagger?.(col.id)
                              }}
                              title={col.sourceUrl}
                            >
                              Open Swagger
                            </button>
                          ) : null}
                          {col.sourceType === 'file' && props.onReloadCollectionFromFile ? (
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                props.onReloadCollectionFromFile?.(col.id)
                              }}
                              title={col.sourceFileName}
                            >
                              Reload From File
                            </button>
                          ) : null}
                          <div className="treeMenuDivider" role="separator" />
                          <button
                            type="button"
                            className="treeMenuItem treeMenuItemDanger"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenu(null)
                              props.onDeleteCollection(col.id)
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="envBtn"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.onOpenEnv(col.id)
                      }}
                      title="Environment"
                    >
                      env
                    </button>
                    <button
                      className="deleteBtn"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.onDeleteCollection(col.id)
                      }}
                      title="Delete collection"
                      aria-label="Delete collection"
                    >
                      ✕
                    </button>
                  </div>
                  </div>
                </summary>
              </>
            )
          })()}

          <div className="treeItems">
            {(col.requests ?? []).map(r => {
              const active = props.activeRequestId === r.id
              const isEditingRequest = editing?.kind === 'request' && editing.id === r.id
              const isRequestMenuOpen = openMenu?.kind === 'request' && openMenu.id === r.id && !isEditingRequest
              const requestDropPosition = dropTarget?.kind === 'request' && dropTarget.id === r.id ? dropTarget.position : null
              const isRequestDropInvalid = invalidDropTarget?.kind === 'request' && invalidDropTarget.id === r.id

              function startRenameRequest() {
                suppressNextBlurRef.current = false
                setOpenMenu(null)
                setEditing({ kind: 'request', id: r.id })
                setDraftName(r.name)
              }

              function cancelRenameRequest() {
                setEditing(null)
                setDraftName('')
              }

              function submitRenameRequest() {
                const next = (nameEditableRef.current?.innerText ?? draftName).trim()
                cancelRenameRequest()
                if (!next || next === r.name) return
                props.onRenameRequest(col.id, r.id, next)
              }

                return (
                  <div
                    key={r.id}
                    className={`treeItem ${active ? 'treeItemActive' : ''}${requestDropPosition ? ` treeDropTarget treeDropTarget${requestDropPosition[0].toUpperCase()}${requestDropPosition.slice(1)}` : ''}${isRequestDropInvalid ? ' treeDropInvalid' : ''}`}
                    draggable={!isEditingRequest}
                    onClick={() => {
                    if (isEditingRequest) return
                    props.onPickRequest(r, col)
                  }}
                  onDragOver={e => {
                    if (isEditingRequest) return
                    onRequestRowDragOver(e, r.id)
                  }}
                  onDrop={e => {
                    if (isEditingRequest) return
                    onRequestRowDrop(e, col, r.id, null)
                  }}
                  onDragStart={e => {
                    if (isEditingRequest) return
                    onRequestDragStart(e, col.id, r.id)
                  }}
                  onDragEnd={() => {
                    if (isEditingRequest) return
                    onRequestDragEnd()
                    }}
                  >
                    <span className={`mono small treeMethod ${inFlightMethodClass(r.id, r.method)}`}>{displayMethod(r.method)}</span>
                    {isEditingRequest ? (
                      <span className="treeItemNameWrap">
                        <span
                          ref={nameEditableRef as any}
                          className="treeItemName treeNameEditing"
                        contentEditable
                        spellCheck={false}
                        suppressContentEditableWarning
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            suppressNextBlurRef.current = true
                            submitRenameRequest()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            suppressNextBlurRef.current = true
                            cancelRenameRequest()
                          }
                        }}
                        onBlur={() => {
                          if (suppressNextBlurRef.current) {
                            suppressNextBlurRef.current = false
                            return
                          }
                          cancelRenameRequest()
                        }}
                        role="textbox"
                        aria-label="Request name"
                      >
                        {draftName}
                      </span>
                      <button
                        className="treeRenameIcon treeRenameIconConfirm"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          suppressNextBlurRef.current = true
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          submitRenameRequest()
                        }}
                        aria-label="Save request name"
                        title="Save"
                      >
                        ’'o"
                      </button>
                    </span>
                  ) : (
                    <span className="treeItemNameWrap">
                    <span
                      className="treeItemName"
                      onDoubleClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        startRenameRequest()
                      }}
                      title={getRequestHoverTitle(r)}
                    >
                      {r.name}
                    </span>
                    <button
                      className="treeRenameIcon"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          startRenameRequest()
                        }}
                        aria-label="Rename request"
                        title="Rename"
                      >
                        ’'oZ
                      </button>
                    </span>
                  )}

                  <div ref={isRequestMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
                    <button
                      type="button"
                      className="iconBtn treeMenuBtn"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        setOpenMenu(openMenu?.kind === 'request' && openMenu.id === r.id ? null : { kind: 'request', id: r.id })
                      }}
                      aria-label="Request menu"
                      title="Menu"
                    >
                      ...
                    </button>

                  {isRequestMenuOpen ? (
                    <div
                      className="treeMenuPanel"
                      role="menu"
                      ref={applyMenuPosition}
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                      >
                        <div className="treeMenuSubmenu">
                          <button
                            type="button"
                            className="treeMenuItem treeMenuSubmenuTrigger"
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-label="Copy"
                          >
                            <span>Copy</span>
                            <span className="treeMenuSubmenuCaret" aria-hidden="true">{'>'}</span>
                          </button>
                          <div className="treeMenuSubmenuPanel" role="menu" aria-label="Copy menu">
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                void copyText(r.name)
                              }}
                            >
                              Copy Name
                            </button>
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenu(null)
                                void copyText(getRequestHoverTitle(r))
                              }}
                            >
                              Copy Path
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="treeMenuItem"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenu(null)
                            props.onDuplicateRequest(col.id, r.id)
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="treeMenuItem"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenu(null)
                            startRenameRequest()
                          }}
                        >
                          Rename
                        </button>
                        <div className="treeMenuDivider" role="separator" />
                        <button
                          type="button"
                          className="treeMenuItem treeMenuItemDanger"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenu(null)
                            props.onDeleteRequest(col.id, r.id)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {col.folders.map(folder => renderFolder(col, folder))}
        </details>
      ))}
    </div>
  )
}
