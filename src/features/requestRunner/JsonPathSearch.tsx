import { useMemo, useRef, useState } from 'react'
import { JSONPath } from 'jsonpath-plus'
import { CloseIcon, CopyIcon } from '../../shared/icons'

export type JsonValue = null | boolean | number | string | object | unknown[]

type FilterOp = '=' | '==' | '!=' | '>=' | '<=' | '>' | '<' | '~' | '!~'
type SimpleFilter = { fieldPath: string, op: FilterOp, expected: unknown }

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

async function copyText(text: string) {
  if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

function isJsonPathQuery(query: string) {
  return query.trim().startsWith('$')
}

function parseScalar(text: string): unknown {
  const list = splitCommaList(text)
  const looksLikeList = list.length > 1 || (list.length === 1 && text.includes(','))
  if (looksLikeList) return list.map(parseScalarSingle)
  return parseScalarSingle(text)
}

function splitCommaList(text: string) {
  const out: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      const t = cur.trim()
      if (t) out.push(t)
      cur = ''
      continue
    }
    cur += ch
  }

  const tail = cur.trim()
  if (tail) out.push(tail)
  return out
}

function parseScalarSingle(text: string): unknown {
  const t = text.trim()
  if (!t) return ''

  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }

  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null

  const n = Number(t)
  if (!t.startsWith('+') && Number.isFinite(n) && /^[+-]?\d+(\.\d+)?$/.test(t)) return n

  return t
}

function parseSimpleFilter(query: string): SimpleFilter | null {
  const m = query.trim().match(/^([a-zA-Z0-9_.-]+)\s*(==|=|!=|>=|<=|>|<|~|!~)\s*(.+)$/)
  if (!m) return null
  const [, fieldPath, opRaw, rhs] = m
  return { fieldPath, op: opRaw as FilterOp, expected: parseScalar(rhs) }
}

function getAtPath(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function compare(op: FilterOp, actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (op === '=' || op === '==') return expected.some(e => compare('==', actual, e))
    if (op === '!=') return expected.every(e => compare('!=', actual, e))
    if (op === '~') return expected.some(e => compare('~', actual, e))
    if (op === '!~') return expected.every(e => compare('!~', actual, e))
    return false
  }

  if (op === '=' || op === '==') {
    if (typeof actual === 'number' && typeof expected === 'number') return actual === expected
    return String(actual) === String(expected)
  }

  if (op === '!=') {
    if (typeof actual === 'number' && typeof expected === 'number') return actual !== expected
    return String(actual) !== String(expected)
  }

  if (op === '~' || op === '!~') {
    const a = String(actual ?? '').toLowerCase()
    const e = String(expected ?? '').toLowerCase()
    const ok = a.includes(e)
    return op === '~' ? ok : !ok
  }

  const aNum = typeof actual === 'number' ? actual : Number(actual)
  const eNum = typeof expected === 'number' ? expected : Number(expected)
  if (!Number.isFinite(aNum) || !Number.isFinite(eNum)) return false

  if (op === '>=') return aNum >= eNum
  if (op === '<=') return aNum <= eNum
  if (op === '>') return aNum > eNum
  if (op === '<') return aNum < eNum
  return false
}

function findMatchingValues(root: JsonValue, filter: SimpleFilter): unknown[] {
  const values: unknown[] = []

  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const v of node) visit(v)
      return
    }

    const actual = getAtPath(node, filter.fieldPath)
    if (actual !== undefined && compare(filter.op, actual, filter.expected)) {
      values.push(node)
    }

    for (const v of Object.values(node as Record<string, unknown>)) visit(v)
  }

  visit(root)
  return values
}

type JsonPathFn = <T>(options: {
  path: string | unknown[]
  json: JsonValue
  resultType?: 'value' | 'all'
}) => T

const jsonPath = JSONPath as unknown as JsonPathFn

export function evaluateJsonSearch(json: JsonValue, query: string): { matches: unknown[], error: string | null } {
  const q = query.trim()
  if (!q) return { matches: [], error: null }

  try {
    if (!isJsonPathQuery(q)) {
      const filter = parseSimpleFilter(q)
      if (!filter) return { matches: [], error: 'Enter JSONPath (starts with $) or a filter like: id = 5' }
      return { matches: findMatchingValues(json, filter), error: null }
    }

    const res = jsonPath<unknown[] | unknown>({ path: q, json, resultType: 'value' })
    const matches = Array.isArray(res) ? res : [res]
    return { matches, error: null }
  } catch (e: unknown) {
    return { matches: [], error: errorMessage(e) || 'Invalid query.' }
  }
}

export function JsonPathSearch(props: {
  query: string
  onQueryChange: (query: string) => void
  matchesCount: number | null
  error: string | null
  disabled?: boolean
}) {
  const query = props.query
  const disabled = !!props.disabled
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const helpDialogRef = useRef<HTMLDialogElement | null>(null)

  async function onCopy(label: string, text: string) {
    try {
      setCopyError(null)
      await copyText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 800)
    } catch (e: unknown) {
      setCopyError(errorMessage(e) || 'Failed to copy to clipboard.')
    }
  }

  const q = query.trim()
  const computed = useMemo(() => {
    const error = props.error || copyError
    const matchesCount = typeof props.matchesCount === 'number' ? props.matchesCount : null
    return { error, matchesCount }
  }, [copyError, props.error, props.matchesCount])

  return (
    <div className="accordion">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div className="sectionTitle">Поиск</div>
        <button
          className="iconBtn"
          onClick={() => helpDialogRef.current?.showModal()}
          title="Инструкция"
          aria-label="Инструкция по поиску"
          style={{ width: 28, height: 28 }}
        >
          i
        </button>
      </div>

      <div
        className="jsonSearchQueryRow"
        style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, marginTop: 8 }}
      >
        <input
          className="mono"
          value={query}
          onChange={e => props.onQueryChange(e.target.value)}
          disabled={disabled}
          placeholder="Examples: id = 5 | id = 24, 25 | name ~ Максим | height >= 166 | $..id"
        />
        <button
          type="button"
          className="iconBtn"
          onClick={() => onCopy('query', q)}
          disabled={!q}
          title="Copy query"
          aria-label="Copy query"
        >
          {copied === 'query' ? 'OK' : <CopyIcon />}
        </button>
        <button
          type="button"
          className="iconBtn"
          onClick={() => props.onQueryChange('')}
          disabled={!q}
          title="Clear"
          aria-label="Clear"
        >
          <CloseIcon />
        </button>
      </div>

      {computed.error && (
        <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>
          {computed.error}
        </div>
      )}

      {q && !computed.error && computed.matchesCount !== null && (
        <div className="small" style={{ marginTop: 8 }}>
          Matches: <span className="mono">{computed.matchesCount}</span>
        </div>
      )}

      <dialog ref={helpDialogRef} className="modal">
        <div className="modalHeader">
          <b>Как пользоваться поиском</b>
          <button
            className="iconBtn"
            onClick={() => helpDialogRef.current?.close()}
            aria-label="Закрыть"
            title="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="small" style={{ display: 'grid', gap: 10 }}>
          <div>
            Поддерживаются два режима:
          </div>

          <div>
            <b>1) Простой фильтр</b> (рекомендуется): <span className="mono">поле оператор значение</span>
            <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
              Операторы: <span className="mono">=</span>, <span className="mono">!=</span>, <span className="mono">&gt;</span>, <span className="mono">&gt;=</span>, <span className="mono">&lt;</span>, <span className="mono">&lt;=</span>,
              <span className="mono"> ~ </span>(содержит, без учёта регистра), <span className="mono">!~</span>.
            </div>
            <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
              Список значений через запятую: <span className="mono">id = 24, 25</span>.
              Строки можно брать в кавычки: <span className="mono">email = \"a@b.ru\"</span>.
            </div>
          </div>

          <div>
            <b>2) JSONPath</b>: если запрос начинается с <span className="mono">$</span>, он интерпретируется как JSONPath.
            <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
              Примеры: <span className="mono">$..id</span>, <span className="mono">$.data.items[?(@.name == 'foo')]</span>.
            </div>
          </div>

          <div style={{ opacity: 0.85 }}>
            Результат поиска отображается прямо в <span className="mono">Body</span>:
            если совпадений нет — пусто; если есть — возвращается объект или массив объектов.
            Если исходный ответ был массивом, то даже одно совпадение будет показано как массив из 1 элемента.
          </div>
        </div>
      </dialog>
    </div>
  )
}
