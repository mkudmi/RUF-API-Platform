type BugReportInput = {
  summary: string
  description: string
}

export function buildBugReportPrompt(input: BugReportInput) {
  return [
    {
      role: 'system',
      content: [
        'You improve draft bug reports.',
        'Reply in Russian.',
        'Do not invent facts that are missing in the draft.',
        'Only improve wording, style, grammar, spelling, punctuation, and clarity.',
        'Preserve user meaning, structure, and factual content.',
        'Do not add placeholders, explanations, comments, Markdown fences, or ellipsis.',
        'Return plain text in exactly this format:',
        'SUMMARY: <one concise line>',
        'DESCRIPTION:',
        '<improved plain-text description>',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Улучши текст баг-репорта без изменения смысла.',
        'Если summary пустой, придумай краткий и нейтральный заголовок только на основе текста ниже.',
        'Ничего не придумывай сверх исходного текста.',
        'Сохрани описание обычным текстом.',
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
