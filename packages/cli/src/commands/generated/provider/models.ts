// Input: generated OpenAPI CLI operation metadata
// Output: provider models command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "provider",
    "models"
  ],
  "description": "List models for a provider",
  "flags": [
    {
      "name": "providerKind",
      "required": true,
      "target": "body.providerKind",
      "type": "string"
    },
    {
      "name": "label",
      "required": true,
      "target": "body.label",
      "type": "string"
    },
    {
      "name": "config",
      "required": true,
      "target": "body.config",
      "type": "json"
    },
    {
      "name": "secretRef",
      "required": false,
      "target": "body.secretRef",
      "type": "string"
    },
    {
      "name": "profileId",
      "required": false,
      "target": "body.profileId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/providers/models"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
