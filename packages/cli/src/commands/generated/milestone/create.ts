// Input: generated OpenAPI CLI operation metadata
// Output: milestone create command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "milestone",
    "create"
  ],
  "description": "Create milestone",
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
      "name": "description",
      "required": false,
      "target": "body.description",
      "type": "string"
    },
    {
      "name": "dueDate",
      "required": false,
      "target": "body.dueDate",
      "type": "number"
    },
    {
      "name": "status",
      "required": false,
      "target": "body.status",
      "type": "string",
      "values": [
        "open",
        "closed"
      ]
    }
  ],
  "method": "post",
  "path": "/kanban/milestones"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
