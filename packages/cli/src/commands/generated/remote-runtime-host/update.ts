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
    "update"
  ],
  "description": "Update a remote runtime host",
  "flags": [
    {
      "name": "displayName",
      "required": false,
      "target": "body.displayName",
      "type": "string"
    },
    {
      "name": "sshTarget",
      "required": false,
      "target": "body.sshTarget",
      "type": "string"
    },
    {
      "name": "remoteSocketPath",
      "required": false,
      "target": "body.remoteSocketPath",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "transport",
      "required": false,
      "target": "body.transport",
      "type": "string",
      "values": [
        "ssh",
        "direct-socket",
        "relay"
      ]
    },
    {
      "name": "sshProfile",
      "required": false,
      "target": "body.sshProfile",
      "type": "json"
    },
    {
      "name": "localSocketPath",
      "required": false,
      "target": "body.localSocketPath",
      "type": "string"
    },
    {
      "name": "connectTimeoutMs",
      "required": false,
      "target": "body.connectTimeoutMs",
      "type": "string"
    },
    {
      "name": "connectionConfig",
      "required": false,
      "target": "body.connectionConfig",
      "type": "json"
    }
  ],
  "method": "patch",
  "path": "/remote-runtime-hosts/{hostId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
