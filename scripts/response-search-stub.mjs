#!/usr/bin/env node
import { createServer } from 'node:http'

const portRaw = process.env.RESPONSE_SEARCH_STUB_PORT || process.argv[2] || '7788'
const port = Number.parseInt(String(portRaw), 10)

if (!Number.isFinite(port) || port < 1024 || port > 65535) {
  console.error(`Invalid port: ${portRaw}`)
  process.exit(1)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

function routeSummary(baseUrl, name, path, notes) {
  return { name, path, url: `${baseUrl}${path}`, notes }
}

function buildCases(baseUrl) {
  return [
    routeSummary(baseUrl, 'section-codes', '/api/section-codes', [
      'Root object with values[] collection and repeated digits in dates.',
      'Useful for testing filtered collection reconstruction and precise highlighting.',
    ]),
    routeSummary(baseUrl, 'orders', '/api/orders', [
      'Root object with items[] collection and several status/type fields.',
      'Useful for testing AI field inference when list names differ.',
    ]),
    routeSummary(baseUrl, 'nested-records', '/api/nested-records', [
      'Nested collection under payload.records[].',
      'Useful for testing preserved shape on nested collection filtering.',
    ]),
    routeSummary(baseUrl, 'audit-events', '/api/audit-events', [
      'Array-heavy response with mixed numbers, booleans, strings, and date fragments.',
      'Useful for testing false-positive value highlighting and match counting.',
    ]),
    routeSummary(baseUrl, 'single-match-envelope', '/api/single-match-envelope', [
      'Root object with rows[] where one filter usually returns a single row.',
      'Useful for testing single-match behavior without losing the collection field.',
    ]),
  ]
}

function buildSectionCodesCase() {
  return {
    request_id: 'search-case-section-codes',
    generated_at: '2026-06-01T10:02:20Z',
    meta: {
      source: 'response-search-stub',
      schema_version: 1,
      page: 1,
      total: 4,
    },
    values: [
      {
        id: 'row-101',
        section_code: '1',
        posted_at: '2026-02-14T09:12:00Z',
        customer_name: 'Alpha North',
        amount: 1200,
        flags: ['new', 'priority'],
      },
      {
        id: 'row-102',
        section_code: '2',
        posted_at: '2026-02-17T10:45:00Z',
        customer_name: 'Beta West',
        amount: 2200,
        flags: ['retry'],
      },
      {
        id: 'row-103',
        section_code: '2',
        posted_at: '2026-12-02T08:30:00Z',
        customer_name: 'Gamma East',
        amount: 3200,
        flags: ['priority', 'manual'],
      },
      {
        id: 'row-104',
        section_code: '1',
        posted_at: '2026-03-22T18:05:00Z',
        customer_name: 'Delta South',
        amount: 4200,
        flags: [],
      },
    ],
  }
}

function buildOrdersCase() {
  return {
    response_info: {
      request_id: 'search-case-orders',
      generated_at: '2026-06-01T10:03:00Z',
    },
    items: [
      {
        order_id: 'SO-2001',
        order_type: 'retail',
        order_status: 'processing',
        customer: { segment: 'b2c', city: 'Moscow' },
        created_at: '2026-05-20T11:10:00Z',
        line_count: 2,
      },
      {
        order_id: 'SO-2002',
        order_type: 'wholesale',
        order_status: 'failed',
        customer: { segment: 'b2b', city: 'Kazan' },
        created_at: '2026-05-21T12:20:00Z',
        line_count: 5,
      },
      {
        order_id: 'SO-2003',
        order_type: 'retail',
        order_status: 'failed',
        customer: { segment: 'b2c', city: 'Perm' },
        created_at: '2026-05-22T13:30:00Z',
        line_count: 1,
      },
    ],
    summary: {
      total_items: 3,
      failed_items: 2,
    },
  }
}

function buildNestedRecordsCase() {
  return {
    payload: {
      records: [
        {
          code: 'A-1',
          status: 'active',
          owner: { team: 'north', code: '2' },
          updated_at: '2026-04-02T09:00:00Z',
        },
        {
          code: 'A-2',
          status: 'archived',
          owner: { team: 'south', code: '1' },
          updated_at: '2026-04-12T11:15:00Z',
        },
        {
          code: 'A-3',
          status: 'active',
          owner: { team: 'west', code: '2' },
          updated_at: '2026-04-22T17:40:00Z',
        },
      ],
      page_info: {
        page: 1,
        total: 3,
      },
    },
    trace_id: 'trace-search-nested-records',
  }
}

function buildAuditEventsCase() {
  return {
    trace_id: 'trace-audit-2026-06-01',
    events: [
      {
        event_id: 1201,
        event_type: 'LOGIN',
        severity: 'info',
        actor_id: 'user-2',
        created_at: '2026-06-01T08:02:00Z',
        success: true,
      },
      {
        event_id: 1202,
        event_type: 'SYNC',
        severity: 'warning',
        actor_id: 'user-7',
        created_at: '2026-06-01T08:12:00Z',
        success: false,
      },
      {
        event_id: 1203,
        event_type: 'SYNC',
        severity: 'warning',
        actor_id: 'user-2',
        created_at: '2026-06-01T08:22:00Z',
        success: false,
      },
    ],
    counters: {
      warning: 2,
      failed: 2,
    },
  }
}

function buildSingleMatchEnvelopeCase() {
  return {
    page: 1,
    rows: [
      {
        row_id: 'R-1',
        category_code: 'A',
        is_primary: false,
        effective_date: '2026-01-02',
      },
      {
        row_id: 'R-2',
        category_code: 'B',
        is_primary: true,
        effective_date: '2026-01-12',
      },
      {
        row_id: 'R-3',
        category_code: 'C',
        is_primary: false,
        effective_date: '2026-01-22',
      },
    ],
  }
}

function buildResponse(pathname, baseUrl) {
  if (pathname === '/__health') {
    return { status: 200, payload: { ok: true, service: 'response-search-stub', now: new Date().toISOString() } }
  }

  if (pathname === '/__cases') {
    return { status: 200, payload: { service: 'response-search-stub', cases: buildCases(baseUrl) } }
  }

  if (pathname === '/api/section-codes') {
    return { status: 200, payload: buildSectionCodesCase() }
  }

  if (pathname === '/api/orders') {
    return { status: 200, payload: buildOrdersCase() }
  }

  if (pathname === '/api/nested-records') {
    return { status: 200, payload: buildNestedRecordsCase() }
  }

  if (pathname === '/api/audit-events') {
    return { status: 200, payload: buildAuditEventsCase() }
  }

  if (pathname === '/api/single-match-envelope') {
    return { status: 200, payload: buildSingleMatchEnvelopeCase() }
  }

  return {
    status: 404,
    payload: {
      error: 'route not found',
      path: pathname,
      available: buildCases(baseUrl).map(item => item.path),
    },
  }
}

const server = createServer((req, res) => {
  const method = req.method || 'GET'
  const host = req.headers.host || `127.0.0.1:${port}`
  const url = new URL(req.url || '/', `http://${host}`)
  const baseUrl = `http://127.0.0.1:${port}`

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    res.end()
    return
  }

  if (method !== 'GET') {
    sendJson(res, 405, {
      error: 'method not allowed',
      method,
      allowed_methods: ['GET'],
    })
    return
  }

  const result = buildResponse(url.pathname, baseUrl)
  sendJson(res, result.status, result.payload)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`response-search-stub listening on http://127.0.0.1:${port}`)
  console.log(`cases: http://127.0.0.1:${port}/__cases`)
})

