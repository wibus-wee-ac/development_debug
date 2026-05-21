import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "document",
    "get"
  ],
  "description": "Get skill document",
  "flags": [
    {
      "name": "scope",
      "required": true,
      "target": "query.scope",
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
      "target": "query.name",
      "type": "string"
    },
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
  "path": "/skills/document"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
