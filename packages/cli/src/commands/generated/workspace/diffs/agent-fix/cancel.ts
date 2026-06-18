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
      "name": "agentFixId",
      "required": true,
      "target": "path.agentFixId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "agent-fix",
    "cancel"
  ],
  "description": "Cancel diff review agent fix run",
  "flags": [],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/agent-fixes/{agentFixId}/cancel"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
