import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { brotliCompressSync, gzipSync } from 'node:zlib'

if (process.platform !== 'win32') throw new Error('This test requires Windows')
const directory = mkdtempSync(join(tmpdir(), 'ruf-mtls-test-'))
const openssl = process.env.OPENSSL || (existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
const run = args => execFileSync(openssl, args, { cwd: directory, stdio: 'pipe', windowsHide: true })
let server
try {
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=Ruf temporary mTLS test', '-addext', 'extendedKeyUsage=clientAuth,serverAuth', '-addext', 'subjectAltName=IP:127.0.0.1'])
  run(['pkcs12', '-export', '-out', 'identity.p12', '-inkey', 'key.pem', '-in', 'cert.pem', '-passout', 'pass:test'])
  const cert = readFileSync(join(directory, 'cert.pem'))
  const version = process.env.RUF_TEST_TLS_VERSION || 'TLSv1.2'
  let receivedRequests = 0
  server = createServer({ key: readFileSync(join(directory, 'key.pem')), cert, ca: cert, requestCert: true, rejectUnauthorized: true, minVersion: version, maxVersion: version }, (request, response) => {
    receivedRequests++
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const encoding = process.env.RUF_TEST_ENCODING || 'gzip'
      response.setHeader('Content-Encoding', encoding)
      const compress = encoding === 'br' ? brotliCompressSync : gzipSync
      response.end(compress(JSON.stringify({ authorized: request.socket.authorized, method: request.method, body: Buffer.concat(chunks).toString('base64'), receivedRequests })))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const child = spawn('cargo', ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'system_tls_probe', '--', join(directory, 'identity.p12'), `https://127.0.0.1:${server.address().port}/`], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) },
  })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  if (code !== 0) throw new Error(`mTLS probe exited with ${code}`)
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  // Only the directory created by mkdtempSync above is removed.
  rmSync(directory, { recursive: true, force: true })
}
