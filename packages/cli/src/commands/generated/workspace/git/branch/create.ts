// Input: generated OpenAPI CLI operation metadata
// Output: workspace git branch create command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
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
    "branch",
    "create"
  ],
  "description": "Create branch",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "from",
      "required": false,
      "target": "body.from",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/git/branches"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
