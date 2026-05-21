import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "board",
    "list"
  ],
  "description": "List Kanban boards",
  "flags": [
    {
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/kanban/boards"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
