// Output: Regression coverage that Cradle's Codex app-server capability manifest matches generated bindings.
// Input: Generated Codex app-server protocol TypeScript files.
// Position: Provider-owned tests preventing bridge coverage drift after protocol regeneration.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CODEX_APP_SERVER_CLIENT_METHODS,
  CODEX_APP_SERVER_SERVER_NOTIFICATIONS,
  CODEX_APP_SERVER_SERVER_REQUESTS,
} from './app-server-capabilities'

const protocolRoot = join(import.meta.dirname, 'app-server-protocol')

describe('codex app-server capability manifest', () => {
  it('covers every generated client request method', () => {
    expect(CODEX_APP_SERVER_CLIENT_METHODS.map(method => method.method)).toEqual(
      readGeneratedMethods('ClientRequest.ts'),
    )
  })

  it('covers every generated server request method', () => {
    expect(CODEX_APP_SERVER_SERVER_REQUESTS.map(request => request.method)).toEqual(
      readGeneratedMethods('ServerRequest.ts'),
    )
  })

  it('covers every generated server notification method', () => {
    expect(CODEX_APP_SERVER_SERVER_NOTIFICATIONS.map(notification => notification.method)).toEqual(
      readGeneratedMethods('ServerNotification.ts'),
    )
  })
})

function readGeneratedMethods(fileName: string): string[] {
  const source = readFileSync(join(protocolRoot, fileName), 'utf8')
  return Array.from(source.matchAll(/"method": "([^"]+)"/g), match => match[1])
}
