import { tauriInvoke } from '../../../shared/utils/tauri'

export type LocalMockServerStatus = {
  running: boolean
  port: number
  baseUrl: string
  routesCount: number
}

export type LocalMockRouteArgs = {
  method: string
  path: string
  port?: number
  status: number
  headers?: Array<[string, string]>
  body: string
}

export type LocalMockRouteItem = {
  method: string
  path: string
  status: number
}

export const LOCAL_MOCK_PRIMARY_PORT = 7777
export const LOCAL_MOCK_METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const LOCAL_MOCK_TARGET_ORIGIN_KEY = 'ruf_local_mock_target_origin_v1'
const LOCAL_MOCK_ADDITIONAL_PORTS_KEY = 'ruf_local_mock_additional_ports_v1'
const LOCAL_MOCK_PREPARED_ROUTES_KEY = 'ruf_local_mock_prepared_routes_v1'
const LOCAL_MOCK_SERVER_UPDATED_EVENT = 'ruf:local-mock-server-updated'

export function getLocalMockPortOrPrimary(port: number | undefined | null): number {
  const n = Math.trunc(Number(port))
  if (!Number.isFinite(n) || n < 1024 || n > 65535) return LOCAL_MOCK_PRIMARY_PORT
  return n
}

export function getLocalMockServerBaseUrl(port: number, baseUrl?: string): string {
  const normalizedPort = getLocalMockPortOrPrimary(port)
  return baseUrl || `http://127.0.0.1:${normalizedPort}`
}

export function normalizeLocalMockHttpStatus(raw: string | number, fallback = 200): number {
  const parsed = typeof raw === 'number'
    ? Math.trunc(raw)
    : Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(100, Math.min(599, parsed))
}

export function normalizeLocalMockRoutePath(rawPath: string): string {
  const pathRaw = (rawPath || '/').trim()
  if (!pathRaw) return '/'
  return pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`
}

export function normalizeLocalMockRouteBodyToJson(rawBody: string): string {
  const raw = (rawBody || '').trim()
  if (!raw) return '{}'
  const tryParse = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return null
    }
  }
  const parsedDirect = tryParse(raw)
  if (parsedDirect) return parsedDirect
  const unescaped = raw
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"')
    .replaceAll('\\t', '\t')
  const parsedUnescaped = tryParse(unescaped)
  if (parsedUnescaped) return parsedUnescaped
  return JSON.stringify({ message: raw }, null, 2)
}

function emitLocalMockServerUpdated() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LOCAL_MOCK_SERVER_UPDATED_EVENT))
}

export function onLocalMockServerUpdated(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener()
  window.addEventListener(LOCAL_MOCK_SERVER_UPDATED_EVENT, handler)
  return () => window.removeEventListener(LOCAL_MOCK_SERVER_UPDATED_EVENT, handler)
}

export async function getLocalMockServerStatus(): Promise<LocalMockServerStatus> {
  return await tauriInvoke<LocalMockServerStatus>('mocker_server_status')
}

export async function startLocalMockServer(port?: number): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_start', {
    args: { port },
  })
  emitLocalMockServerUpdated()
  return out
}

export async function stopLocalMockServer(): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_stop')
  emitLocalMockServerUpdated()
  return out
}

export async function setLocalMockRoute(args: LocalMockRouteArgs): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_set_route', {
    args,
  })
  emitLocalMockServerUpdated()
  return out
}

export async function listLocalMockRoutes(port?: number): Promise<LocalMockRouteItem[]> {
  return await tauriInvoke<LocalMockRouteItem[]>('mocker_server_list_routes', {
    args: port ? { port } : undefined,
  })
}

export async function deleteLocalMockRoute(args: { method: string; path: string; port?: number }): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_delete_route', {
    args,
  })
  emitLocalMockServerUpdated()
  return out
}

export async function getLocalMockServerLogs(port?: number): Promise<string[]> {
  return await tauriInvoke<string[]>('mocker_server_logs', {
    args: port ? { port } : undefined,
  })
}

export function setLocalMockTargetOrigin(originRaw: string): void {
  if (typeof window === 'undefined') return
  const raw = (originRaw || '').trim()
  if (!raw) {
    localStorage.removeItem(LOCAL_MOCK_TARGET_ORIGIN_KEY)
    return
  }
  try {
    const normalized = new URL(raw).origin
    localStorage.setItem(LOCAL_MOCK_TARGET_ORIGIN_KEY, normalized)
  } catch {
    localStorage.removeItem(LOCAL_MOCK_TARGET_ORIGIN_KEY)
  }
}

export function getLocalMockTargetOrigin(): string {
  if (typeof window === 'undefined') return ''
  const raw = localStorage.getItem(LOCAL_MOCK_TARGET_ORIGIN_KEY)
  if (!raw) return ''
  try {
    return new URL(raw).origin
  } catch {
    return ''
  }
}

function normalizeAdditionalPorts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<number>()
  for (const item of raw) {
    const n = Number(item)
    if (!Number.isInteger(n)) continue
    if (n < 1024 || n > 65535) continue
    if (n === LOCAL_MOCK_PRIMARY_PORT) continue
    out.add(n)
  }
  return Array.from(out).sort((a, b) => a - b)
}

function readConfiguredAdditionalPorts(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_MOCK_ADDITIONAL_PORTS_KEY)
    if (!raw) return []
    return normalizeAdditionalPorts(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeConfiguredAdditionalPorts(ports: number[]): void {
  if (typeof window === 'undefined') return
  if (!ports.length) {
    localStorage.removeItem(LOCAL_MOCK_ADDITIONAL_PORTS_KEY)
    emitLocalMockServerUpdated()
    return
  }
  localStorage.setItem(LOCAL_MOCK_ADDITIONAL_PORTS_KEY, JSON.stringify(ports))
  emitLocalMockServerUpdated()
}

export function listConfiguredLocalMockAdditionalPorts(): number[] {
  return readConfiguredAdditionalPorts()
}

export function addConfiguredLocalMockAdditionalPort(port: number): void {
  const n = Math.trunc(Number(port))
  if (!Number.isFinite(n) || n < 1024 || n > 65535 || n === LOCAL_MOCK_PRIMARY_PORT) return
  const current = readConfiguredAdditionalPorts()
  if (current.includes(n)) return
  writeConfiguredAdditionalPorts([...current, n].sort((a, b) => a - b))
}

export function removeConfiguredLocalMockAdditionalPort(port: number): void {
  const n = Math.trunc(Number(port))
  if (!Number.isFinite(n)) return
  const next = readConfiguredAdditionalPorts().filter(x => x !== n)
  writeConfiguredAdditionalPorts(next)
}

export async function listLocalMockAdditionalServers(): Promise<LocalMockServerStatus[]> {
  return await tauriInvoke<LocalMockServerStatus[]>('mocker_server_additional_list')
}

export async function startLocalMockAdditionalServer(port?: number): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_additional_start', {
    args: { port },
  })
  emitLocalMockServerUpdated()
  return out
}

export async function stopLocalMockAdditionalServer(port: number): Promise<LocalMockServerStatus[]> {
  const out = await tauriInvoke<LocalMockServerStatus[]>('mocker_server_additional_stop', {
    args: { port },
  })
  emitLocalMockServerUpdated()
  return out
}

type PreparedRoutesStore = Record<string, LocalMockRouteArgs[]>

function normalizePreparedRoute(raw: unknown): LocalMockRouteArgs | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const method = String(item.method ?? '').trim().toUpperCase()
  const path = String(item.path ?? '').trim()
  const body = String(item.body ?? '')
  const status = normalizeLocalMockHttpStatus(Number(item.status), 200)
  const port = getLocalMockPortOrPrimary(Number(item.port))
  const headersRaw = Array.isArray(item.headers) ? item.headers : []
  const headers: Array<[string, string]> = headersRaw
    .map(entry => (Array.isArray(entry) && entry.length >= 2 ? [String(entry[0] ?? ''), String(entry[1] ?? '')] as [string, string] : null))
    .filter((x): x is [string, string] => !!x)

  if (!method || !path) return null
  return { method, path, body, status, port, headers }
}

function readPreparedRoutesStore(): PreparedRoutesStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LOCAL_MOCK_PREPARED_ROUTES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: PreparedRoutesStore = {}
    for (const [portKey, items] of Object.entries(parsed || {})) {
      const list = Array.isArray(items) ? items.map(normalizePreparedRoute).filter((x): x is LocalMockRouteArgs => !!x) : []
      if (list.length) out[portKey] = list
    }
    return out
  } catch {
    return {}
  }
}

function writePreparedRoutesStore(store: PreparedRoutesStore): void {
  if (typeof window === 'undefined') return
  const entries = Object.entries(store).filter(([, list]) => Array.isArray(list) && list.length > 0)
  if (!entries.length) {
    localStorage.removeItem(LOCAL_MOCK_PREPARED_ROUTES_KEY)
    emitLocalMockServerUpdated()
    return
  }
  localStorage.setItem(LOCAL_MOCK_PREPARED_ROUTES_KEY, JSON.stringify(Object.fromEntries(entries)))
  emitLocalMockServerUpdated()
}

export function addPreparedLocalMockRoute(args: LocalMockRouteArgs): void {
  const normalized = normalizePreparedRoute(args)
  if (!normalized) return
  const port = normalized.port ?? LOCAL_MOCK_PRIMARY_PORT
  const key = String(port)
  const store = readPreparedRoutesStore()
  const prev = store[key] ?? []
  const deduped = prev.filter(item => !(item.method === normalized.method && item.path === normalized.path))
  store[key] = [...deduped, normalized]
  writePreparedRoutesStore(store)
}

export function listPreparedLocalMockRoutes(port: number): LocalMockRouteArgs[] {
  const key = String(getLocalMockPortOrPrimary(Number(port)))
  const store = readPreparedRoutesStore()
  return store[key] ?? []
}

export function removePreparedLocalMockRoute(args: { port: number; method: string; path: string }): void {
  const key = String(getLocalMockPortOrPrimary(Number(args.port)))
  const method = (args.method || '').trim().toUpperCase()
  const path = (args.path || '').trim()
  if (!method || !path) return
  const store = readPreparedRoutesStore()
  const prev = store[key] ?? []
  const next = prev.filter(item => !(item.method === method && item.path === path))
  if (next.length === prev.length) return
  if (next.length) {
    store[key] = next
  } else {
    delete store[key]
  }
  writePreparedRoutesStore(store)
}

export function clearPreparedLocalMockRoutes(port: number): void {
  const key = String(getLocalMockPortOrPrimary(Number(port)))
  const store = readPreparedRoutesStore()
  if (!(key in store)) return
  delete store[key]
  writePreparedRoutesStore(store)
}

export async function applyPreparedLocalMockRoutes(port: number): Promise<number> {
  const prepared = listPreparedLocalMockRoutes(port)
  if (!prepared.length) return 0
  for (const route of prepared) {
    await setLocalMockRoute({
      ...route,
      port,
    })
  }
  return prepared.length
}
