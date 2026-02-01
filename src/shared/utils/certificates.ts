function normalizePemBlock(pem: string): string {
  const s = pem.replaceAll('\r\n', '\n').trim()
  return s.endsWith('\n') ? s : `${s}\n`
}

export function extractPemCertificates(input: string): string[] {
  const s = input.replaceAll('\r\n', '\n')
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
  const matches = s.match(re) ?? []
  return matches.map(normalizePemBlock).filter(Boolean)
}

export function pemToDerBytes(pem: string): Uint8Array {
  const s = pem.replaceAll('\r\n', '\n')
  const m = s.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/)
  if (!m) throw new Error('Invalid PEM: missing BEGIN/END CERTIFICATE')
  const b64 = (m[1] || '').replaceAll(/\s+/g, '')
  if (!b64) throw new Error('Invalid PEM: empty body')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return bytesToHex(new Uint8Array(digest))
}

export function formatSha256Fingerprint(hex: string): string {
  const clean = hex.replaceAll(/[^0-9a-f]/gi, '').toLowerCase()
  if (clean.length !== 64) return hex
  return clean.match(/.{1,2}/g)?.join(':') ?? hex
}
