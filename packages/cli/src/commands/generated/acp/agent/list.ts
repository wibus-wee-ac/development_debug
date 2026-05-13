// Input: generated OpenAPI CLI operation metadata
// Output: acp agent list command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "agent",
    "list"
  ],
  "description": "List installed agents",
  "flags": [],
  "method": "get",
  "path": "/acp/agents"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
