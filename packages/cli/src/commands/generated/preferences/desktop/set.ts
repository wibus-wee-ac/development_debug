import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "desktop",
    "set"
  ],
  "description": "Set desktop preferences",
  "flags": [
    {
      "name": "requireDoubleCommandQToQuit",
      "required": true,
      "target": "body.requireDoubleCommandQToQuit",
      "type": "boolean"
    }
  ],
  "method": "put",
  "path": "/preferences/desktop"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
