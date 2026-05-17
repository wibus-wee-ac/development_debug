// Input: generated OpenAPI CLI operation metadata
// Output: workspace list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'workspace',
    'list',
  ],
  description: 'List workspaces',
  flags: [],
  method: 'get',
  path: '/workspaces',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
