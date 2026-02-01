import type { Connect } from 'vite'
import type { ServerResponse } from 'node:http'
import pg from 'pg'
import mysql from 'mysql2/promise'
import type { ConnectionOptions } from 'node:tls'

export function registerDbTestRoute(middlewares: Connect.Server) {
  middlewares.use('/__ruf/db/test', async (req: Connect.IncomingMessage, res: ServerResponse) => {
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
      const timeoutMsRaw = typeof obj.timeoutMs === 'number' ? obj.timeoutMs : 5000
      const timeoutMs = clamp(Math.floor(timeoutMsRaw), 1000, 30000)
      const caCertsPemRaw = Array.isArray(obj.caCertsPem) ? obj.caCertsPem : []
      const caCertsPem = caCertsPemRaw.filter(x => typeof x === 'string' && x.trim()).map(x => String(x))

      if (!connectionString) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'Missing connectionString' }))
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
        const ssl = getPgSslFromConnectionString(connectionString, caCertsPem)
        const client = new Client({ connectionString, connectionTimeoutMillis: timeoutMs, ...(ssl ? { ssl } : {}) })

        try {
          await withTimeout(client.connect(), timeoutMs, 'Connection timeout')
          await withTimeout(client.query('SELECT 1 as ok'), timeoutMs, 'Query timeout')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Connection failed'
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
            }),
            timeoutMs,
            'Connection timeout',
          )
          await withTimeout(conn.query('SELECT 1 as ok'), timeoutMs, 'Query timeout')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Connection failed'
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

function getPgSslFromConnectionString(connectionString: string, caCertsPem: string[]): boolean | ConnectionOptions | undefined {
  let u: URL
  try {
    u = new URL(connectionString)
  } catch {
    return undefined
  }

  const raw = (u.searchParams.get('sslmode') || u.searchParams.get('ssl-mode') || '').toLowerCase().replaceAll('_', '-')

  if (!raw || raw === 'prefer' || raw === 'allow' || raw === 'disable') return undefined

  const ca = caCertsPem.length ? caCertsPem.join('\n') : undefined

  if (raw === 'require') return { rejectUnauthorized: false, ...(ca ? { ca } : {}) }

  if (raw === 'verify-ca') return { rejectUnauthorized: true, ...(ca ? { ca } : {}), checkServerIdentity: () => undefined }

  if (raw === 'verify-full') return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }

  return undefined
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
