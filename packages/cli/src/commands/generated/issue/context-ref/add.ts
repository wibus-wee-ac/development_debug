// Input: generated OpenAPI CLI operation metadata
// Output: issue context-ref add command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'id',
      required: true,
      target: 'path.id',
      type: 'string',
    },
  ],
  command: [
    'issue',
    'context-ref',
    'add',
  ],
  description: 'Add context ref',
  flags: [
    {
      name: 'ref',
      required: true,
      target: 'body.ref',
      type: 'string',
    },
  ],
  method: 'post',
  path: '/kanban/issues/{id}/context-refs',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
