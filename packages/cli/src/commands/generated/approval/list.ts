// Input: generated OpenAPI CLI operation metadata
// Output: approval list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "approval",
    "list"
  ],
  "description": "List pending approvals",
  "flags": [
    {
      "name": "chatSessionId",
      "required": false,
      "target": "query.chatSessionId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/approvals/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
