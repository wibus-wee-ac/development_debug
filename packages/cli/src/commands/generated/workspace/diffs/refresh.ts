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
    },
    {
      "name": "reviewId",
      "required": true,
      "target": "path.reviewId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "refresh"
  ],
  "description": "Refresh diff review source",
  "flags": [],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
