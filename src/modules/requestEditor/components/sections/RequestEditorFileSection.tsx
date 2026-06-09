import type { Dispatch, RefObject, SetStateAction } from 'react'
import { CloseIcon, PencilIcon } from '../../../../shared/icons'
import { ConfirmIconButton } from '../../../../shared/components/ConfirmIconButton'
import type { FileRow } from '../../types'

export function RequestEditorFilePicker(props: {
  bodyFileInputRef: RefObject<HTMLInputElement | null>
  activeFileRowIdRef: RefObject<string | null>
  fileRows: FileRow[]
  setFileRows: Dispatch<SetStateAction<FileRow[]>>
  onChooseFile: (rowId: string) => void
  onEditFile: (rowId: string) => void
  canEditFile: (row: FileRow) => boolean
}) {
  const bodyFileInputRef = props.bodyFileInputRef
  const activeFileRowIdRef = props.activeFileRowIdRef
  const canDeleteRow = props.fileRows.length > 1

  return (
    <div className="section">
      <input
        ref={bodyFileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={e => {
          const next = e.target.files?.[0] ?? null
          const targetRowId = activeFileRowIdRef.current ?? props.fileRows[0]?.id ?? null
          const el = e.target as HTMLInputElement

          activeFileRowIdRef.current = null
          el.value = ''

          if (!targetRowId) return
          if (!next) return

          props.setFileRows(prev => prev.map(r => (r.id === targetRowId ? { ...r, file: next, fileHandle: null, fileName: next.name } : r)))
        }}
      />

      {props.fileRows.map(row => (
        <div key={row.id} className="formRow">
          <input
            className={`mono ${row.isActive ? '' : 'rowInactive'}`.trim()}
            value={row.fieldName}
            onChange={e => props.setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: e.target.value } : r)))}
            placeholder="Key"
            aria-label="File field key"
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`chooseFileBtn ${row.isActive ? '' : 'rowInactive'}`.trim()}
              title={row.file ? row.file.name : row.fileName || 'Choose file'}
              style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => props.onChooseFile(row.id)}
            >
              <span className="chooseFileBtnLabel">{row.file ? row.file.name : row.fileName || 'Choose file'}</span>
            </button>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="iconBtn"
                disabled={!props.canEditFile(row)}
                aria-label="Edit file"
                title={
                  !row.file
                    ? 'Choose file first'
                    : props.canEditFile(row)
                      ? 'Edit file'
                      : 'Only text files can be edited'
                }
                onClick={() => props.onEditFile(row.id)}
              >
                <PencilIcon size={16} />
              </button>
              <label className="checkRow rowCheck" title={row.isActive ? 'Active' : 'Inactive'}>
                <input
                  type="checkbox"
                  className="checkInput"
                  checked={row.isActive}
                  aria-label={`Toggle file row ${row.fieldName.trim() || row.file?.name || row.fileName || ''}`.trim()}
                  onChange={e => props.setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive: e.target.checked } : r)))}
                  onClick={e => e.stopPropagation()}
                />
                <span className="checkBox" aria-hidden="true" />
              </label>
              <ConfirmIconButton
                className="rowDeleteBtn"
                disabled={false}
                onConfirm={() => {
                  if (row.file) {
                    props.setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: '', file: null, fileHandle: null, fileName: '' } : r)))
                    return
                  }
                  if (canDeleteRow) {
                    props.setFileRows(prev => prev.filter(r => r.id !== row.id))
                    return
                  }
                  props.setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: '' } : r)))
                }}
                ariaLabel={row.file ? 'Remove file' : canDeleteRow ? 'Remove file row' : 'Clear file row'}
                confirmAriaLabel={row.file ? 'Confirm remove file' : canDeleteRow ? 'Confirm remove file row' : 'Confirm clear file row'}
                title={
                  row.file
                    ? 'Remove file'
                    : canDeleteRow
                      ? 'Remove file row'
                      : row.fieldName.trim()
                        ? 'Clear key'
                        : 'No file to remove'
                }
                confirmTitle={row.file ? 'Confirm remove file' : canDeleteRow ? 'Confirm remove file row' : 'Confirm clear key'}
                icon={<CloseIcon size={18} />}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
