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
    "rename"
  ],
  "description": "Rename workspace file path",
  "flags": [
    {
      "name": "sourcePath",
      "required": true,
      "target": "body.sourcePath",
      "type": "string"
    },
    {
      "name": "destinationPath",
      "required": true,
      "target": "body.destinationPath",
      "type": "string"
    },
    {
      "name": "confirmedNonCradleOwnedWrite",
      "required": true,
      "target": "body.confirmedNonCradleOwnedWrite",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/workspaces/{id}/files/path"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
