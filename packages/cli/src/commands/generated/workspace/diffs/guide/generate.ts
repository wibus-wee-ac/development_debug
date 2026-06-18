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
    "guide",
    "generate"
  ],
  "description": "Generate a guided diff review",
  "flags": [
    {
      "name": "providerTargetId",
      "required": true,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string",
      "values": [
        "codex",
        "claude-agent"
      ]
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "force",
      "required": false,
      "target": "body.force",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/guide/generate"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
