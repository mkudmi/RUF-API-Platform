type BugReportInput = {
  summary: string
  description: string
}

export function buildBugReportPrompt(input: BugReportInput) {
  return [
    {
      role: 'system',
      content: [
        'You are a senior QA engineer preparing a technical bug report.',
        'Reply in Russian.',
        'Do not invent facts that are missing in the draft.',
        'Rewrite the report into a more technical and concise format.',
        'Preserve user meaning, add structure, and normalize wording.',
        'Return valid JSON only with keys "summary" and "description".',
        'The "description" value must be plain text without Markdown fences.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Преобразуй черновик баг-репорта в технический структурированный вид.',
        'Если summary пустой, придумай краткий технический заголовок только на основе текста ниже.',
        'Если каких-то данных не хватает, явно оставь это как "Не указано".',
        '',
        'Текущий summary:',
        input.summary.trim() || '(empty)',
        '',
        'Черновик описания:',
        input.description.trim() || '(empty)',
      ].join('\n'),
    },
  ]
}
