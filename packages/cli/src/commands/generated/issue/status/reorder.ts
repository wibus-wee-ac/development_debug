import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "status",
    "reorder"
  ],
  "description": "Reorder issue statuses",
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
  "path": "/issues/statuses/reorder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
