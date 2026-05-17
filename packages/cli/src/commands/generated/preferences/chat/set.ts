// Input: generated OpenAPI CLI operation metadata
// Output: preferences chat set command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'preferences',
    'chat',
    'set',
  ],
  description: 'Set chat preferences',
  flags: [
    {
      name: 'modelId',
      required: true,
      target: 'body.modelId',
      type: 'string',
    },
    {
      name: 'configSelections',
      required: true,
      target: 'body.configSelections',
      type: 'json',
    },
  ],
  method: 'put',
  path: '/preferences/chat',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
