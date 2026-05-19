// Input: generated OpenAPI CLI operation metadata
// Output: status list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "status",
    "list"
  ],
  "description": "List statuses",
  "flags": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "query.workspaceId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/kanban/statuses"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
