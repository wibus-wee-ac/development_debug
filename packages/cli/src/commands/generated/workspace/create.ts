// Input: generated OpenAPI CLI operation metadata
// Output: workspace create command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "create"
  ],
  "description": "Create workspace",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
