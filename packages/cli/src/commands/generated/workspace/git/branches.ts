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
    "branches"
  ],
  "description": "Get git branches",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "query.repo",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/{id}/git/branches"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
