import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as http from 'node:http'
import * as https from 'node:https'

async function fetchViaNodeHttp(args: {
  url: URL
  method: string
  headers: Record<string, string>
  body?: Buffer
  insecureTls: boolean
}): Promise<{ status: number, headers: Record<string, string>, body: Buffer }> {
  const u = args.url
  const isHttps = u.protocol === 'https:'
  const transport = isHttps ? https : http

  return await new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port ? Number(u.port) : (isHttps ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: args.method,
      headers: args.headers,
      ...(isHttps ? { rejectUnauthorized: !args.insecureTls } : {}),
    }, (resp) => {
      const chunks: Buffer[] = []
      resp.on('data', (c: Buffer) => chunks.push(c))
      resp.on('end', () => {
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(resp.headers)) {
          if (v === undefined) continue
          if (Array.isArray(v)) headers[k] = v.join(',')
          else headers[k] = String(v)
        }
        resolve({
          status: resp.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks),
        })
      })
    })
    req.on('error', reject)
    if (args.body && args.body.length) req.write(args.body)
    req.end()
  })
}

async function registerProxyRoute(middlewares: any) {
  middlewares.use('/__ruf_proxy', async (req: any, res: any) => {
    try {
      const rawUrl = req.url || ''
      const full = new URL(rawUrl, 'http://localhost')
      const target = full.searchParams.get('url') || ''
      if (!target) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Missing ?url=')
        return
      }

      const insecure = ['1', 'true', 'yes'].includes((full.searchParams.get('insecure') || '').toLowerCase())

      let u: URL
      try {
        u = new URL(target)
      } catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Invalid url')
        return
      }

      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Only http/https supported')
        return
      }

      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        const key = k.toLowerCase()
        if (key === 'host' || key === 'origin' || key === 'referer' || key === 'content-length') continue
        if (Array.isArray(v)) headers.set(k, v.join(','))
        else headers.set(k, v as any)
      }

      const method = (req.method || 'GET').toUpperCase()
      const hasBody = method !== 'GET' && method !== 'HEAD'
      const body = hasBody ? await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
      }) : undefined

      const proxied = await fetchViaNodeHttp({
        url: u,
        method,
        headers: Object.fromEntries(headers.entries()),
        body: body && body.length ? body : undefined,
        insecureTls: insecure && u.protocol === 'https:',
      })

      res.statusCode = proxied.status
      for (const [k, v] of Object.entries(proxied.headers)) {
        const key = k.toLowerCase()
        if (key === 'transfer-encoding') continue
        res.setHeader(k, v)
      }

      res.end(proxied.body)
    } catch (e: any) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(e?.message || 'Proxy error')
    }
  })
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  plugins: [
    react(),
    {
      name: 'ruf-dev-proxy',
      configureServer(server) {
        void registerProxyRoute(server.middlewares)
      },
      configurePreviewServer(server) {
        void registerProxyRoute(server.middlewares)
      },
    },
  ],
})
