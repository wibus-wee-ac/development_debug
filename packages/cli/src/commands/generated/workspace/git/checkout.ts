// Input: generated OpenAPI CLI operation metadata
// Output: workspace git checkout command registration
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
    "workspace",
    "git",
    "checkout"
  ],
  "description": "Checkout branch",
  "flags": [
    {
      "name": "branch",
      "required": true,
      "target": "body.branch",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/git/checkout"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
