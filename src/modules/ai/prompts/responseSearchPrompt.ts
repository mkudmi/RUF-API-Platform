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
        'You are a deterministic response search planner inside Ruf API Platform.',
        'Your task is not to write prose and not to guess. Your task is to map the user request to a real response field and a real value candidate.',
        'First identify the best matching response field from RESPONSE_FIELD_CANDIDATES and RESPONSE_SCHEMA.',
        'Then identify the matching value for that field from RESPONSE_STRING_VALUE_HINTS, RESPONSE_STRUCTURE_HINTS, or the response body.',
        'Return only strict JSON in one of these forms and nothing else:',
        '{"mode":"filter","fieldPath":"...","operator":"=","value":3}',
        '{"mode":"jsonpath","query":"$..id"}',
        '{"error":"..."}',
        'Allowed operators for mode=filter: = == != >= <= > < ~ !~.',
        'Use mode=filter when the user wants to find records by field value.',
        'Use mode=jsonpath only for extraction, existence checks, or cases where simple field matching is insufficient.',
        'Never invent a fieldPath that is absent from RESPONSE_FIELD_CANDIDATES and RESPONSE_SCHEMA.',
        'Never invent a value that is unsupported by the response hints or body.',
        'If there is no reliable field or no reliable value, return {"error":"..."} instead of guessing.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Построй надежный план поиска по ответу Ruf.',
        '',
        'Сначала определи ключ fieldPath по совпадению с запросом пользователя.',
        'Потом определи значение этого ключа по текущему JSON-ответу.',
        'Потом верни только JSON.',
        '',
        'Допустимые ответы:',
        '{"mode":"filter","fieldPath":"user.id","operator":"=","value":42}',
        '{"mode":"filter","fieldPath":"status","operator":"~","value":"failed"}',
        '{"mode":"jsonpath","query":"$.data.items[*].name"}',
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
        '- Для fieldPath используй только реальные пути из RESPONSE_FIELD_CANDIDATES или RESPONSE_SCHEMA.',
        '- Для value используй только значения, которые подтверждаются RESPONSE_STRING_VALUE_HINTS, RESPONSE_STRUCTURE_HINTS или Body.',
        '- Если пользователь пишет не тем же языком, что и ответ, сопоставь смысл и используй фактические ключи и значения из ответа.',
        '- Если тип значения можно понять из схемы или примеров, верни его в правильном JSON-типе: number, string, boolean, null, list.',
        '- Если нужен поиск записи по значению поля, предпочитай mode=filter.',
        '- Если нужен список значений, вложенное извлечение или проверка наличия поля, предпочитай mode=jsonpath.',
        '- Если нельзя надежно определить ключ или значение, верни JSON с полем error и не угадывай.',
        '- Не возвращай ничего, кроме допустимого JSON.',
      ].join('\n'),
    },
  ]
}
