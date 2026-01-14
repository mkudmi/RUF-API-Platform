export type Environment = {
  baseUrlKey: string
  variables: Record<string, string>
  headers: Record<string, string>
}

export const DEFAULT_ENVIRONMENT: Environment = {
  baseUrlKey: 'baseUrl',
  variables: { baseUrl: '', scheme: 'http' },
  headers: {},
}
