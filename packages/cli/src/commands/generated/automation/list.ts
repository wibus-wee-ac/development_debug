// Input: generated OpenAPI CLI operation metadata
// Output: automation list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "automation",
    "list"
  ],
  "description": "List automations",
  "flags": [
    {
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": false,
      "target": "query.enabled",
      "type": "boolean"
    }
  ],
  "method": "get",
  "path": "/automations/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
