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
    "start"
  ],
  "description": "Start diff review agent fix run",
  "flags": [
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/agent-fixes/{agentFixId}/start"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
