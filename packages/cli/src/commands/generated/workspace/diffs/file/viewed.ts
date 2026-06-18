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
      "name": "fileId",
      "required": true,
      "target": "path.fileId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "file",
    "viewed"
  ],
  "description": "Set diff review file viewed state",
  "flags": [
    {
      "name": "viewed",
      "required": true,
      "target": "body.viewed",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/files/{fileId}/viewed"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
