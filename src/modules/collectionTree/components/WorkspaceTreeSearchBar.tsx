import type { TreeSortMode } from '../types'
import { CloseIcon, FoldersCollapseIcon, FoldersExpandIcon, SortAscIcon, SortDescIcon, SortNeutralIcon } from '../../../shared/icons'

export function WorkspaceTreeSearchBar(props: {
  query: string
  onQueryChange: (value: string) => void
  onClearQuery: () => void
  sortMode?: TreeSortMode
  treeToggleLabel?: string
  treeToggleWillCollapse?: boolean
  onTreeToggleClick?: () => void
  onTreeSortToggleClick?: () => void
}) {
  const sortMode = props.sortMode ?? 'none'

  return (
    <div className="workspaceTreeSearchWrap">
      <div className="workspaceTreeSearchField">
        <input
          type="text"
          className="workspaceTreeSearchInput"
          placeholder="Search workspace tree..."
          value={props.query}
          onChange={e => props.onQueryChange(e.target.value)}
          spellCheck={false}
          aria-label="Search workspace tree"
        />
        <div className="workspaceTreeSearchActions">
          {props.query ? (
            <button
              type="button"
              className="workspaceTreeSearchClearBtn workspaceTreeSearchActionBtn"
              aria-label="Clear search"
              title="Clear"
              onPointerDown={e => {
                // Keep focus on the search input and avoid blur/focus flicker.
                e.preventDefault()
              }}
              onClick={props.onClearQuery}
            >
              <CloseIcon size={10} className="workspaceTreeSearchClearIcon" />
            </button>
          ) : null}
          <button
            type="button"
            className="iconBtn treeToggleBtn workspaceTreeSearchActionBtn"
            onClick={props.onTreeToggleClick}
            aria-label={props.treeToggleLabel ?? 'Expand or collapse all'}
            title={props.treeToggleLabel ?? 'Expand or collapse all'}
            disabled={!props.onTreeToggleClick}
          >
            <span className="iconGlyph">
              {props.treeToggleWillCollapse ? <FoldersCollapseIcon size={16} /> : <FoldersExpandIcon size={16} />}
            </span>
          </button>
          <button
            type="button"
            className="iconBtn treeSortBtn workspaceTreeSearchActionBtn"
            onClick={props.onTreeSortToggleClick}
            aria-label={sortMode === 'none' ? 'Sort folders and requests (A-Z)' : sortMode === 'asc' ? 'Sort folders and requests (Z-A)' : 'Turn off alphabetical sort'}
            title={sortMode === 'none' ? 'Sort A-Z' : sortMode === 'asc' ? 'Sort Z-A' : 'Sort off'}
            disabled={!props.onTreeSortToggleClick}
          >
            <span className="iconGlyph" style={{ opacity: sortMode === 'none' ? 0.75 : 1 }}>
              {sortMode === 'none'
                ? <SortNeutralIcon size={16} />
                : sortMode === 'asc'
                  ? <SortAscIcon size={16} />
                  : <SortDescIcon size={16} />}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
