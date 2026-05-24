import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "agent",
    "update"
  ],
  "description": "Update agent",
  "flags": [
    {
      "name": "name",
      "required": false,
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
      "required": false,
      "target": "body.avatarStyle",
      "type": "string"
    },
    {
      "name": "avatarSeed",
      "required": false,
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
      "name": "providerTargetKind",
      "required": false,
      "target": "body.providerTargetKind",
      "type": "string"
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
    },
    {
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/agents/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
