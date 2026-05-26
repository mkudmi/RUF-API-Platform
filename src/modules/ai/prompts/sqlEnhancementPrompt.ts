type SqlEnhancementInput = {
  sql: string
  dialect: 'postgres' | 'mysql'
  schema?: string
}

export function buildSqlEnhancementPrompt(input: SqlEnhancementInput) {
  const schemaLine = input.schema?.trim()
    ? `Selected schema: ${input.schema.trim()}`
    : 'Selected schema: (none)'

  return [
    {
      role: 'system',
      content: [
        'You are a senior SQL engineer.',
        'Review the provided SQL script and improve it conservatively.',
        'Fix only syntax problems, obvious SQL mistakes, broken quoting, invalid clause placement, and similar correctness issues.',
        'Do not change business logic, result shape, statement order, variable placeholders, comments, or the overall intent.',
        'Do not remove code just because it looks unusual.',
        'Preserve formatting when possible.',
        'Return valid JSON only with keys "sql" and "summary".',
        'The "sql" field must contain the full corrected script as plain text without Markdown fences.',
        'The "summary" field must be a short plain-text description of what was fixed, or "No changes" if nothing had to be changed.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Проверь SQL-скрипт и исправь только синтаксис и явные ошибки.',
        'Не меняй логику, не удаляй части скрипта и не переписывай его заново без необходимости.',
        'Сохрани комментарии, плейсхолдеры, переменные и структуру.',
        '',
        `Dialect: ${input.dialect}`,
        schemaLine,
        '',
        'SQL script:',
        input.sql.trim() || '(empty)',
      ].join('\n'),
    },
  ]
}
