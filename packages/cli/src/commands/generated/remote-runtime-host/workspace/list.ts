import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "hostId",
      "required": true,
      "target": "path.hostId",
      "type": "string"
    }
  ],
  "command": [
    "remote-runtime-host",
    "workspace",
    "list"
  ],
  "description": "List workspaces exposed by a remote runtime host",
  "flags": [
    {
      "name": "root",
      "required": false,
      "target": "query.root",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/remote-runtime-hosts/{hostId}/workspaces"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
