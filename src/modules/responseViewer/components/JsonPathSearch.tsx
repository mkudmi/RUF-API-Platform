import { useMemo, useRef, useState } from 'react'
import { CloseIcon, CopyIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
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
