// Input: generated OpenAPI CLI operation metadata
// Output: session export markdown command registration
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
    "session",
    "export",
    "markdown"
  ],
  "description": "Export session as markdown",
  "flags": [],
  "method": "get",
  "path": "/sessions/{id}/export/markdown"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
