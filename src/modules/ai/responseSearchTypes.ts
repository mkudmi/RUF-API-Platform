export type ResponseSearchSnapshot = {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    bodyText: string
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText: string
    timeMs: number
  }
}

export type ScalarFieldKind = 'string' | 'number' | 'boolean' | 'null'

export type ScalarFieldCandidate = {
  absolutePath: string
  relativePath: string
  arrayPath: string | null
  kind: ScalarFieldKind
  samples: string[]
}

export type SearchSemanticState = 'active' | 'inactive' | 'archived' | 'failed' | 'open' | 'closed'

export type SearchIntent =
  | {
    kind: 'comparison'
    rawQuery: string
    fieldHint: string | null
    op: '>' | '>=' | '<' | '<='
    value: number
  }
  | {
    kind: 'date'
    rawQuery: string
    fieldHint: string | null
    op: 'on' | 'before' | 'after'
    value: string
  }
  | {
    kind: 'semantic_state'
    rawQuery: string
    fieldHint: string | null
    value: SearchSemanticState
  }
  | {
    kind: 'equals'
    rawQuery: string
    fieldHint: string | null
    value: string | number | boolean
  }
  | {
    kind: 'contains'
    rawQuery: string
    fieldHint: string | null
    value: string
  }

export type PlannedSearchQuery = {
  intent: SearchIntent
  query: string
  source: 'heuristic'
  resolver: string
}
