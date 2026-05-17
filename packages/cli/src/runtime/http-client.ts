// Input: operation method/path/query/body and server URL
// Output: typed JSON HTTP request result or a CLI-friendly error
// Position: packages/cli runtime transport helper

import type { CliHttpMethod } from './types'

const PATH_PARAM_RE = /\{([^}]+)\}/g

interface RequestInput {
  body?: unknown
  method: CliHttpMethod
  path: Record<string, unknown>
  query: Record<string, unknown>
  serverUrl: string
  template: string
}

function serializePath(template: string, values: Record<string, unknown>): string {
  return template.replace(PATH_PARAM_RE, (_, key: string) => {
    const value = values[key]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter: ${key}`)
    }
    return encodeURIComponent(String(value))
  })
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) {
    return `${response.status} ${response.statusText}`
  }
  try {
    const payload = JSON.parse(text) as { message?: unknown }
    return typeof payload.message === 'string' ? payload.message : text
  }
  catch {
    return text
  }
}

export async function requestJson<T = unknown>(input: RequestInput): Promise<T> {
  const path = serializePath(input.template, input.path)
  const url = new URL(path, input.serverUrl)
  appendQuery(url, input.query)

  let response: Response
  try {
    response = await fetch(url, {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      headers: input.body === undefined ? undefined : { 'content-type': 'application/json' },
      method: input.method.toUpperCase(),
    })
  }
  catch {
    throw new Error(`Cannot connect to Cradle server at ${input.serverUrl}. Is the server running?`)
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }
  return JSON.parse(text) as T
}
