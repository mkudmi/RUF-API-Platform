type BugReportInput = {
  summary: string
  description: string
}

export function buildBugReportPrompt(input: BugReportInput, options?: { retry?: boolean }) {
  const retry = Boolean(options?.retry)
  return [
    {
      role: 'system',
      content: [
        'You improve draft bug reports.',
        'Reply in Russian.',
        'Do not invent facts that are missing in the draft.',
        'Only improve wording, style, grammar, spelling, punctuation, and clarity.',
        'Preserve user meaning and factual content.',
        'The input may be either a structured template or completely free-form text.',
        'Do not rely on any predefined sections in the input.',
        'Do not add placeholders, explanations, comments, Markdown fences, ellipsis, or meta text.',
        'Do not describe your reasoning.',
        'Do not repeat or explain the instruction.',
        'If the user text is free-form, keep it natural and clear.',
        'If the user text already has sections, keep or gently improve them.',
        'Return plain text in exactly this format with real content, not examples:',
        'SUMMARY: краткий заголовок',
        'DESCRIPTION:',
        'улучшенный текст описания',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Улучши текст баг-репорта без изменения смысла.',
        'Если summary пустой, придумай краткий и нейтральный заголовок только на основе текста ниже.',
        'Ничего не придумывай сверх исходного текста.',
        'Текст ниже может быть как по шаблону, так и полностью произвольным.',
        'Сохрани описание обычным текстом.',
        retry ? 'Важно: в прошлом ответе были рассуждения или повтор инструкции. Сейчас верни только итоговый текст баг-репорта в указанном формате.' : '',
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
