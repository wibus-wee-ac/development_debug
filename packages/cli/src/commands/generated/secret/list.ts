// Input: generated OpenAPI CLI operation metadata
// Output: secret list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'secret',
    'list',
  ],
  description: 'List secrets',
  flags: [],
  method: 'get',
  path: '/secrets/',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
