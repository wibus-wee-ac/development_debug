// Input: generated OpenAPI CLI operation metadata
// Output: usage summary command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'usage',
    'summary',
  ],
  description: 'Get usage summary',
  flags: [],
  method: 'get',
  path: '/usage/summary',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
