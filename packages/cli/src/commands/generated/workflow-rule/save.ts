import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string"
    }
  ],
  "command": [
    "workflow-rule",
    "save"
  ],
  "description": "Save workflow rule",
  "flags": [
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "content",
      "required": true,
      "target": "body.content",
      "type": "string"
    }
  ],
  "method": "put",
  "path": "/workflow-rules/{workspaceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
