import type { RequestItem } from '../collectionTree'
import type { CollectionRunItemReport } from './runCollection'

export type CollectionRunReportState = {
  collectionId: string
  collectionName: string
  startedAt: number
  finishedAt: number | null
  total: number
  completed: number
  passed: number
  failed: number
  canceled: boolean
  items: CollectionRunItemReport[]
}

export type CollectionRunHistoryEntry = {
  id: string
  createdAt: number
  report: CollectionRunReportState
}

export type CollectionRunSelectionItem = {
  id: string
  request: RequestItem
  folderPath: string
  enabled: boolean
}

export type CollectionRunSelectionState = {
  collectionId: string
  runLabel: string
  items: CollectionRunSelectionItem[]
}

export type CollectionRunnerQueueItem = {
  request: RequestItem
  folderPath: string
  iteration: number
}

export type CollectionRunnerQueuePlanItem = {
  requestId: string
  folderPath: string
  iteration: number
}

export type CollectionRunnerLastPlan = {
  collectionId: string
  runLabel: string
  queue: CollectionRunnerQueuePlanItem[]
}

export type CollectionRunnerTab = 'report' | 'history'
