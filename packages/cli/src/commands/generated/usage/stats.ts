// Input: generated OpenAPI CLI operation metadata
// Output: usage stats command registration
// Position: packages/cli generated command module

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "stats"
  ],
  "description": "Get usage stats",
  "flags": [],
  "method": "get",
  "path": "/usage/stats"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
