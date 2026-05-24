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
    "diff"
  ],
  "description": "Get git diff",
  "flags": [
    {
      "name": "paths",
      "required": false,
      "target": "query.paths",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/{id}/git/diff"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
