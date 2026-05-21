import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "status",
    "list"
  ],
  "description": "List issue statuses",
  "flags": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "query.workspaceId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/issues/statuses"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
