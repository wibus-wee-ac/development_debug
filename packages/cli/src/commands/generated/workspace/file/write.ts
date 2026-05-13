// Input: generated OpenAPI CLI operation metadata
// Output: workspace file write command registration
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
    "file",
    "write"
  ],
  "description": "Write workspace file content",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    },
    {
      "name": "content",
      "required": true,
      "target": "body.content",
      "type": "string"
    }
  ],
  "method": "put",
  "path": "/workspaces/{id}/files/content"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
