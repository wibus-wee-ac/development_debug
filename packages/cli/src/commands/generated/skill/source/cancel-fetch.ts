// Input: generated OpenAPI CLI operation metadata
// Output: skill source cancel-fetch command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "source",
    "cancel-fetch"
  ],
  "description": "Cancel fetch",
  "flags": [
    {
      "name": "sessionId",
      "required": true,
      "target": "body.sessionId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/skills/cancel-fetch"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
