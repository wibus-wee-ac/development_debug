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
    "folder",
    "create"
  ],
  "description": "Create workspace folder",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    },
    {
      "name": "confirmedNonCradleOwnedWrite",
      "required": true,
      "target": "body.confirmedNonCradleOwnedWrite",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/workspaces/{id}/files/folder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
