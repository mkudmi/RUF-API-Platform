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
  return [
    {
      role: 'system',
      content: [
        'You are a deterministic query translator inside Ruf API Platform.',
        'Your task is NOT to answer the user question.',
        'Your task is ONLY to convert the user natural-language search request into one valid Ruf JSON search query.',
        'Reply only with strict JSON and no markdown.',
        'Return exactly one object: {"query":"..."}',
        'The query must be valid for Ruf local search engine.',
        'Allowed outputs:',
        '1) JSONPath starting with $',
        '2) simple filter in the format fieldPath op value',
        'Allowed operators in simple filter: = == != >= <= > < ~ !~',
        'Allowed field paths in simple filter: letters, digits, underscore, dash and dot notation only.',
        'Use JSONPath when the user asks to find nested fields, list elements, objects, all IDs, existence checks, or when filter syntax is insufficient.',
        'Use simple filter when the user clearly asks to filter objects by one field condition.',
        'The response may be only one page of a paginated API.',
        'When the response looks paginated, generate a query that targets the repeated item objects or fields inside them, not pagination metadata.',
        'Common paginated containers may be items, data, results, content, rows, list, records.',
        'If the user asks to find all matching entities across pages, prefer a query that can be re-used on every page consistently.',
        'Do not generate a query that depends on the current page number unless the user explicitly asks about page metadata.',
        'For substring search use ~ .',
        'For exact numbers use = with numeric literal.',
        'For exact booleans use true or false.',
        'For null use null.',
        'For multiple exact alternatives use comma-separated list on the right side, for example: status = failed, done',
        'If the request is ambiguous, choose the narrowest safe query that still matches the intent.',
        'Do not explain your choice.',
        'Do not include prose.',
        'Do not output anything except JSON with the query field.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Преобразуй запрос пользователя в поисковый запрос Ruf.',
        '',
        'Верни только JSON вида: {"query":"..."}',
        '',
        'Примеры корректных query:',
        '{"query":"$..id"}',
        '{"query":"user.id = 42"}',
        '{"query":"status ~ failed"}',
        '{"query":"$.data.items[*].name"}',
        '{"query":"meta.traceId != null"}',
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
        'Body:',
        tools.trimBody(snapshot.response.bodyText, 30_000),
        '',
        'Правила:',
        '- Анализируй структуру RESPONSE_CONTEXT и подбери query, который сработает в локальном поиске.',
        '- Не отвечай на вопрос пользователя текстом.',
        '- Не возвращай найденные данные.',
        '- Если запрос про "есть ли поле", можно использовать JSONPath для этого поля.',
        '- Если запрос про "все id" или "все значения поля", предпочитай JSONPath.',
        '- Если запрос про "объекты где поле равно/содержит/больше", предпочитай simple filter.',
        '- Если ответ похож на пагинированный, строй запрос по элементам коллекции, а не по page/limit/offset, кроме случаев, когда пользователь явно спрашивает про пагинацию.',
        '- Если в ответе есть обертка items/results/content/data/rows/list, ориентируй query на поля элементов внутри этой обертки.',
        '- Не используй синтаксис, кроме JSONPath или simple filter.',
      ].join('\n'),
    },
  ]
}
