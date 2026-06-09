export type QueryDraftRowState = { id: string, name: string, value: string, isActive: boolean }

export type HeaderDraftRowState = { id: string, name: string, value: string, isActive: boolean }

export type FileRow = {
  id: string
  fieldName: string
  file: File | null
  fileName: string
  isActive: boolean
}

export type HeaderDraftState = {
  headerOverrides: Record<string, string>
  headerDraftRows: HeaderDraftRowState[]
  headerKeyOrder: string[]
  disabledHeaderNames: Record<string, true>
  inactiveHeaderNames: Record<string, true>
}
