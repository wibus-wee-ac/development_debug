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
    "readiness"
  ],
  "description": "List diff review source readiness",
  "flags": [],
  "method": "get",
  "path": "/workspaces/{id}/diff-reviews/source-readiness"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
