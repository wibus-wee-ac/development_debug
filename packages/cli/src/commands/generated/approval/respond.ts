import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "approvalId",
      "required": true,
      "target": "path.approvalId",
      "type": "string"
    }
  ],
  "command": [
    "approval",
    "respond"
  ],
  "description": "Respond to a pending approval",
  "flags": [
    {
      "name": "decision",
      "required": true,
      "target": "body.decision",
      "type": "string",
      "values": [
        "approved",
        "rejected"
      ]
    },
    {
      "name": "selectedOptionId",
      "required": true,
      "target": "body.selectedOptionId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/approvals/{approvalId}/respond"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
