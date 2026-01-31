import type { Collection, Folder, RequestItem } from '../../collectionTree'
import { uid } from '../../../shared/utils/id'
import { isAbsoluteUrl } from '../../../shared/utils/url'

function firstText(el: Element | null | undefined): string {
  if (!el) return ''
  return (el.textContent || '').trim()
}

function qsa(root: ParentNode, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector))
}

function uniqueStrings(values: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const s = v.trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function pickEndpoint(doc: XMLDocument): string {
  // WSDL 1.1: <soap:address location="..."> (soap11 or soap12)
  const soapAddr = doc.querySelector('address[location], soap\\:address[location], soap12\\:address[location]') as Element | null
  const loc = soapAddr?.getAttribute('location')?.trim() || ''
  if (loc) return loc

  // fallback: any attribute that looks like an url
  const any = doc.querySelector('[location]') as Element | null
  const anyLoc = any?.getAttribute('location')?.trim() || ''
  return anyLoc
}

function getWsdlName(doc: XMLDocument) {
  const root = doc.documentElement
  const nameAttr = root?.getAttribute('name')?.trim()
  if (nameAttr) return nameAttr
  const svc = doc.querySelector('service[name], wsdl\\:service[name]') as Element | null
  const svcName = svc?.getAttribute('name')?.trim()
  if (svcName) return svcName
  return 'Imported WSDL'
}

function collectOperationNames(doc: XMLDocument): string[] {
  // WSDL 1.1
  const portTypeOps = qsa(doc, 'portType > operation[name], wsdl\\:portType > wsdl\\:operation[name]').map(
    el => el.getAttribute('name') || '',
  )

  // WSDL 2.0
  const ifaceOps = qsa(doc, 'interface > operation[name], wsdl\\:interface > wsdl\\:operation[name]').map(
    el => el.getAttribute('name') || '',
  )

  // fallback (avoid grabbing binding operations twice by preferring the above)
  const genericOps = qsa(doc, 'operation[name], wsdl\\:operation[name]').map(el => el.getAttribute('name') || '')

  const picked = portTypeOps.length || ifaceOps.length ? [...portTypeOps, ...ifaceOps] : genericOps
  return uniqueStrings(picked)
}

function soapActionByOperationName(doc: XMLDocument): Record<string, string> {
  // binding operations often contain <soap:operation soapAction="...">
  const out: Record<string, string> = {}
  const ops = qsa(doc, 'binding operation[name], wsdl\\:binding wsdl\\:operation[name]')
  for (const op of ops) {
    const name = op.getAttribute('name')?.trim() || ''
    if (!name) continue
    const soapOp =
      op.querySelector('operation[soapAction], soap\\:operation[soapAction], soap12\\:operation[soapAction]') as Element | null
    const action = soapOp?.getAttribute('soapAction')?.trim() || ''
    if (action) out[name] = action
  }
  return out
}

function buildSoapEnvelope(opName: string, targetNamespace: string | null): string {
  const ns = (targetNamespace || '').trim()
  const opNs = ns ? ` xmlns:tns="${ns}"` : ''
  const opQName = ns ? `tns:${opName}` : opName

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"${opNs}>\n` +
    `  <soap:Header />\n` +
    `  <soap:Body>\n` +
    `    <${opQName}>\n` +
    `      <!-- TODO: fill request fields -->\n` +
    `    </${opQName}>\n` +
    `  </soap:Body>\n` +
    `</soap:Envelope>\n`
  )
}

export function isWsdlText(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('<')) return false
  return /\bdefinitions\b|\bdescription\b/i.test(trimmed) && /\bwsdl\b|\bsoap\b/i.test(trimmed)
}

export function buildCollectionFromWsdlText(text: string, nameOverride?: string): Collection {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'text/xml')

  // DOMParser returns a document with <parsererror> on invalid xml
  if (doc.querySelector('parsererror')) {
    const msg = firstText(doc.querySelector('parsererror')) || 'Invalid XML'
    throw new Error(msg)
  }

  const name = (nameOverride || getWsdlName(doc)).trim() || 'Imported WSDL'
  const endpoint = pickEndpoint(doc).trim()
  const root = doc.documentElement
  const targetNamespace = root?.getAttribute('targetNamespace')

  const opNames = collectOperationNames(doc)
  if (!opNames.length) throw new Error('WSDL: no operations found.')

  const soapActions = soapActionByOperationName(doc)

  const requests: RequestItem[] = opNames.map(opName => {
    const headers: Record<string, string> = { 'Content-Type': 'text/xml; charset=utf-8' }
    const action = soapActions[opName]
    if (action) headers.SOAPAction = action

    const urlTemplate = endpoint ? endpoint : '{{baseUrl}}'
    const path = (() => {
      if (!endpoint) return '/'
      if (isAbsoluteUrl(endpoint)) {
        try {
          const u = new URL(endpoint)
          return u.pathname || '/'
        } catch {
          return '/'
        }
      }
      return endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    })()

    return {
      id: uid('req'),
      name: opName,
      method: 'POST',
      path,
      urlTemplate,
      params: [],
      headers,
      body: { contentType: headers['Content-Type'], example: buildSoapEnvelope(opName, targetNamespace) },
    }
  })

  const folder: Folder = { id: uid('folder'), name: 'SOAP', requests, folders: [] }

  const baseUrl = (() => {
    if (!endpoint) return undefined
    if (!isAbsoluteUrl(endpoint)) return undefined
    try {
      const u = new URL(endpoint)
      return u.origin
    } catch {
      return undefined
    }
  })()

  return { id: uid('col'), name, baseUrl, folders: [folder] }
}

