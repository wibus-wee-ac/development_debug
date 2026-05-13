// Input: generated OpenAPI CLI operation metadata
// Output: issue delegate command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "issue",
    "delegate"
  ],
  "description": "Delegate issue",
  "flags": [
    {
      "name": "agentProfileId",
      "required": true,
      "target": "body.agentProfileId",
      "type": "string"
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/kanban/issues/{id}/delegation"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
