import type { ModuleContext } from '../contracts/moduleContext'
import { appendRequestHistoryItem, loadRequestHistoryByRequestId, saveRequestHistoryByRequestId } from '../../shared/utils/requestHistory'
import { loadAppSettings, saveAppSettings } from '../../shared/utils/appSettings'
import { loadCollections, loadEnvironmentsByCollection, saveCollections, saveEnvironmentsByCollection } from '../../shared/utils/storage'
import { loadWorkspace, saveWorkspace } from '../../shared/utils/workspaceStorage'

export function createDefaultModuleContext(): ModuleContext {
  const runtime = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  return {
    repositories: {
      collections: {
        load: () => loadCollections(),
        save: collections => saveCollections(collections),
      },
      workspace: {
        load: () => loadWorkspace(),
        save: workspace => saveWorkspace(workspace),
      },
      environments: {
        loadByCollection: () => loadEnvironmentsByCollection(),
        saveByCollection: envs => saveEnvironmentsByCollection(envs),
      },
      history: {
        loadByRequestId: () => loadRequestHistoryByRequestId(),
        saveByRequestId: history => saveRequestHistoryByRequestId(history),
        append: args => appendRequestHistoryItem(args),
      },
      settings: {
        load: () => loadAppSettings(),
        save: settings => saveAppSettings(settings),
      },
    },
    clocks: {
      now: () => Date.now(),
    },
    runtime: {
      requestIdle: (cb, timeoutMs = 1200) => {
        if (typeof runtime.requestIdleCallback === 'function') {
          const handle = runtime.requestIdleCallback(cb, { timeout: timeoutMs })
          return {
            cancel: () => {
              if (typeof runtime.cancelIdleCallback === 'function') runtime.cancelIdleCallback(handle)
            },
          }
        }

        const handle = window.setTimeout(cb, 0)
        return { cancel: () => window.clearTimeout(handle) }
      },
    },
    transforms: {
      applyRunResultToHistoryItem: (item, result) => ({
        ...item,
        responseStatus: result.status,
        responseStatusText: result.statusText,
      }),
    },
  }
}
