import { type JsonSchema, parseJsonSchemaText } from '../../shared/utils/jsonSchema'

type SchemaPath = string

type SchemaDiff = {
  addedFields: SchemaPath[]
  removedFields: SchemaPath[]
  typeChanges: Array<{ path: SchemaPath, baseline: string, actual: string }>
  requiredAdded: SchemaPath[]
  requiredRemoved: SchemaPath[]
}

type RequestMeta = {
  name: string
  method: string
  path: string
}

function schemaTypeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown'
  if (schema.anyOf?.length) return `anyOf(${schema.anyOf.map(schemaTypeLabel).join(', ')})`
  return schema.type ?? 'unknown'
}

function joinPath(base: string, segment: string) {
  return base ? `${base}.${segment}` : segment
}

function compareSchemaNodes(diff: SchemaDiff, baseline: JsonSchema | undefined, actual: JsonSchema | undefined, path: string) {
  if (!baseline || !actual) return

  const baselineType = schemaTypeLabel(baseline)
  const actualType = schemaTypeLabel(actual)
  if (baselineType !== actualType) {
    diff.typeChanges.push({ path: path || 'root', baseline: baselineType, actual: actualType })
    return
  }

  if (baseline.type === 'object' && actual.type === 'object') {
    const baselineProps = baseline.properties ?? {}
    const actualProps = actual.properties ?? {}

    for (const key of Object.keys(baselineProps)) {
      if (!(key in actualProps)) diff.removedFields.push(joinPath(path, key))
    }

    for (const key of Object.keys(actualProps)) {
      if (!(key in baselineProps)) diff.addedFields.push(joinPath(path, key))
    }

    const baselineRequired = new Set(baseline.required ?? [])
    const actualRequired = new Set(actual.required ?? [])

    for (const key of baselineRequired) {
      if (!actualRequired.has(key)) diff.requiredRemoved.push(joinPath(path, key))
    }

    for (const key of actualRequired) {
      if (!baselineRequired.has(key)) diff.requiredAdded.push(joinPath(path, key))
    }

    for (const key of Object.keys(baselineProps)) {
      if (!(key in actualProps)) continue
      compareSchemaNodes(diff, baselineProps[key], actualProps[key], joinPath(path, key))
    }
    return
  }

  if (baseline.type === 'array' && actual.type === 'array') {
    compareSchemaNodes(diff, baseline.items, actual.items, `${path}[]`)
  }
}

function buildConclusion(diff: SchemaDiff) {
  const hasBreakingChanges = !!(diff.removedFields.length || diff.typeChanges.length || diff.requiredAdded.length)
  if (hasBreakingChanges) return 'Схема ответа изменилась несовместимо с эталоном.'
  if (diff.addedFields.length || diff.requiredRemoved.length) return 'Схема ответа изменилась, но изменения выглядят ограниченными.'
  return 'Есть различия в схеме ответа, но они не были явно классифицированы.'
}

function buildImpact(diff: SchemaDiff) {
  const facts: string[] = []
  if (diff.removedFields.length) facts.push('клиенты не найдут поля, на которые рассчитывали')
  if (diff.typeChanges.length) facts.push('парсинг и автотесты по типам начнут падать')
  if (diff.requiredAdded.length) facts.push('новые обязательные поля потребуют обновления контрактов и проверок')
  if (diff.addedFields.length && !diff.removedFields.length && !diff.typeChanges.length) facts.push('можно обновить контракт и расширить проверки без срочного блокера')
  if (!facts.length) facts.push('нужно вручную проверить совместимость контракта')
  return `Для клиента API это значит, что ${facts.join('; ')}.`
}

export function buildSchemaDiffTesterSummary(args: {
  request: RequestMeta
  baselineSchemaText: string
  actualSchemaText: string
}): string {
  const baseline = parseJsonSchemaText(args.baselineSchemaText)
  const actual = parseJsonSchemaText(args.actualSchemaText)
  if (!baseline || !actual) {
    return [
      '1. Короткий вывод.',
      'Не удалось построить корректное сравнение схем, потому что одна из схем не является валидным JSON-объектом.',
      '',
      '2. Критичные расхождения.',
      '- Сравнение по структуре не выполнено.',
      '',
      '3. Некритичные расхождения.',
      'Нет.',
      '',
      '4. Что это значит для клиента API.',
      'Нужно вручную проверить фактический ответ и эталонную схему.',
      '',
      '5. Что лучше сделать дальше.',
      '- Проверить валидность эталонной и новой схемы.',
      '- Повторить сравнение после исправления.',
    ].join('\n')
  }

  const diff: SchemaDiff = {
    addedFields: [],
    removedFields: [],
    typeChanges: [],
    requiredAdded: [],
    requiredRemoved: [],
  }
  compareSchemaNodes(diff, baseline, actual, '')

  const criticalLines = [
    ...diff.removedFields.map(path => `- Удалено поле: ${path}`),
    ...diff.typeChanges.map(item => `- Изменился тип поля ${item.path}: было \`${item.baseline}\`, стало \`${item.actual}\``),
    ...diff.requiredAdded.map(path => `- Поле стало обязательным: ${path}`),
  ]

  const nonCriticalLines = [
    ...diff.addedFields.map(path => `- Добавлено поле: ${path}`),
    ...diff.requiredRemoved.map(path => `- Поле перестало быть обязательным: ${path}`),
  ]

  return [
    '1. Короткий вывод.',
    `${buildConclusion(diff)} Запрос: ${args.request.method} ${args.request.path}.`,
    '',
    '2. Критичные расхождения.',
    criticalLines.length ? criticalLines.join('\n') : 'Нет.',
    '',
    '3. Некритичные расхождения.',
    nonCriticalLines.length ? nonCriticalLines.join('\n') : 'Нет.',
    '',
    '4. Что это значит для клиента API.',
    buildImpact(diff),
    '',
    '5. Что лучше сделать дальше.',
    '- Сверить фактический ответ API с ожидаемым контрактом.',
    '- Если ответ изменился специально, перезаписать эталонную схему и обновить тесты.',
    '- Если ответ изменился не специально, завести дефект на нарушение контракта API.',
  ].join('\n')
}
