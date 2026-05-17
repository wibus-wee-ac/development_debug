// Input: generated OpenAPI CLI operation metadata
// Output: acp registry list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'acp',
    'registry',
    'list',
  ],
  description: 'List registry agents',
  flags: [],
  method: 'get',
  path: '/acp/registry',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
