export type WorkspaceFolder = {
  id: string
  name: string
  collectionIds: string[]
  folders?: WorkspaceFolder[]
}

export type Workspace = {
  folders: WorkspaceFolder[]
}
