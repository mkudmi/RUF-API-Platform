import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ruf-dev-proxy',
      configureServer(server) {
        server.middlewares.use('/__ruf_proxy', async (req, res) => {
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
              else headers.set(k, v)
            }

            const method = (req.method || 'GET').toUpperCase()
            const hasBody = method !== 'GET' && method !== 'HEAD'
            const body = hasBody ? await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = []
              req.on('data', (c: Buffer) => chunks.push(c))
              req.on('end', () => resolve(Buffer.concat(chunks)))
              req.on('error', reject)
            }) : undefined

            const proxied = await fetch(u.toString(), {
              method,
              headers,
              body: body && body.length ? body : undefined,
              redirect: 'manual',
            })

            res.statusCode = proxied.status
            for (const [k, v] of proxied.headers.entries()) {
              const key = k.toLowerCase()
              if (key === 'transfer-encoding') continue
              res.setHeader(k, v)
            }

            const buf = Buffer.from(await proxied.arrayBuffer())
            res.end(buf)
          } catch (e: any) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(e?.message || 'Proxy error')
          }
        })
      },
    },
  ],
})
