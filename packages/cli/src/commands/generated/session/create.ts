import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "create"
  ],
  "description": "Create session",
  "flags": [
    {
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string"
    },
    {
      "name": "title",
      "required": true,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string"
    },
    {
      "name": "id",
      "required": false,
      "target": "body.id",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/sessions/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
