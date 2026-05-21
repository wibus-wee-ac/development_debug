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
      "required": false,
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
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string",
      "values": [
        "standard",
        "claude-agent",
        "codex",
        "jar-core",
        "acp-chat",
        "cli-tui"
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
