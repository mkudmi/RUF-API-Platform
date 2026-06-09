import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { RequestParam } from '../../../collectionTree'
import { PlusIcon, ReloadIcon } from '../../../../shared/icons'
import type { ValueHistoryStore } from '../../state/headers/valueHistory'
import type { VariableSuggestion } from '../../../../shared/utils/variables'
import { HeaderDraftRow, HeaderRow, ParamRow, QueryDraftRow, QueryRow, type MenuAnchor } from '../rows/RequestEditorRows'
import type { HeaderDraftRowState, QueryDraftRowState } from '../../types'

type SharedMenuProps = {
  enumMenuOpenId: string | null
  enumMenuAnchor: MenuAnchor | null
  onToggleEnumMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseEnumMenu: () => void
  enumMenuPanelRef: RefObject<HTMLDivElement | null>
  valueHistoryMenuOpenId: string | null
  valueHistoryMenuAnchor: MenuAnchor | null
  onToggleValueHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseValueHistoryMenu: () => void
  valueHistoryMenuPanelRef: RefObject<HTMLDivElement | null>
  clearAllValueHistory: () => void
}

export function RequestEditorParamsTab(props: SharedMenuProps & {
  pathParams: Record<string, string>
  pathParamsList: RequestParam[]
  setPathParams: Dispatch<SetStateAction<Record<string, string>>>
  queryParams: Record<string, string>
  queryParamsList: RequestParam[]
  querySpecNames: Set<string>
  queryParamKeyOverrides: Record<string, string>
  inactiveQueryParamNames: Record<string, true>
  queryDraftRows: QueryDraftRowState[]
  variableSuggestions: VariableSuggestion[]
  valueHistory: ValueHistoryStore
  setInactiveQueryParamNames: Dispatch<SetStateAction<Record<string, true>>>
  setQueryParams: Dispatch<SetStateAction<Record<string, string>>>
  setQueryDraftRows: Dispatch<SetStateAction<QueryDraftRowState[]>>
  setQueryParamKeyOverrides: Dispatch<SetStateAction<Record<string, string>>>
  setDisabledQueryParamNames: Dispatch<SetStateAction<Record<string, true>>>
  setQueryKeyOrder: Dispatch<SetStateAction<string[]>>
  setFlagForKey: (prev: Record<string, true>, keyRaw: string, active: boolean) => Record<string, true>
  renameStoreKey: (prev: Record<string, string>, fromKey: string, toKey: string) => Record<string, string>
  renameFlagKey: (prev: Record<string, true>, fromKey: string, toKey: string) => Record<string, true>
  replaceKeyInOrder: (prev: string[], fromKey: string, toKey: string) => string[]
  uid: (prefix: string) => string
  addQueryDraftRow: () => void
  recordValueHistory: (kind: 'query' | 'path', key: string, value: string) => void
  deleteValueHistoryItem: (kind: 'query' | 'path', key: string, value: string) => void
}) {
  return (
    <div className="accordion">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Params</div>
        <button
          type="button"
          className="iconBtn addRowBtn"
          onClick={props.addQueryDraftRow}
          aria-label="Add query param"
          title="Add query param"
        >
          <PlusIcon size={16} />
        </button>
      </div>

      {props.pathParamsList.length > 0 && (
        <div className="section">
          <div className="sectionTitle">Path</div>
          {props.pathParamsList.map(p => (
            <ParamRow
              key={p.name}
              param={p}
              store={props.pathParams}
              setStore={props.setPathParams}
              onClear={() => {
                props.setPathParams(prev => {
                  if (!(p.name in prev)) return prev
                  const next = { ...prev }
                  delete next[p.name]
                  return next
                })
              }}
              variableSuggestions={props.variableSuggestions}
              enumMenuId={`enum:path:${p.name}`}
              enumMenuOpenId={props.enumMenuOpenId}
              enumMenuAnchor={props.enumMenuAnchor}
              onToggleEnumMenu={props.onToggleEnumMenu}
              onCloseEnumMenu={props.onCloseEnumMenu}
              enumMenuPanelRef={props.enumMenuPanelRef}
              historyItems={props.valueHistory.path[p.name] ?? []}
              onRecordHistory={next => props.recordValueHistory('path', p.name, next)}
              onPickHistory={next => {
                props.setPathParams(prev => ({ ...prev, [p.name]: next }))
                props.recordValueHistory('path', p.name, next)
              }}
              onDeleteHistoryItem={next => props.deleteValueHistoryItem('path', p.name, next)}
              onClearAllHistory={props.clearAllValueHistory}
              historyMenuId={`path:${p.name}`}
              historyMenuOpenId={props.valueHistoryMenuOpenId}
              historyMenuAnchor={props.valueHistoryMenuAnchor}
              onToggleHistoryMenu={props.onToggleValueHistoryMenu}
              onCloseHistoryMenu={props.onCloseValueHistoryMenu}
              historyMenuPanelRef={props.valueHistoryMenuPanelRef}
            />
          ))}
        </div>
      )}

      <div className="section">
        <div className="sectionTitle">Query</div>
        {props.queryParamsList.map(p => {
          const rawName = p.name
          const isSpec = props.querySpecNames.has(rawName)
          const isRequiredSpecKey = isSpec && !!p.required
          const effectiveName =
            isRequiredSpecKey
              ? rawName
              : isSpec
                ? (props.queryParamKeyOverrides[rawName] ?? rawName)
                : rawName
          const value = props.queryParams[effectiveName] ?? ''
          const isActive = !props.inactiveQueryParamNames[effectiveName]
          const hint =
            typeof p.example === 'string' || typeof p.example === 'number'
              ? String(p.example)
              : p.schemaType || ''

          return (
            <QueryRow
              key={rawName}
              name={effectiveName}
              rawName={rawName}
              isSpec={isSpec}
              value={value}
              hint={isSpec ? hint : undefined}
              enumValues={isSpec ? p.enumValues : undefined}
              required={isSpec ? p.required : false}
              readOnlyName={isRequiredSpecKey}
              isActive={isActive}
              onToggleActive={nextActive => props.setInactiveQueryParamNames(prev => props.setFlagForKey(prev, effectiveName, nextActive))}
              variableSuggestions={props.variableSuggestions}
              historyItems={props.valueHistory.query[effectiveName] ?? []}
              onRecordHistory={next => props.recordValueHistory('query', effectiveName, next)}
              onPickHistory={next => {
                props.setQueryParams(prev => {
                  const nextParams = { ...prev }
                  nextParams[effectiveName] = next
                  if (isSpec && effectiveName !== rawName) delete nextParams[rawName]
                  return nextParams
                })
                props.setInactiveQueryParamNames(prev => props.setFlagForKey(prev, effectiveName, true))
                props.recordValueHistory('query', effectiveName, next)
              }}
              onDeleteHistoryItem={next => props.deleteValueHistoryItem('query', effectiveName, next)}
              onClearAllHistory={props.clearAllValueHistory}
              historyMenuId={`query:${effectiveName}`}
              historyMenuOpenId={props.valueHistoryMenuOpenId}
              historyMenuAnchor={props.valueHistoryMenuAnchor}
              onToggleHistoryMenu={props.onToggleValueHistoryMenu}
              onCloseHistoryMenu={props.onCloseValueHistoryMenu}
              historyMenuPanelRef={props.valueHistoryMenuPanelRef}
              enumMenuId={isSpec ? `enum:query:${rawName}` : undefined}
              enumMenuOpenId={props.enumMenuOpenId}
              enumMenuAnchor={props.enumMenuAnchor}
              onToggleEnumMenu={props.onToggleEnumMenu}
              onCloseEnumMenu={props.onCloseEnumMenu}
              enumMenuPanelRef={props.enumMenuPanelRef}
              onChangeValue={nextValue => {
                props.setQueryParams(prev => {
                  const next = { ...prev }
                  next[effectiveName] = nextValue
                  if (isSpec && effectiveName !== rawName) delete next[rawName]
                  return next
                })
              }}
              onRename={
                isRequiredSpecKey
                  ? undefined
                  : nextName => {
                    const trimmed = nextName.trim()
                    if (trimmed === effectiveName) return

                    if (isSpec) {
                      if (!trimmed) {
                        props.setQueryParams(prev => {
                          if (!(effectiveName in prev) && !(rawName in prev)) return prev
                          const next = { ...prev }
                          delete next[effectiveName]
                          if (rawName !== effectiveName) delete next[rawName]
                          return next
                        })
                        props.setInactiveQueryParamNames(prev => {
                          let next = props.setFlagForKey(prev, effectiveName, true)
                          if (rawName !== effectiveName) next = props.setFlagForKey(next, rawName, true)
                          return next
                        })
                        return
                      }
                      props.setQueryParams(prev => props.renameStoreKey(prev, effectiveName, trimmed))
                      props.setInactiveQueryParamNames(prev => props.renameFlagKey(prev, effectiveName, trimmed))
                      props.setQueryParamKeyOverrides(prev => {
                        const next = { ...prev }
                        if (trimmed === rawName) delete next[rawName]
                        else next[rawName] = trimmed
                        return next
                      })
                      props.setInactiveQueryParamNames(prev => props.setFlagForKey(prev, trimmed, isActive))
                      props.setQueryKeyOrder(prev => props.replaceKeyInOrder(prev, effectiveName, trimmed))
                      return
                    }

                    if (!trimmed) {
                      props.setQueryDraftRows(prev => [...prev, { id: props.uid('qrow'), name: '', value, isActive: true }])
                      props.setQueryParams(prev => {
                        if (!(effectiveName in prev)) return prev
                        const next = { ...prev }
                        delete next[effectiveName]
                        return next
                      })
                      props.setInactiveQueryParamNames(prev => props.setFlagForKey(prev, effectiveName, true))
                      return
                    }

                    props.setQueryParams(prev => props.renameStoreKey(prev, effectiveName, trimmed))
                    props.setInactiveQueryParamNames(prev => props.renameFlagKey(prev, effectiveName, trimmed))
                    props.setQueryKeyOrder(prev => props.replaceKeyInOrder(prev, effectiveName, trimmed))
                  }
              }
              onDelete={isRequiredSpecKey ? () => {
                props.setQueryParams(prev => {
                  if (!Object.prototype.hasOwnProperty.call(prev, effectiveName)) return prev
                  if (prev[effectiveName] === '') return prev
                  return { ...prev, [effectiveName]: '' }
                })
              } : () => {
                const totalRows = props.queryParamsList.length + props.queryDraftRows.length
                const isLastRow = totalRows === 1

                if (isLastRow) {
                  if (isSpec) {
                    props.setQueryParams(prev => {
                      if (!(effectiveName in prev) && !(rawName in prev)) return prev
                      const next = { ...prev }
                      delete next[effectiveName]
                      if (rawName !== effectiveName) delete next[rawName]
                      return next
                    })
                    props.setInactiveQueryParamNames(prev => {
                      let next = props.setFlagForKey(prev, effectiveName, true)
                      if (rawName !== effectiveName) next = props.setFlagForKey(next, rawName, true)
                      return next
                    })
                    props.setQueryParamKeyOverrides(prev => {
                      if (!(rawName in prev)) return prev
                      const next = { ...prev }
                      delete next[rawName]
                      return next
                    })
                    props.setDisabledQueryParamNames(prev => ({ ...prev, [rawName]: true }))
                    props.setQueryDraftRows(prev => (prev.length ? prev : [{ id: props.uid('qrow'), name: '', value: '', isActive: true }]))
                    return
                  }

                  props.setQueryParams(prev => {
                    if (!(effectiveName in prev) && !(rawName in prev)) return prev
                    const next = { ...prev }
                    delete next[effectiveName]
                    if (rawName !== effectiveName) delete next[rawName]
                    return next
                  })
                  props.setQueryDraftRows(prev => (prev.length ? [{ ...prev[0], name: '', value: '', isActive: true }, ...prev.slice(1)] : [{ id: props.uid('qrow'), name: '', value: '', isActive: true }]))
                  props.setInactiveQueryParamNames(prev => {
                    let next = props.setFlagForKey(prev, effectiveName, true)
                    if (rawName !== effectiveName) next = props.setFlagForKey(next, rawName, true)
                    return next
                  })
                  return
                }

                props.setQueryParams(prev => {
                  if (!(effectiveName in prev) && !(rawName in prev)) return prev
                  const next = { ...prev }
                  delete next[effectiveName]
                  if (rawName !== effectiveName) delete next[rawName]
                  return next
                })
                props.setInactiveQueryParamNames(prev => {
                  let next = props.setFlagForKey(prev, effectiveName, true)
                  if (rawName !== effectiveName) next = props.setFlagForKey(next, rawName, true)
                  return next
                })
                if (isSpec) {
                  props.setQueryParamKeyOverrides(prev => {
                    if (!(rawName in prev)) return prev
                    const next = { ...prev }
                    delete next[rawName]
                    return next
                  })
                  props.setDisabledQueryParamNames(prev => ({ ...prev, [rawName]: true }))
                }
              }}
            />
          )
        })}

        {props.queryDraftRows.map(row => (
          <QueryDraftRow
            key={row.id}
            rowId={row.id}
            name={row.name}
            value={row.value}
            isActive={row.isActive}
            onToggleActive={isActive => props.setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive } : r)))}
            onChangeName={nextName => props.setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
            onChangeValue={nextValue => props.setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
            variableSuggestions={props.variableSuggestions}
            historyItems={props.valueHistory.query[row.name.trim()] ?? []}
            onRecordHistory={next => props.recordValueHistory('query', row.name, next)}
            onPickHistory={next => {
              props.setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: next } : r)))
              props.setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive: true } : r)))
              props.recordValueHistory('query', row.name, next)
            }}
            onDeleteHistoryItem={next => props.deleteValueHistoryItem('query', row.name, next)}
            onClearAllHistory={props.clearAllValueHistory}
            historyMenuId={`queryDraft:${row.id}`}
            historyMenuOpenId={props.valueHistoryMenuOpenId}
            historyMenuAnchor={props.valueHistoryMenuAnchor}
            onToggleHistoryMenu={props.onToggleValueHistoryMenu}
            onCloseHistoryMenu={props.onCloseValueHistoryMenu}
            historyMenuPanelRef={props.valueHistoryMenuPanelRef}
            onDelete={() => {
              props.setQueryDraftRows(prev => {
                if (prev.length === 1 && prev[0]?.id === row.id) {
                  if (props.queryParamsList.length > 0) return []
                  return [{ ...prev[0], name: '', value: '', isActive: true }]
                }
                return prev.filter(r => r.id !== row.id)
              })
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function RequestEditorHeadersTab(props: SharedMenuProps & {
  visibleHeaderParams: RequestParam[]
  headerSpecNames: Set<string>
  requestBaseHeaders: Record<string, string>
  envHeaders: Record<string, string>
  committedHeaders: Record<string, string>
  inactiveHeaderNames: Record<string, true>
  headerDraftRows: HeaderDraftRowState[]
  headerValueHistoryItems: string[]
  variableSuggestions: VariableSuggestion[]
  hasDisabledEnvOnlyHeaders: boolean
  hasAnyEditableVisibleHeaderRow: boolean
  findHeaderKeyCaseInsensitive: (headers: Record<string, unknown>, name: string) => string | undefined
  getHeaderCaseInsensitive: (headers: Record<string, string>, name: string) => string | undefined
  headerIsInactive: (inactiveHeaderNames: Record<string, true>, headerName: string) => boolean
  setFlagForHeaderName: (prev: Record<string, true>, headerNameRaw: string, active: boolean) => Record<string, true>
  deleteValueHistoryItem: (kind: 'header', key: string, value: string) => void
  recordValueHistory: (kind: 'header', key: string, value: string) => void
  setHeaderValueForRequest: (name: string, value: string) => void
  headerDraftSaveRef: MutableRefObject<{
    headerOverrides: Record<string, string>
    headerDraftRows: HeaderDraftRowState[]
    headerKeyOrder: string[]
    disabledHeaderNames: Record<string, true>
    inactiveHeaderNames: Record<string, true>
  }>
  persistHeaderDraftPatch: (patch: Partial<{
    headerOverrides: Record<string, string>
    headerDraftRows: HeaderDraftRowState[]
    headerKeyOrder: string[]
    disabledHeaderNames: Record<string, true>
    inactiveHeaderNames: Record<string, true>
  }>) => void
  setInactiveHeaderNames: Dispatch<SetStateAction<Record<string, true>>>
  setHeaderDraftRows: Dispatch<SetStateAction<HeaderDraftRowState[]>>
  setHeaderDraftRowsAndPersist: (updater: (prev: HeaderDraftRowState[]) => HeaderDraftRowState[]) => void
  setDisabledHeaderNames: Dispatch<SetStateAction<Record<string, true>>>
  setHeaderOverrides: Dispatch<SetStateAction<Record<string, string>>>
  setHeaderKeyOrder: Dispatch<SetStateAction<string[]>>
  replaceKeyInOrderCaseInsensitive: (prev: string[], fromKey: string, toKey: string) => string[]
  deleteHeaderCaseInsensitive: (headers: Record<string, unknown>, name: string) => boolean
  setHeaderCaseInsensitive: (headers: Record<string, string>, name: string, value: string) => void
  addHeaderDraftRow: () => void
  reloadFromGlobalHeaders: () => void
  uid: (prefix: string) => string
}) {
  return (
    <div className="accordion">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Headers</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="iconBtn addRowBtn"
            onClick={props.reloadFromGlobalHeaders}
            disabled={!props.hasDisabledEnvOnlyHeaders}
            aria-disabled={!props.hasDisabledEnvOnlyHeaders}
            aria-label="Reload from global headers"
            title={props.hasDisabledEnvOnlyHeaders ? 'Reload from global headers' : 'No deleted global headers'}
          >
            <ReloadIcon size={16} />
          </button>
          <button
            type="button"
            className="iconBtn addRowBtn"
            onClick={props.addHeaderDraftRow}
            aria-label="Add header"
            title="Add header"
          >
            <PlusIcon size={16} />
          </button>
        </div>
      </div>

      <div className="section">
        {props.visibleHeaderParams.map(h => {
          const isSpec = props.headerSpecNames.has(h.name)
          const baseKey = props.findHeaderKeyCaseInsensitive(props.requestBaseHeaders, h.name)
          const envKey = props.findHeaderKeyCaseInsensitive(props.envHeaders, h.name)
          const isInBase = !!baseKey
          const isInEnv = !!envKey
          const isEnvOnly = !isInBase && isInEnv
          const value = props.getHeaderCaseInsensitive(props.committedHeaders, h.name) ?? ''

          return (
            <HeaderRow
              key={h.name}
              name={h.name}
              value={value}
              readOnlyName={isSpec}
              required={isSpec ? h.required : false}
              isActive={!props.headerIsInactive(props.inactiveHeaderNames, h.name)}
              onToggleActive={isActive => {
                const nextInactiveHeaderNames = props.setFlagForHeaderName(props.headerDraftSaveRef.current.inactiveHeaderNames, h.name, isActive)
                props.setInactiveHeaderNames(nextInactiveHeaderNames)
                props.persistHeaderDraftPatch({ inactiveHeaderNames: nextInactiveHeaderNames })
              }}
              variableSuggestions={props.variableSuggestions}
              historyItems={props.headerValueHistoryItems}
              onRecordHistory={next => props.recordValueHistory('header', h.name, next)}
              onPickHistory={next => {
                props.setHeaderValueForRequest(h.name, next)
                props.recordValueHistory('header', h.name, next)
              }}
              onDeleteHistoryItem={next => props.deleteValueHistoryItem('header', h.name, next)}
              onClearAllHistory={props.clearAllValueHistory}
              historyMenuId={`header:${h.name}`}
              historyMenuOpenId={props.valueHistoryMenuOpenId}
              historyMenuAnchor={props.valueHistoryMenuAnchor}
              onToggleHistoryMenu={props.onToggleValueHistoryMenu}
              onCloseHistoryMenu={props.onCloseValueHistoryMenu}
              historyMenuPanelRef={props.valueHistoryMenuPanelRef}
              enumValues={isSpec ? h.enumValues : undefined}
              enumMenuId={isSpec ? `enum:header:${h.name}` : undefined}
              enumMenuOpenId={props.enumMenuOpenId}
              enumMenuAnchor={props.enumMenuAnchor}
              onToggleEnumMenu={props.onToggleEnumMenu}
              onCloseEnumMenu={props.onCloseEnumMenu}
              enumMenuPanelRef={props.enumMenuPanelRef}
              onChangeValue={nextValue => {
                props.setHeaderValueForRequest(h.name, nextValue)
              }}
              onRename={
                isSpec
                  ? undefined
                  : nextName => {
                    const nextKey = nextName.trim()
                    if (nextKey === h.name) return

                    if (!nextKey) {
                      const current = props.headerDraftSaveRef.current
                      const nextInactiveHeaderNames = props.setFlagForHeaderName(current.inactiveHeaderNames, h.name, true)
                      const nextHeaderDraftRows = [...current.headerDraftRows, { id: props.uid('hrow'), name: '', value, isActive: true }]
                      const nextDisabledHeaderNames: Record<string, true> = (isInBase || isInEnv)
                        ? { ...current.disabledHeaderNames, [h.name]: true }
                        : current.disabledHeaderNames
                      const nextHeaderOverrides = (() => {
                        const existingKey = props.findHeaderKeyCaseInsensitive(current.headerOverrides, h.name)
                        if (!existingKey) return current.headerOverrides
                        const next = { ...current.headerOverrides }
                        delete next[existingKey]
                        return next
                      })()
                      props.setInactiveHeaderNames(nextInactiveHeaderNames)
                      props.setHeaderDraftRows(nextHeaderDraftRows)
                      props.setDisabledHeaderNames(nextDisabledHeaderNames)
                      props.setHeaderOverrides(nextHeaderOverrides)
                      props.persistHeaderDraftPatch({
                        inactiveHeaderNames: nextInactiveHeaderNames,
                        headerDraftRows: nextHeaderDraftRows,
                        disabledHeaderNames: nextDisabledHeaderNames,
                        headerOverrides: nextHeaderOverrides,
                      })
                      return
                    }

                    if (props.findHeaderKeyCaseInsensitive(props.committedHeaders, nextKey)) return

                    const current = props.headerDraftSaveRef.current
                    const nextHeaderOverrides = (() => {
                      const next = { ...current.headerOverrides }
                      props.setHeaderCaseInsensitive(next, nextKey, value)
                      props.deleteHeaderCaseInsensitive(next, h.name)
                      return next
                    })()
                    const nextDisabledHeaderNames = (() => {
                      const next = { ...current.disabledHeaderNames }
                      if (isInBase || isInEnv) next[h.name] = true
                      props.deleteHeaderCaseInsensitive(next, nextKey)
                      return next
                    })()
                    const nextInactiveHeaderNames = (() => {
                      const wasInactive = props.headerIsInactive(current.inactiveHeaderNames, h.name)
                      let next = props.setFlagForHeaderName(current.inactiveHeaderNames, h.name, true)
                      if (wasInactive) next = props.setFlagForHeaderName(next, nextKey, false)
                      return next
                    })()
                    const nextHeaderKeyOrder = props.replaceKeyInOrderCaseInsensitive(current.headerKeyOrder, h.name, nextKey)
                    props.setHeaderOverrides(nextHeaderOverrides)
                    props.setDisabledHeaderNames(nextDisabledHeaderNames)
                    props.setInactiveHeaderNames(nextInactiveHeaderNames)
                    props.setHeaderKeyOrder(nextHeaderKeyOrder)
                    props.persistHeaderDraftPatch({
                      headerOverrides: nextHeaderOverrides,
                      disabledHeaderNames: nextDisabledHeaderNames,
                      inactiveHeaderNames: nextInactiveHeaderNames,
                      headerKeyOrder: nextHeaderKeyOrder,
                    })
                  }
              }
              onDelete={
                isSpec
                  ? h.required
                    ? () => props.setHeaderValueForRequest(h.name, '')
                    : undefined
                  : () => {
                    props.setInactiveHeaderNames(prev => props.setFlagForHeaderName(prev, h.name, true))
                    const shouldEnsureEmptyRowAfterDelete =
                      isEnvOnly && props.headerDraftRows.length === 0 && !props.hasAnyEditableVisibleHeaderRow

                    const totalRows = props.visibleHeaderParams.length + props.headerDraftRows.length
                    const isLastRow = totalRows === 1

                    if (isLastRow) {
                      if (isInBase || isInEnv) {
                        props.setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                        props.setHeaderOverrides(prev => {
                          const existingKey = props.findHeaderKeyCaseInsensitive(prev, h.name)
                          if (!existingKey) return prev
                          const { [existingKey]: _removed, ...rest } = prev
                          return rest
                        })
                      } else {
                        props.setHeaderOverrides(prev => {
                          const existingKey = props.findHeaderKeyCaseInsensitive(prev, h.name)
                          if (!existingKey) return prev
                          const { [existingKey]: _removed, ...rest } = prev
                          return rest
                        })
                      }
                      props.setHeaderDraftRows(prev => (prev.length ? [{ ...prev[0], name: '', value: '', isActive: true }, ...prev.slice(1)] : [{ id: props.uid('hrow'), name: '', value: '', isActive: true }]))
                      return
                    }

                    if (isInBase || isInEnv) {
                      props.setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                      props.setHeaderOverrides(prev => {
                        const existingKey = props.findHeaderKeyCaseInsensitive(prev, h.name)
                        if (!existingKey) return prev
                        const { [existingKey]: _removed, ...rest } = prev
                        return rest
                      })
                      if (shouldEnsureEmptyRowAfterDelete) {
                        props.setHeaderDraftRows(prev =>
                          prev.length ? prev : [{ id: props.uid('hrow'), name: '', value: '', isActive: true }],
                        )
                      }
                      return
                    }
                    props.setHeaderOverrides(prev => {
                      const existingKey = props.findHeaderKeyCaseInsensitive(prev, h.name)
                      if (!existingKey) return prev
                      const { [existingKey]: _removed, ...rest } = prev
                      return rest
                    })
                    if (shouldEnsureEmptyRowAfterDelete) {
                      props.setHeaderDraftRows(prev =>
                        prev.length ? prev : [{ id: props.uid('hrow'), name: '', value: '', isActive: true }],
                      )
                    }
                  }
              }
            />
          )
        })}

        {props.headerDraftRows.map(row => (
          <HeaderDraftRow
            key={row.id}
            rowId={row.id}
            name={row.name}
            value={row.value}
            isActive={row.isActive}
            onToggleActive={isActive => props.setHeaderDraftRowsAndPersist(prev => prev.map(r => (r.id === row.id ? { ...r, isActive } : r)))}
            onChangeName={nextName => props.setHeaderDraftRowsAndPersist(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
            onChangeValue={nextValue => props.setHeaderDraftRowsAndPersist(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
            variableSuggestions={props.variableSuggestions}
            historyItems={props.headerValueHistoryItems}
            onRecordHistory={next => props.recordValueHistory('header', row.name, next)}
            onPickHistory={next => {
              props.setHeaderDraftRowsAndPersist(prev => prev.map(r => (r.id === row.id ? { ...r, value: next } : r)))
              props.recordValueHistory('header', row.name, next)
            }}
            onDeleteHistoryItem={next => props.deleteValueHistoryItem('header', row.name, next)}
            onClearAllHistory={props.clearAllValueHistory}
            historyMenuId={`headerDraft:${row.id}`}
            historyMenuOpenId={props.valueHistoryMenuOpenId}
            historyMenuAnchor={props.valueHistoryMenuAnchor}
            onToggleHistoryMenu={props.onToggleValueHistoryMenu}
            onCloseHistoryMenu={props.onCloseValueHistoryMenu}
            historyMenuPanelRef={props.valueHistoryMenuPanelRef}
            onDelete={() => {
              props.setHeaderDraftRowsAndPersist(prev => {
                if (prev.length === 1 && prev[0]?.id === row.id) {
                  if (props.visibleHeaderParams.length > 0) return []
                  return [{ ...prev[0], name: '', value: '', isActive: true }]
                }
                return prev.filter(r => r.id !== row.id)
              })
            }}
          />
        ))}
      </div>
    </div>
  )
}
