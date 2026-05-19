// Input: generated OpenAPI CLI operation metadata
// Output: session await-list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "await-list"
  ],
  "description": "List session awaits",
  "flags": [
    {
      "name": "sessionId",
      "required": true,
      "target": "query.sessionId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/session-awaits/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
