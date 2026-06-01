import { planResponseSearchQuery } from './responseSearchPlanner'
import type { ResponseSearchSnapshot } from './responseSearchTypes'

export function buildHeuristicResponseSearchQuery(snapshot: ResponseSearchSnapshot, userQuery: string): string | null {
  return planResponseSearchQuery(snapshot, userQuery)?.query ?? null
}
