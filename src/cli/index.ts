#!/usr/bin/env tsx

import { Command } from 'commander'

import { rpcCall } from './rpc-client.js'

const program = new Command()
  .name('cradle')
  .description('Cradle CLI — control Cradle from the terminal')
  .version('0.1.0')

// ─── Workspace ───

const ws = program.command('workspace').description('Manage workspaces')

ws.command('list')
  .description('List all workspaces')
  .action(async () => {
    const result = await rpcCall('workspace.list')
    console.log(JSON.stringify(result, null, 2))
  })

ws.command('resolve')
  .description('Resolve workspace by directory path')
  .argument('[path]', 'Directory path (defaults to cwd)', process.cwd())
  .action(async (dirPath: string) => {
    const result = await rpcCall('workspace.resolveByPath', [dirPath])
    if (!result) {
      console.error('No workspace found for path:', dirPath)
      process.exit(1)
    }
    console.log(JSON.stringify(result, null, 2))
  })

ws.command('get')
  .description('Get workspace by ID')
  .argument('<id>', 'Workspace ID')
  .action(async (id: string) => {
    const result = await rpcCall('workspace.get', [id])
    console.log(JSON.stringify(result, null, 2))
  })

// ─── Helper: resolve workspace ID from cwd or --workspace flag ───

async function resolveWorkspaceId(opts: { workspace?: string }): Promise<string> {
  if (opts.workspace) {
    return opts.workspace
  }
  const resolved = await rpcCall('workspace.resolveByPath', [process.cwd()]) as { id: string } | null
  if (!resolved) {
    console.error('No workspace found for cwd. Use --workspace <id> or run from a known workspace directory.')
    process.exit(1)
  }
  return resolved.id
}

// ─── Board ───

const board = program.command('board').description('Manage Kanban boards')

board.command('list')
  .description('List boards')
  .option('-w, --workspace <id>', 'Workspace ID (defaults to cwd resolution)')
  .action(async (opts: { workspace?: string }) => {
    const wsId = await resolveWorkspaceId(opts)
    const result = await rpcCall('kanban.listBoards', [wsId])
    console.log(JSON.stringify(result, null, 2))
  })

// ─── Status ───

const status = program.command('status').description('Manage Kanban statuses')

status.command('list')
  .description('List statuses for workspace')
  .option('-w, --workspace <id>', 'Workspace ID (defaults to cwd resolution)')
  .action(async (opts: { workspace?: string }) => {
    const wsId = await resolveWorkspaceId(opts)
    const result = await rpcCall('kanban.listStatuses', [wsId])
    console.log(JSON.stringify(result, null, 2))
  })

// ─── Issue ───

const issue = program.command('issue').description('Manage Kanban issues')

issue.command('list')
  .description('List issues')
  .option('-w, --workspace <id>', 'Workspace ID')
  .option('--milestone <id>', 'Filter by milestone')
  .option('--status <id>', 'Filter by status')
  .option('--assignee <id>', 'Filter by assignee')
  .action(async (opts: { workspace?: string, milestone?: string, status?: string, assignee?: string }) => {
    const wsId = await resolveWorkspaceId(opts)
    const params: Record<string, unknown> = { workspaceId: wsId }
    if (opts.milestone) {
      params.milestoneId = opts.milestone
    }
    if (opts.status) {
      params.statusId = opts.status
    }
    if (opts.assignee) {
      params.assigneeId = opts.assignee
    }
    const result = await rpcCall('kanban.listIssues', [params])
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('get')
  .description('Get issue by ID')
  .argument('<id>', 'Issue ID')
  .action(async (id: string) => {
    const result = await rpcCall('kanban.getIssue', [id])
    if (!result) {
      console.error('Issue not found:', id)
      process.exit(1)
    }
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('create')
  .description('Create a new issue')
  .option('-w, --workspace <id>', 'Workspace ID')
  .requiredOption('-t, --title <title>', 'Issue title')
  .option('-d, --description <text>', 'Issue description')
  .option('-s, --status <id>', 'Status ID')
  .option('-p, --priority <level>', 'Priority (0-4)')
  .action(async (opts: { workspace?: string, title: string, description?: string, status?: string, priority?: string }) => {
    const wsId = await resolveWorkspaceId(opts)
    const input: Record<string, unknown> = { workspaceId: wsId, title: opts.title }
    if (opts.description) {
      input.description = opts.description
    }
    if (opts.status) {
      input.statusId = opts.status
    }
    if (opts.priority) {
      input.priority = Number.parseInt(opts.priority)
    }
    const result = await rpcCall('kanban.createIssue', [input])
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('update')
  .description('Update an issue')
  .argument('<id>', 'Issue ID')
  .option('-t, --title <title>', 'New title')
  .option('-d, --description <text>', 'New description')
  .option('-p, --priority <level>', 'Priority (0-4)')
  .action(async (id: string, opts: { title?: string, description?: string, priority?: string }) => {
    const patch: Record<string, unknown> = {}
    if (opts.title) {
      patch.title = opts.title
    }
    if (opts.description) {
      patch.description = opts.description
    }
    if (opts.priority) {
      patch.priority = Number.parseInt(opts.priority)
    }
    const result = await rpcCall('kanban.updateIssue', [id, patch])
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('move')
  .description('Move issue to a status')
  .argument('<id>', 'Issue ID')
  .argument('<statusId>', 'Target status ID')
  .action(async (id: string, statusId: string) => {
    const result = await rpcCall('kanban.moveIssue', [id, statusId])
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('delegate')
  .description('Delegate issue to an agent')
  .argument('<issueId>', 'Issue ID')
  .argument('<agentProfileId>', 'Agent profile ID')
  .action(async (issueId: string, agentProfileId: string) => {
    const result = await rpcCall('issueAgent.delegateIssue', [issueId, agentProfileId])
    console.log(JSON.stringify(result, null, 2))
  })

issue.command('undelegate')
  .description('Cancel issue delegation')
  .argument('<issueId>', 'Issue ID')
  .action(async (issueId: string) => {
    await rpcCall('issueAgent.undelegateIssue', [issueId])
    console.log('Done')
  })

issue.command('delete')
  .description('Delete an issue')
  .argument('<id>', 'Issue ID')
  .action(async (id: string) => {
    await rpcCall('kanban.deleteIssue', [id])
    console.log('Done')
  })

// ─── Comment ───

const comment = issue.command('comment').description('Manage issue comments')

comment.command('list')
  .description('List comments on an issue')
  .argument('<issueId>', 'Issue ID')
  .action(async (issueId: string) => {
    const result = await rpcCall('kanban.listComments', [issueId])
    console.log(JSON.stringify(result, null, 2))
  })

comment.command('add')
  .description('Add a comment to an issue')
  .argument('<issueId>', 'Issue ID')
  .argument('<content>', 'Comment text')
  .option('--author-kind <kind>', 'Author kind', 'agent')
  .action(async (issueId: string, content: string, opts: { authorKind: string }) => {
    const result = await rpcCall('kanban.addComment', [{ issueId, content, authorKind: opts.authorKind }])
    console.log(JSON.stringify(result, null, 2))
  })

comment.command('delete')
  .description('Delete a comment')
  .argument('<id>', 'Comment ID')
  .action(async (id: string) => {
    await rpcCall('kanban.deleteComment', [id])
    console.log('Done')
  })

// ─── Agent ───

const agent = program.command('agent').description('Manage agents')

agent.command('list')
  .description('List all agents')
  .action(async () => {
    const result = await rpcCall('agent.list')
    console.log(JSON.stringify(result, null, 2))
  })

agent.command('get')
  .description('Get agent by ID')
  .argument('<id>', 'Agent ID')
  .action(async (id: string) => {
    const result = await rpcCall('agent.get', [id])
    console.log(JSON.stringify(result, null, 2))
  })

program.parseAsync()
