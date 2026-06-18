import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
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
    },
    {
      "name": "threadId",
      "required": true,
      "target": "path.threadId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "thread",
    "comment"
  ],
  "description": "Add diff review comment",
  "flags": [
    {
      "name": "bodyMarkdown",
      "required": true,
      "target": "body.bodyMarkdown",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/threads/{threadId}/comments"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
