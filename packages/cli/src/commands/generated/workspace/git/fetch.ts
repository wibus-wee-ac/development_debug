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
    "fetch"
  ],
  "description": "Fetch remote",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "body.repo",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/git/fetch"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
