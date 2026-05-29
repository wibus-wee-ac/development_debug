import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sessionId",
      "required": true,
      "target": "path.sessionId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "queue",
    "add"
  ],
  "description": "Enqueue a chat continuation for the session",
  "flags": [
    {
      "name": "mode",
      "required": true,
      "target": "body.mode",
      "type": "string",
      "values": [
        "queue",
        "steer"
      ]
    },
    {
      "name": "text",
      "required": false,
      "target": "body.text",
      "type": "string"
    },
    {
      "name": "files",
      "required": false,
      "target": "body.files",
      "type": "json"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
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
        "high"
      ]
    },
    {
      "name": "permissionMode",
      "required": false,
      "target": "body.permissionMode",
      "type": "string",
      "values": [
        "bypassPermissions",
        "plan"
      ]
    }
  ],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/queue"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
