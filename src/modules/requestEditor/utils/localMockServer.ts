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
  status: number
  headers?: Array<[string, string]>
  body: string
}

export type LocalMockRouteItem = {
  method: string
  path: string
  status: number
}

const LOCAL_MOCK_TARGET_ORIGIN_KEY = 'ruf_local_mock_target_origin_v1'
const LOCAL_MOCK_SERVER_UPDATED_EVENT = 'ruf:local-mock-server-updated'

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

export async function listLocalMockRoutes(): Promise<LocalMockRouteItem[]> {
  return await tauriInvoke<LocalMockRouteItem[]>('mocker_server_list_routes')
}

export async function deleteLocalMockRoute(args: { method: string; path: string }): Promise<LocalMockServerStatus> {
  const out = await tauriInvoke<LocalMockServerStatus>('mocker_server_delete_route', {
    args,
  })
  emitLocalMockServerUpdated()
  return out
}

export async function getLocalMockServerLogs(): Promise<string[]> {
  return await tauriInvoke<string[]>('mocker_server_logs')
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
