export type Environment = {
  baseUrl: string
  headers: Record<string, string>
}

export const DEFAULT_ENVIRONMENT: Environment = {
  baseUrl: '',
  headers: {},
}

