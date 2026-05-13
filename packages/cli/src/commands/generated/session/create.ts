// Input: generated OpenAPI CLI operation metadata
// Output: session create command registration
// Position: packages/cli generated command module

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
      "required": true,
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
      "name": "agentProfileId",
      "required": true,
      "target": "body.agentProfileId",
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
