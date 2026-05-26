type ResponseSchemaDiffSnapshot = {
  request: {
    name: string
    method: string
    path: string
  }
  baselineSchemaText: string
  actualSchemaText: string
}

export function buildResponseSchemaDiffPrompt(snapshot: ResponseSchemaDiffSnapshot) {
  return [
    {
      role: 'system',
      content: [
        'You are an API schema comparison assistant inside Ruf API Platform.',
        'Reply in Russian.',
        'Be concrete and concise.',
        'Compare only JSON schema structure.',
        'Highlight removed fields, added fields, type changes, required field changes, and nesting changes.',
        'Do not reveal chain-of-thought, reasoning process, internal analysis, or step-by-step thinking.',
        'Return only the final answer for a QA engineer.',
        'Do not use English unless a field name or type must stay technical.',
        'Do not write preambles like "Here is my analysis" or "thinking process".',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Сравни эталонную и новую JSON Schema для API-ответа.',
        'Нужен четкий итог для тестировщика, без рассуждений и без описания процесса.',
        '',
        'Формат ответа:',
        '1. Короткий вывод.',
        '2. Критичные расхождения.',
        '3. Некритичные расхождения.',
        '4. Что это значит для клиента API.',
        '5. Что лучше сделать дальше.',
        '',
        'Пиши только готовый ответ по этим 5 пунктам.',
        '',
        'REQUEST',
        `Name: ${snapshot.request.name}`,
        `Method: ${snapshot.request.method}`,
        `Path: ${snapshot.request.path}`,
        '',
        'BASELINE SCHEMA',
        snapshot.baselineSchemaText,
        '',
        'ACTUAL SCHEMA',
        snapshot.actualSchemaText,
      ].join('\n'),
    },
  ]
}
