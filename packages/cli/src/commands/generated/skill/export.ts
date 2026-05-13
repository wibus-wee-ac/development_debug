// Input: generated OpenAPI CLI operation metadata
// Output: skill export command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "export"
  ],
  "description": "Export skill",
  "flags": [
    {
      "name": "scope",
      "required": true,
      "target": "body.scope",
      "type": "string",
      "values": [
        "builtin",
        "legacy",
        "global",
        "workspace",
        "agent"
      ]
    },
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "destinationDir",
      "required": true,
      "target": "body.destinationDir",
      "type": "string"
    },
    {
      "name": "overwrite",
      "required": false,
      "target": "body.overwrite",
      "type": "boolean"
    },
    {
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
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
  "path": "/skills/export"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
