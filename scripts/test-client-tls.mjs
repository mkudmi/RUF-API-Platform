import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ stdin: { contents: `
  export { desktopHttpRequest } from './src/shared/utils/desktopHttpRequest';
  export { getSystemClientTlsBindings, forgetSystemClientTlsBinding } from './src/shared/utils/systemClientTls';
  export { buildCurlCommand } from './src/modules/requestRunner/buildCurl';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
globalThis.window = new EventTarget()
let invoke
window.__TAURI_INTERNALS__ = { invoke: (...args) => invoke(...args) }
const thumbprint = 'AB'.repeat(20)
const secondThumbprint = 'CD'.repeat(20)
const response = { status: 200, statusText: 'OK', headers: [], bodyBase64: '', manualRedirects: true }
const request = { url: 'https://api.test/one', method: 'POST', headers: [['Authorization', 'Bearer test'], ['Content-Type', 'text/plain']], bodyBase64: btoa('payload') }
let prompts = 0
let sends = 0
invoke = async (command, payload) => {
  if (command === 'cert_select_system_client_identity') { prompts++; assert.equal(payload.origin, 'https://api.test'); return thumbprint }
  sends++
  if (!payload.args.systemClientCertThumbprint) throw 'RUF_CLIENT_CERT_REQUIRED'
  assert.equal(payload.args.systemClientCertThumbprint, thumbprint)
  return response
}
await api.desktopHttpRequest(request)
assert.equal(prompts, 1)
assert.equal(sends, 2)
await api.desktopHttpRequest(request)
assert.equal(prompts, 1)
assert.deepEqual(api.getSystemClientTlsBindings(), [{ origin: 'https://api.test', thumbprint }])
const curl = api.buildCurlCommand({ request: { method: 'GET', path: '/one' }, baseUrl: 'https://api.test', pathParams: {}, queryParams: {}, headers: {} })
assert.ok(curl.includes(`CurrentUser\\MY\\${thumbprint}`))

const hops = []
invoke = async (command, payload) => {
  if (command === 'cert_select_system_client_identity') { assert.equal(payload.origin, 'https://api.test:444'); return secondThumbprint }
  const args = payload.args
  hops.push(args)
  if (new URL(args.url).port === '') return { ...response, status: 302, headers: [['Location', 'https://api.test:444/two']] }
  assert.ok(!args.headers.some(([name]) => name.toLowerCase() === 'authorization'))
  assert.equal(args.method, 'GET')
  assert.equal(args.bodyBase64, undefined)
  if (!args.systemClientCertThumbprint) throw 'RUF_CLIENT_CERT_REQUIRED'
  assert.equal(args.systemClientCertThumbprint, secondThumbprint)
  return response
}
await api.desktopHttpRequest(request)
assert.equal(hops[1].systemClientCertThumbprint, undefined, 'identity must not cross ports')
assert.equal(api.getSystemClientTlsBindings().length, 2)
api.forgetSystemClientTlsBinding('https://api.test')
assert.equal(api.getSystemClientTlsBindings().length, 1)

let canceledSends = 0
invoke = async command => {
  if (command === 'cert_select_system_client_identity') return null
  canceledSends++
  throw 'RUF_CLIENT_CERT_REQUIRED'
}
await assert.rejects(api.desktopHttpRequest(request), { name: 'AbortError' })
assert.equal(canceledSends, 1, 'cancel must not resend the request')

let releaseSelection
let concurrentPrompts = 0
invoke = async (command, payload) => {
  if (command === 'cert_select_system_client_identity') {
    concurrentPrompts++
    return new Promise(resolve => { releaseSelection = resolve })
  }
  if (!payload.args.systemClientCertThumbprint) throw 'RUF_CLIENT_CERT_REQUIRED'
  return response
}
const a = api.desktopHttpRequest(request)
const b = api.desktopHttpRequest(request)
await new Promise(resolve => setImmediate(resolve))
assert.equal(concurrentPrompts, 1)
releaseSelection(thumbprint)
await Promise.all([a, b])

const controller = new AbortController()
api.forgetSystemClientTlsBinding('https://api.test')
let abortedSends = 0
invoke = async command => {
  if (command === 'cert_select_system_client_identity') { controller.abort(); return thumbprint }
  abortedSends++
  throw 'RUF_CLIENT_CERT_REQUIRED'
}
await assert.rejects(api.desktopHttpRequest(request, controller.signal), { name: 'AbortError' })
assert.equal(abortedSends, 1)
console.log('PASS: first-use selection, persistence, cURL, redirect/port isolation, cancellation, concurrent selection, abort')
