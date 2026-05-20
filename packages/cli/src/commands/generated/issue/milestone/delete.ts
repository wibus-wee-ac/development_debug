// Input: generated OpenAPI CLI operation metadata
// Output: issue milestone delete command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "issue",
    "milestone",
    "delete"
  ],
  "description": "Delete issue milestone",
  "flags": [],
  "method": "delete",
  "path": "/issues/milestones/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
