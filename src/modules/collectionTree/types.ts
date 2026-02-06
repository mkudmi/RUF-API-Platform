export type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS'

export type TreeSortMode = 'none' | 'asc' | 'desc'

export type Collection = {
  id: string
  name: string
  baseUrl?: string
  variables?: Record<string, string>
  requests?: RequestItem[]
  folders: Folder[]
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
