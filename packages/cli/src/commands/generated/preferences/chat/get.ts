// Input: generated OpenAPI CLI operation metadata
// Output: preferences chat get command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'preferences',
    'chat',
    'get',
  ],
  description: 'Get chat preferences',
  flags: [],
  method: 'get',
  path: '/preferences/chat',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
