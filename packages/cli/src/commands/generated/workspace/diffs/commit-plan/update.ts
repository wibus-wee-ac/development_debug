import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    },
    {
      "name": "reviewId",
      "required": true,
      "target": "path.reviewId",
      "type": "string"
    },
    {
      "name": "commitPlanId",
      "required": true,
      "target": "path.commitPlanId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "commit-plan",
    "update"
  ],
  "description": "Update diff review commit plan",
  "flags": [
    {
      "name": "groups",
      "required": false,
      "target": "body.groups",
      "type": "json"
    },
    {
      "name": "rationale",
      "required": false,
      "target": "body.rationale",
      "type": "string"
    },
    {
      "name": "status",
      "required": false,
      "target": "body.status",
      "type": "string",
      "values": [
        "draft",
        "accepted",
        "abandoned"
      ]
    }
  ],
  "method": "put",
  "path": "/workspaces/{id}/diff-reviews/{reviewId}/commit-plans/{commitPlanId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
