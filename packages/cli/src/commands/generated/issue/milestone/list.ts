// Input: generated OpenAPI CLI operation metadata
// Output: issue milestone list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "milestone",
    "list"
  ],
  "description": "List issue milestones",
  "flags": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "query.workspaceId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/issues/milestones"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
