// Input: generated OpenAPI CLI operation metadata
// Output: issue-agent-session rerun command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'agentSessionId',
      required: true,
      target: 'path.agentSessionId',
      type: 'string',
    },
  ],
  command: [
    'issue-agent-session',
    'rerun',
  ],
  description: 'Rerun session',
  flags: [
    {
      name: 'agentId',
      required: false,
      target: 'body.agentId',
      type: 'string',
    },
  ],
  method: 'post',
  path: '/issue-agent-sessions/{agentSessionId}/rerun',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
