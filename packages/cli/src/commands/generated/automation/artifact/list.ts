// Input: generated OpenAPI CLI operation metadata
// Output: automation artifact list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "automation",
    "artifact",
    "list"
  ],
  "description": "List automation artifacts",
  "flags": [],
  "method": "get",
  "path": "/automations/{id}/artifacts"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
