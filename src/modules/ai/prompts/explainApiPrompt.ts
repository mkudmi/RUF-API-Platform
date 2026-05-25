type ExplainSnapshot = {
  request: {
    method: string
    url: string
    urlTemplate: string
    headers: Record<string, string>
    queryParams: Record<string, string>
    bodyText: string
    contentType: string
  }
  response?: {
    ok: boolean
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText: string
    timeMs: number
  } | null
}

type PromptTools = {
  stringifyHeaders: (headers: Record<string, string>) => string
  trimBody: (text: string, limit?: number) => string
}

export function buildExplainApiPrompt(snapshot: ExplainSnapshot, tools: PromptTools) {
  return [
    {
      role: 'system',
      content: [
        'You are an API debugging assistant inside Ruf API Platform.',
        'Reply in Russian.',
        'Be concrete and concise.',
        'Focus on likely root cause, supporting evidence from request/response, and exact next fixes.',
        'If the response is missing, review the request and point out the most likely risks before sending.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Проанализируй текущий API-запрос и ответ.',
        '',
        'Формат ответа:',
        '1. Короткий вывод.',
        '2. Вероятная причина.',
        '3. Что проверить дальше.',
        '4. Конкретные правки запроса.',
        '',
        'REQUEST',
        `Method: ${snapshot.request.method}`,
        `URL: ${snapshot.request.url}`,
        `URL Template: ${snapshot.request.urlTemplate}`,
        `Content-Type: ${snapshot.request.contentType || '(not set)'}`,
        'Headers:',
        tools.stringifyHeaders(snapshot.request.headers),
        'Query Params:',
        tools.stringifyHeaders(snapshot.request.queryParams),
        'Body:',
        tools.trimBody(snapshot.request.bodyText),
        '',
        snapshot.response
          ? [
            'RESPONSE',
            `OK: ${snapshot.response.ok}`,
            `Status: ${snapshot.response.status} ${snapshot.response.statusText}`,
            `Time: ${snapshot.response.timeMs} ms`,
            'Headers:',
            tools.stringifyHeaders(snapshot.response.headers),
            'Body:',
            tools.trimBody(snapshot.response.bodyText),
          ].join('\n')
          : 'RESPONSE\n(no response yet)',
      ].join('\n'),
    },
  ]
}
