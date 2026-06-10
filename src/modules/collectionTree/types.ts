export type HttpMethod = string

export type TreeSortMode = 'none' | 'asc' | 'desc'
export type TreeDropPosition = 'before' | 'inside' | 'after'

export type CollectionTreeDropTarget =
  | {
    collectionId: string
    targetType: 'root'
    targetId: null
    parentFolderId: null
    position: 'inside'
  }
  | {
    collectionId: string
    targetType: 'folder'
    targetId: string
    parentFolderId: string | null
    position: TreeDropPosition
  }
  | {
    collectionId: string
    targetType: 'request'
    targetId: string
    parentFolderId: string | null
    position: 'before' | 'after'
  }

export type WorkspaceFolderDropTarget =
  | {
    targetType: 'root'
    targetId: null
    parentFolderId: null
    position: 'inside'
  }
  | {
    targetType: 'workspace-folder'
    targetId: string
    parentFolderId: string | null
    position: TreeDropPosition
  }

export type WorkspaceCollectionDropTarget =
  | {
    workspaceFolderId: string | null
    targetCollectionId: string | null
    position: 'inside'
  }
  | {
    workspaceFolderId: string | null
    targetCollectionId: string
    position: 'before' | 'after'
  }

export type Collection = {
  id: string
  name: string
  baseUrl?: string
  variables?: Record<string, string>
  requests?: RequestItem[]
  folders: Folder[]
  importFormat?: 'openapi' | 'postman' | 'insomnia' | 'wsdl'
  sourceUrl?: string
  sourceType?: 'url' | 'file'
  sourceFileName?: string
}

export type Folder = {
  id: string
  name: string
  requests: RequestItem[]
  folders?: Folder[]
}

export type RequestParam = {
  name: string
  in: 'path'|'query'|'header'
  required?: boolean
  schemaType?: string
  enumValues?: Array<string | number | boolean>
  example?: any
}

export type RequestItem = {
  id: string
  name: string
  description?: string
  method: HttpMethod
  path: string                 // /users/{id}
  urlTemplate: string          // {{baseUrl}}/users/{id}
  params: RequestParam[]
  headers: Record<string, string>
  body?: {
    contentType: string
    example: any
  }
}
