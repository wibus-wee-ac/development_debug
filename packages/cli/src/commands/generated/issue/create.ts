// Input: generated OpenAPI CLI operation metadata
// Output: issue create command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'issue',
    'create',
  ],
  description: 'Create issue',
  flags: [
    {
      name: 'workspaceId',
      required: true,
      target: 'body.workspaceId',
      type: 'string',
    },
    {
      name: 'title',
      required: true,
      target: 'body.title',
      type: 'string',
    },
    {
      name: 'description',
      required: false,
      target: 'body.description',
      type: 'string',
    },
    {
      name: 'priority',
      required: false,
      target: 'body.priority',
      type: 'string',
      values: [
        'none',
        'low',
        'medium',
        'high',
        'urgent',
      ],
    },
    {
      name: 'labels',
      required: false,
      target: 'body.labels',
      type: 'string[]',
    },
    {
      name: 'milestoneId',
      required: false,
      target: 'body.milestoneId',
      type: 'string',
    },
    {
      name: 'parentIssueId',
      required: false,
      target: 'body.parentIssueId',
      type: 'string',
    },
    {
      name: 'statusId',
      required: false,
      target: 'body.statusId',
      type: 'string',
    },
  ],
  method: 'post',
  path: '/kanban/issues',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
