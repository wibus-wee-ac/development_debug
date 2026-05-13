// Input: generated OpenAPI CLI operation metadata
// Output: workspace git status command registration
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
    "status"
  ],
  "description": "Get git status",
  "flags": [],
  "method": "get",
  "path": "/workspaces/{id}/git/status"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
