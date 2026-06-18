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
    "submit"
  ],
  "description": "Submit local diff review decision",
  "flags": [
    {
      "name": "decision",
      "required": true,
      "target": "body.decision",
      "type": "string",
      "values": [
        "approve",
        "request-changes",
        "comment"
      ]
    },
    {
      "name": "bodyMarkdown",
      "required": false,
      "target": "body.bodyMarkdown",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/submit"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
