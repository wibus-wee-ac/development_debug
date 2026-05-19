// Input: generated OpenAPI CLI operation metadata
// Output: skill source fetch command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "source",
    "fetch"
  ],
  "description": "Fetch skill source",
  "flags": [
    {
      "name": "source",
      "required": true,
      "target": "body.source",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/skills/fetch-source"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
