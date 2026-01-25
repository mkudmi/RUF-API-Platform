const RUF_MIME_FOLDER = 'application/x-ruf-folder'
const RUF_MIME_REQUEST = 'application/x-ruf-request'
const RUF_MIME_COLLECTION = 'application/x-ruf-collection'

type DraggedFolder = { collectionId: string, folderId: string }
type DraggedRequest = { collectionId: string, requestId: string }
type DraggedCollection = { collectionId: string }

export function setDraggedFolder(dt: DataTransfer, payload: DraggedFolder) {
  dt.effectAllowed = 'move'
  dt.setData(RUF_MIME_FOLDER, JSON.stringify(payload))
  dt.setData('text/plain', payload.folderId)
}

export function setDraggedRequest(dt: DataTransfer, payload: DraggedRequest) {
  dt.effectAllowed = 'move'
  dt.setData(RUF_MIME_REQUEST, JSON.stringify(payload))
  dt.setData('text/plain', payload.requestId)
}

export function setDraggedCollection(dt: DataTransfer, payload: DraggedCollection) {
  dt.effectAllowed = 'move'
  dt.setData(RUF_MIME_COLLECTION, JSON.stringify(payload))
  dt.setData('text/plain', payload.collectionId)
}

export function readDraggedFolder(dt: DataTransfer): DraggedFolder | null {
  try {
    const raw = dt.getData(RUF_MIME_FOLDER)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    const folderId = typeof parsed?.folderId === 'string' ? parsed.folderId : ''
    if (!collectionId || !folderId) return null
    return { collectionId, folderId }
  } catch {
    return null
  }
}

export function readDraggedRequest(dt: DataTransfer): DraggedRequest | null {
  try {
    const raw = dt.getData(RUF_MIME_REQUEST)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : ''
    if (!collectionId || !requestId) return null
    return { collectionId, requestId }
  } catch {
    return null
  }
}

export function readDraggedCollection(dt: DataTransfer): DraggedCollection | null {
  try {
    const raw = dt.getData(RUF_MIME_COLLECTION)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
    if (!collectionId) return null
    return { collectionId }
  } catch {
    return null
  }
}
