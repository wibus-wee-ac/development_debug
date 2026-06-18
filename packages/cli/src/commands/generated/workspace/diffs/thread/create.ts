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
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "thread",
    "create"
  ],
  "description": "Create diff review thread",
  "flags": [
    {
      "name": "fileId",
      "required": false,
      "target": "body.fileId",
      "type": "string"
    },
    {
      "name": "anchor",
      "required": false,
      "target": "body.anchor",
      "type": "json"
    },
    {
      "name": "bodyMarkdown",
      "required": true,
      "target": "body.bodyMarkdown",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/threads"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
