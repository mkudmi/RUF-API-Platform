import { buildResponseSearchContext, buildResponseSearchFieldCandidatesText } from '../responseSearchContext'

type ResponseSearchSnapshot = {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    bodyText: string
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText: string
    timeMs: number
  }
}

type PromptTools = {
  stringifyHeaders: (headers: Record<string, string>) => string
  trimBody: (text: string, limit?: number) => string
}

export function buildResponseSearchPrompt(snapshot: ResponseSearchSnapshot, userQuery: string, tools: PromptTools) {
  const responseContext = buildResponseSearchContext(snapshot.response.bodyText)
  const responseFieldCandidates = buildResponseSearchFieldCandidatesText(responseContext)

  return [
    {
      role: 'system',
      content: [
        'You are a deterministic JSONata search planner inside Ruf API Platform.',
        'Convert the user request into exactly one valid JSONata expression that runs against the response JSON.',
        'Return only strict JSON: {"query":"..."} or {"error":"..."} . No prose, no markdown.',
        'Before writing JSONata, first determine which response field the user is asking about, then determine which value that field should have from the current response data.',
        'Only after you have a reliable field and a reliable value, build the JSONata query.',
        'The JSONata expression must itself produce the final filtered JSON result.',
        'When the intent is to find matching records, return a JSONata filter/projection that outputs only the matched records.',
        'Never invent fields or values that are absent from RESPONSE_FIELD_CANDIDATES, RESPONSE_SCHEMA, RESPONSE_STRUCTURE_HINTS, RESPONSE_STRING_VALUE_HINTS, or the response body.',
        'If the user request cannot be mapped reliably to the current response shape, return {"error":"..."} instead of guessing.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Построй надежный JSONata-поиск по ответу Ruf.',
        '',
        'Верни только JSON вида {"query":"..."} или {"error":"..."}.',
        'Логика должна быть такой:',
        '1. Определи, какой параметр или поле пользователь хочет найти.',
        '2. Определи, какое значение этого параметра должно быть, опираясь только на уже пришедший RESPONSE_CONTEXT.',
        '3. Только после этого собери JSONata query.',
        '',
        'Допустимые ответы:',
        '{"query":"$[category.name = \\"Dogs\\"]"}',
        '{"query":"$[photoUrls[$contains($, \\"146\\")]]"}',
        '{"query":"tags[name = \\"fill some value\\"]"}',
        '{"error":"Could not determine a reliable field or value from the current response."}',
        '',
        `USER_QUERY: ${userQuery.trim()}`,
        '',
        'REQUEST_CONTEXT',
        `Method: ${snapshot.request.method}`,
        `URL: ${snapshot.request.url || '(unknown)'}`,
        'Headers:',
        tools.stringifyHeaders(snapshot.request.headers),
        'Body:',
        tools.trimBody(snapshot.request.bodyText, 8_000),
        '',
        'RESPONSE_CONTEXT',
        `Status: ${snapshot.response.status} ${snapshot.response.statusText}`,
        `Time: ${snapshot.response.timeMs} ms`,
        'Headers:',
        tools.stringifyHeaders(snapshot.response.headers),
        'RESPONSE_SCHEMA',
        tools.trimBody(responseContext.schemaText, 20_000),
        'RESPONSE_FIELD_CANDIDATES',
        responseFieldCandidates,
        'RESPONSE_STRUCTURE_HINTS',
        responseContext.structureHintsText,
        'RESPONSE_STRING_VALUE_HINTS',
        responseContext.stringValueHintsText,
        'Body:',
        tools.trimBody(snapshot.response.bodyText, 30_000),
        '',
        'Правила:',
        '- Используй только JSONata.',
        '- Сначала найди целевое поле, потом найди значение этого поля в текущем ответе, и только потом строй query.',
        '- Выражение должно возвращать уже готовый отфильтрованный JSON-результат, а не промежуточный план.',
        '- Для путей используй только реальные поля из RESPONSE_FIELD_CANDIDATES или RESPONSE_SCHEMA.',
        '- Для значений используй только значения, подтвержденные RESPONSE_STRING_VALUE_HINTS, RESPONSE_STRUCTURE_HINTS или Body.',
        '- Если пользователь пишет не тем же языком, что и ответ, сопоставь смысл и используй фактические ключи и значения из ответа.',
        '- Если тип значения можно понять из схемы или примеров, используй правильный JSONata-литерал: number, string, boolean, null.',
        '- Если нужен список найденных записей, верни массив/последовательность только из найденных записей.',
        '- Если нужен поиск внутри массива строк, используй JSONata-функции вроде $contains.',
        '- Если нельзя надежно определить выражение, верни JSON с полем error и не угадывай.',
        '- Не возвращай ничего, кроме допустимого JSON.',
      ].join('\n'),
    },
  ]
}
