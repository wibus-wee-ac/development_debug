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
    "diffs",
    "local-working-tree"
  ],
  "description": "Create or refresh local working tree diff review",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "body.repo",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/diff-reviews/local-working-tree"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
