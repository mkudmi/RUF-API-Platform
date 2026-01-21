import type { Connect } from 'vite'
import type { ServerResponse } from 'node:http'
import pg, { type QueryConfig, type QueryResult, type QueryResultRow } from 'pg'
import mysql from 'mysql2/promise'

export function registerDbExecRoute(middlewares: Connect.Server) {
  middlewares.use('/__ruf/db/exec', async (req: Connect.IncomingMessage, res: ServerResponse) => {
    try {
      if ((req.method || 'GET').toUpperCase() !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
        return
      }

      const body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
      })

      let parsed: unknown
      try {
        parsed = JSON.parse(body.toString('utf8') || '{}')
      } catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        return
      }

      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      const type = typeof obj.type === 'string' ? obj.type : 'postgres'
      const connectionString = typeof obj.connectionString === 'string' ? obj.connectionString.trim() : ''
      const sql = typeof obj.sql === 'string' ? obj.sql.trim() : ''
      const timeoutMsRaw = typeof obj.timeoutMs === 'number' ? obj.timeoutMs : 15000
      const timeoutMs = clamp(Math.floor(timeoutMsRaw), 1000, 60000)

      if (!connectionString) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'Missing connectionString' }))
        return
      }

      if (!sql) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'Missing sql' }))
        return
      }

      if (type !== 'postgres') {
        if (type !== 'mysql') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: `Unsupported db type: ${type}` }))
          return
        }
      }

      if (type === 'postgres') {
        const { Client } = pg
        const client = new Client({ connectionString, connectionTimeoutMillis: timeoutMs })
        try {
          await withTimeout(client.connect(), timeoutMs, 'Connection timeout')
          type PgQueryResult = QueryResult<QueryResultRow>
          const queryConfig = ({ text: sql, queryMode: 'simple' } as unknown) as (QueryConfig<unknown[]> & { queryMode: 'simple' })
          const queryPromise = client.query(queryConfig) as unknown as Promise<PgQueryResult | PgQueryResult[]>
          const result = await withTimeout(queryPromise, timeoutMs, 'Query timeout')
          const rowCount = Array.isArray(result) ? result.reduce((sum, r) => sum + (r.rowCount || 0), 0) : (result.rowCount || 0)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, rowsAffected: rowCount }))
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Query failed'
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, message }))
        } finally {
          try {
            await client.end()
          } catch {
            // ignore
          }
        }
        return
      }

      if (type === 'mysql') {
        let u: URL
        try {
          u = new URL(connectionString)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'Invalid connectionString' }))
          return
        }

        if (u.protocol !== 'mysql:') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'MySQL connectionString must start with mysql://' }))
          return
        }

        const database = u.pathname?.startsWith('/') ? u.pathname.slice(1) : u.pathname
        const port = u.port ? Number(u.port) : 3306

        let conn: mysql.Connection | null = null
        try {
          conn = await withTimeout(
            mysql.createConnection({
              host: u.hostname,
              port,
              user: u.username || undefined,
              password: u.password || undefined,
              database: database || undefined,
              connectTimeout: timeoutMs,
              multipleStatements: true,
            }),
            timeoutMs,
            'Connection timeout',
          )
          const [rows] = await withTimeout(conn.query(sql), timeoutMs, 'Query timeout')
          const rowsAffected = computeMysqlRowsAffected(rows)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, rowsAffected }))
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Query failed'
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, message }))
        } finally {
          try {
            await conn?.end()
          } catch {
            // ignore
          }
        }
        return
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error'
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: message }))
    }
  })
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), timeoutMs)
    p.then(
      v => {
        clearTimeout(t)
        resolve(v)
      },
      e => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function computeMysqlRowsAffected(rows: unknown): number {
  if (!rows) return 0

  if (Array.isArray(rows)) {
    // With multiple statements, mysql2 returns an array of results. Each entry can be a row set (array) or an OkPacket-like object.
    return rows.reduce((sum, r) => sum + computeMysqlRowsAffected(r), 0)
  }

  if (typeof rows === 'object') {
    const obj = rows as Record<string, unknown>
    if (typeof obj.affectedRows === 'number') return obj.affectedRows
    if (typeof obj.changedRows === 'number') return obj.changedRows
  }

  return 0
}
