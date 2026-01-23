export type WorkspaceFolder = {
  id: string
  name: string
  collectionIds: string[]
}

export type Workspace = {
  folders: WorkspaceFolder[]
}

