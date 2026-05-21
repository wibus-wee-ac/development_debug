export type CliHttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

export type CliValueType = 'boolean' | 'json' | 'number' | 'string' | 'string[]'
export type CliOutputFormat = 'auto' | 'json' | 'ndjson' | 'pretty' | 'table'

export interface CliArgumentSpec {
  name: string
  description?: string
  target: string
  required?: boolean
  type?: CliValueType
}

export interface CliFlagSpec {
  name: string
  description?: string
  target: string
  required?: boolean
  type?: CliValueType
  values?: string[]
}

export interface CliOperationSpec {
  command: string[]
  description?: string
  method: CliHttpMethod
  path: string
  arguments?: CliArgumentSpec[]
  flags?: CliFlagSpec[]
}

export interface CommandContext {
  serverUrl: string
  request: <T = unknown>(operation: {
    body?: unknown
    method: CliHttpMethod
    path: Record<string, unknown>
    query: Record<string, unknown>
    template: string
  }) => Promise<T>
}
