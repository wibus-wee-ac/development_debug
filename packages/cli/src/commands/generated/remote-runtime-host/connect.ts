import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "connect"
  ],
  "description": "Connect to a remote runtime host daemon",
  "flags": [],
  "method": "post",
  "path": "/remote-runtime-hosts/{hostId}/connect"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
