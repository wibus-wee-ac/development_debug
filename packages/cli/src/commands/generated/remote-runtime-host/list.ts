import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "remote-runtime-host",
    "list"
  ],
  "description": "List remote runtime hosts",
  "flags": [],
  "method": "get",
  "path": "/remote-runtime-hosts"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
