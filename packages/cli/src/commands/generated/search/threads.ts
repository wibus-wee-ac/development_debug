// Input: generated OpenAPI CLI operation metadata
// Output: search threads command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "search",
    "threads"
  ],
  "description": "Search threads",
  "flags": [
    {
      "name": "query",
      "required": true,
      "target": "query.query",
      "type": "string"
    },
    {
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    },
    {
      "name": "snippetsPerHit",
      "required": false,
      "target": "query.snippetsPerHit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/search/threads"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
