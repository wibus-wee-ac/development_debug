// Input: generated OpenAPI CLI operation metadata
// Output: issue list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "list"
  ],
  "description": "List issues",
  "flags": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "query.workspaceId",
      "type": "string"
    },
    {
      "name": "milestoneId",
      "required": false,
      "target": "query.milestoneId",
      "type": "string"
    },
    {
      "name": "parentIssueId",
      "required": false,
      "target": "query.parentIssueId",
      "type": "string"
    },
    {
      "name": "priority",
      "required": false,
      "target": "query.priority",
      "type": "string"
    },
    {
      "name": "labels",
      "required": false,
      "target": "query.labels",
      "type": "string[]"
    },
    {
      "name": "statusId",
      "required": false,
      "target": "query.statusId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/issues/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
