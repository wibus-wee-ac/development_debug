// Input: generated OpenAPI CLI operation metadata
// Output: status reorder command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "status",
    "reorder"
  ],
  "description": "Reorder statuses",
  "flags": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string"
    },
    {
      "name": "orderedIds",
      "required": true,
      "target": "body.orderedIds",
      "type": "string[]"
    }
  ],
  "method": "post",
  "path": "/kanban/statuses/reorder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
