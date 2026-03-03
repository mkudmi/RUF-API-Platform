export type SyntheticDataType = 'string' | 'int' | 'float' | 'uuid' | 'date' | 'date-time' | 'email'

export const SYNTHETIC_DATA_TYPE_OPTIONS: Array<{ value: SyntheticDataType, label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'int', label: 'int' },
  { value: 'float', label: 'float' },
  { value: 'uuid', label: 'uuid' },
  { value: 'date', label: 'date' },
  { value: 'date-time', label: 'date-time' },
  { value: 'email', label: 'email' },
]

function randomNumberFraction(): number {
  const anyCrypto: Crypto | undefined = ('crypto' in globalThis) ? globalThis.crypto : undefined
  if (anyCrypto?.getRandomValues) {
    const bytes = new Uint32Array(1)
    anyCrypto.getRandomValues(bytes)
    return bytes[0] / 0xffffffff
  }
  return Math.random()
}

function randomIntInRange(min: number, max: number): number {
  const safeMin = Math.ceil(Math.min(min, max))
  const safeMax = Math.floor(Math.max(min, max))
  if (safeMax <= safeMin) return safeMin
  return safeMin + Math.floor(randomNumberFraction() * (safeMax - safeMin + 1))
}

function randomAlphaNumeric(length: number): string {
  const size = Math.max(0, Math.min(Math.floor(length), 100000))
  if (!size) return ''

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const anyCrypto: Crypto | undefined = ('crypto' in globalThis) ? globalThis.crypto : undefined
  if (anyCrypto?.getRandomValues) {
    const bytes = new Uint8Array(size)
    anyCrypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length]
    return out
  }

  let out = ''
  for (let i = 0; i < size; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function randomUuidValue(): string {
  const anyCrypto: Crypto | undefined = ('crypto' in globalThis) ? globalThis.crypto : undefined
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (anyCrypto?.getRandomValues) anyCrypto.getRandomValues(bytes)
  else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

export function generateSyntheticValue(args: {
  type: SyntheticDataType
  stringLength: number
  min: number
  max: number
  floatPrecision: number
}): string {
  switch (args.type) {
    case 'string':
      return randomAlphaNumeric(args.stringLength)
    case 'int':
      return String(randomIntInRange(args.min, args.max))
    case 'float': {
      const safePrecision = Math.max(0, Math.min(Math.floor(args.floatPrecision), 8))
      const low = Math.min(args.min, args.max)
      const high = Math.max(args.min, args.max)
      if (high <= low) return low.toFixed(safePrecision)
      const value = low + randomNumberFraction() * (high - low)
      return value.toFixed(safePrecision)
    }
    case 'uuid':
      return randomUuidValue()
    case 'date': {
      const value = new Date()
      value.setDate(value.getDate() + randomIntInRange(-365, 365))
      return value.toISOString().slice(0, 10)
    }
    case 'date-time': {
      const value = new Date(Date.now() + randomIntInRange(-30 * 24 * 60 * 60, 30 * 24 * 60 * 60) * 1000)
      return value.toISOString()
    }
    case 'email':
      return `${randomAlphaNumeric(10).toLowerCase()}@example.test`
    default:
      return ''
  }
}
