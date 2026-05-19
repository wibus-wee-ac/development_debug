// Input: generated OpenAPI CLI operation metadata
// Output: skill list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "list"
  ],
  "description": "List skills",
  "flags": [
    {
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string"
    },
    {
      "name": "agentId",
      "required": false,
      "target": "query.agentId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/skills"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
