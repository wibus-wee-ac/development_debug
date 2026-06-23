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
    "relay",
    "pairing-token"
  ],
  "description": "Create relay pairing tokens for a remote runtime host",
  "flags": [
    {
      "name": "relayUrl",
      "required": false,
      "target": "body.relayUrl",
      "type": "string"
    },
    {
      "name": "relayServerId",
      "required": false,
      "target": "body.relayServerId",
      "type": "string"
    },
    {
      "name": "ttlMs",
      "required": false,
      "target": "body.ttlMs",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/remote-runtime-hosts/{hostId}/relay/pairing-token"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
