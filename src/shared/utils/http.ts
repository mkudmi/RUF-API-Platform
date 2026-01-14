export function safeJsonParse(text: string) {
  try { return JSON.parse(text) } catch { return null }
}
