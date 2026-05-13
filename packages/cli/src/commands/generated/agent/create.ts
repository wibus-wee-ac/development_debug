// Input: generated OpenAPI CLI operation metadata
// Output: agent create command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "agent",
    "create"
  ],
  "description": "Create agent",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "description",
      "required": false,
      "target": "body.description",
      "type": "string"
    },
    {
      "name": "avatarStyle",
      "required": true,
      "target": "body.avatarStyle",
      "type": "string"
    },
    {
      "name": "avatarSeed",
      "required": true,
      "target": "body.avatarSeed",
      "type": "string"
    },
    {
      "name": "agentProfileId",
      "required": true,
      "target": "body.agentProfileId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "thinkingEffort",
      "required": false,
      "target": "body.thinkingEffort",
      "type": "string",
      "values": [
        "low",
        "medium",
        "high",
        "auto"
      ]
    },
    {
      "name": "configJson",
      "required": false,
      "target": "body.configJson",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/agents/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
