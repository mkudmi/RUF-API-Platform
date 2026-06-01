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
        'If the user did not name a field explicitly and is asking to find records by value or partial value, inspect the current response and infer the most reliable field path from where that value appears.',
        'If the value appears in several places, prefer the narrowest field path that best matches the user intent.',
        'For threshold or comparison requests such as greater than, less than, before, after, at least, or at most, you may use the comparison value directly from the user request even when that exact scalar does not appear in the response body, as long as the target field is reliably identified from the response.',
        'For natural-language date requests, you may map human date phrases such as "22 May" or "22 мая" to equivalent ISO date fields found in the response, using RESPONSE_STRING_VALUE_HINTS and date-shaped field samples.',
        'The JSONata expression must itself produce the final filtered JSON result.',
        'When the intent is to find matching records, return a JSONata filter/projection that outputs only the matched records.',
        'When the matching records live inside a named collection field, preserve that collection field in the final result shape instead of returning the entire root object.',
        'Do not use root-level truthy filters that keep the whole object when the user asked for filtered records inside a nested collection.',
        'Never invent fields that are absent from RESPONSE_FIELD_CANDIDATES, RESPONSE_SCHEMA, RESPONSE_STRUCTURE_HINTS, RESPONSE_STRING_VALUE_HINTS, or the response body.',
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
        'Если пользователь не указал поле явно, но хочет найти запись по значению или части значения, определи поле по самому RESPONSE_CONTEXT: где именно это значение встречается в ответе.',
        '',
        'Допустимые ответы:',
        '{"query":"$[category.name = \\"Dogs\\"]"}',
        '{"query":"$[photoUrls[$contains($, \\"146\\")]]"}',
        '{"query":"tags[name = \\"fill some value\\"]"}',
        '{"query":"$[$contains(description, \\"voluptates\\")]"}',
        '{"query":"{\\"values\\": values[amount > 3000]}"}',
        '{"query":"{\\"items\\": items[$contains(created_at, \\"2026-05-22\\")]}"}',
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
        '- Если пользователь не назвал поле, но назвал значение, найди по RESPONSE_STRING_VALUE_HINTS и Body, в каком поле это значение реально встречается, и используй это поле.',
        '- Если пользователь задает условие сравнения или порог, например "больше 3000", "меньше 10", "после 2026-01-01", разрешено брать сам порог из USER_QUERY, даже если такого точного значения нет в ответе, но только если целевое поле надежно определяется по RESPONSE_FIELD_CANDIDATES, RESPONSE_SCHEMA или RESPONSE_STRUCTURE_HINTS.',
        '- Если пользователь задает дату естественным языком, например "22 мая" или "May 22", разрешено сопоставить ее с ISO-датой или datetime-полем из ответа, если такое поле надежно видно по RESPONSE_STRING_VALUE_HINTS, RESPONSE_STRUCTURE_HINTS, примерам или Body.',
        '- Если пользователь просит частичное совпадение, используй JSONata-функции вроде $contains и по возможности делай сравнение без учета регистра через $lowercase.',
        '- Выражение должно возвращать уже готовый отфильтрованный JSON-результат, а не промежуточный план.',
        '- Если записи находятся внутри именованного списка или коллекции, сохрани эту коллекцию в результирующей структуре и отфильтруй именно ее элементы.',
        '- Не используй query, который оставляет весь корневой объект целиком только потому, что внутри него нашлись совпадения.',
        '- Для путей используй только реальные поля из RESPONSE_FIELD_CANDIDATES или RESPONSE_SCHEMA.',
        '- Для точных значений используй только значения, подтвержденные RESPONSE_STRING_VALUE_HINTS, RESPONSE_STRUCTURE_HINTS или Body.',
        '- Для порогов и сравнений используй значение из USER_QUERY с правильным типом литерала, если поле надежно найдено в текущем ответе.',
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
