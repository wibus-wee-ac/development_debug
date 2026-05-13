// Input: generated OpenAPI CLI operation metadata
// Output: workflow-rule list command registration
// Position: packages/cli generated command module

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
    "list"
  ],
  "description": "List workflow rules",
  "flags": [],
  "method": "get",
  "path": "/workflow-rules/{workspaceId}/list"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
