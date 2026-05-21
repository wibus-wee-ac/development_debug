import { Command } from 'commander'

import { getCommandContext } from './context'
import { printResult } from './output'
import type { CliOperationSpec, CliOutputFormat, CliValueType } from './types'

function findSubcommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

const UPPER_CASE_RE = /[A-Z]/g

function toKebabCase(value: string): string {
  return value.replace(UPPER_CASE_RE, char => `-${char.toLowerCase()}`)
}

function describeGroup(name: string): string | undefined {
  const descriptions: Record<string, string> = {
    'acp': 'Manage ACP agents',
    'agent': 'Manage Cradle agents',
    'approval': 'Manage pending approvals',
    'automation': 'Manage scheduled automations',
    'board': 'Manage kanban boards',
    'branch': 'Manage git branches',
    'chat': 'Manage chat runtime commands',
    'comment': 'Manage issue comments',
    'context': 'Manage context references',
    'context-ref': 'Manage issue context references',
    'cost': 'Inspect usage costs',
    'document': 'Manage documents',
    'export': 'Export resources',
    'file': 'Manage workspace files',
    'git': 'Manage workspace git state',
    'issue': 'Manage kanban issues',
    'issue-agent-session': 'Manage issue agent sessions',
    'linked-issue': 'Manage session issue links',
    'milestone': 'Manage kanban milestones',
    'observability': 'Inspect observability data',
    'preferences': 'Manage server preferences',
    'profile': 'Manage agent profiles',
    'provider': 'Inspect providers',
    'search': 'Search Cradle data',
    'secret': 'Manage secret metadata',
    'session': 'Manage chat sessions',
    'skill': 'Manage skills',
    'source': 'Manage external sources',
    'status': 'Manage kanban statuses',
    'usage': 'Inspect usage data',
    'workflow': 'Manage workflow rules',
    'workflow-rule': 'Manage workflow rules',
    'workspace': 'Manage workspaces',
  }
  return descriptions[name]
}

function getOrCreateGroup(parent: Command, name: string): Command {
  const existing = findSubcommand(parent, name)
  if (existing) {
    return existing
  }
  const command = parent.command(name)
  const description = describeGroup(name)
  if (description) {
    command.description(description)
  }
  return command
}

function setTarget(target: string, value: unknown, containers: {
  body: Record<string, unknown>
  path: Record<string, unknown>
  query: Record<string, unknown>
}): void {
  const [scope, key] = target.split('.')
  if (!scope || !key) {
    throw new Error(`Invalid CLI target: ${target}`)
  }
  if (scope !== 'body' && scope !== 'path' && scope !== 'query') {
    throw new Error(`Unsupported CLI target scope: ${scope}`)
  }
  containers[scope][key] = value
}

function parseValue(value: unknown, type: CliValueType | undefined): unknown {
  if (value === undefined) {
    return undefined
  }
  if (!type || type === 'string') {
    return value
  }
  if (type === 'number') {
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      throw new TypeError(`Expected a number, received ${String(value)}`)
    }
    return parsed
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }
    if (value === 'true') {
      return true
    }
    if (value === 'false') {
      return false
    }
    throw new TypeError(`Expected a boolean, received ${String(value)}`)
  }
  if (type === 'string[]') {
    if (Array.isArray(value)) {
      return value
    }
    return String(value).split(',').map(item => item.trim()).filter(Boolean)
  }
  if (type === 'json') {
    if (typeof value !== 'string') {
      return value
    }
    return JSON.parse(value) as unknown
  }
  return value
}

function parseFormat(value: unknown): CliOutputFormat {
  if (value === 'auto' || value === 'json' || value === 'pretty' || value === 'table' || value === 'ndjson') {
    return value
  }
  throw new Error(`Unsupported format: ${String(value)}`)
}

function parseJsonFields(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const fields = value.split(',').map(field => field.trim()).filter(Boolean)
  return fields.length > 0 ? fields : undefined
}

function hasValues(record: Record<string, unknown>): boolean {
  return Object.values(record).some(value => value !== undefined)
}

export function registerOperationCommand(root: Command, spec: CliOperationSpec): void {
  const segments = spec.command
  if (segments.length === 0) {
    throw new Error(`${spec.method.toUpperCase()} ${spec.path} has no command path`)
  }

  let parent = root
  for (const segment of segments.slice(0, -1)) {
    parent = getOrCreateGroup(parent, segment)
  }

  const leaf = new Command(segments.at(-1)!)
  leaf.description(spec.description ?? `${spec.method.toUpperCase()} ${spec.path}`)
  leaf.option('--format <format>', 'Output format: auto, json, pretty, table, ndjson', 'auto')
  leaf.option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')

  for (const argument of spec.arguments ?? []) {
    const name = argument.required === false ? `[${argument.name}]` : `<${argument.name}>`
    leaf.argument(name, argument.description)
  }

  for (const flag of spec.flags ?? []) {
    const optionName = toKebabCase(flag.name)
    const description = flag.values?.length
      ? `${flag.description ?? ''}${flag.description ? ' ' : ''}Allowed: ${flag.values.join(', ')}`
      : flag.description
    const option = flag.type === 'boolean' && flag.required
      ? `--${optionName} <value>`
      : flag.type === 'boolean'
        ? `--${optionName}`
        : `--${optionName} <value>`
    if (flag.required) {
      leaf.requiredOption(option, description)
    }
    else {
      leaf.option(option, description)
      if (flag.type === 'boolean') {
        leaf.option(`--no-${optionName}`, description)
      }
    }
  }

  leaf.action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command
    const opts = command.opts<Record<string, unknown> & { format?: string, json?: boolean | string }>()
    const containers = { body: {}, path: {}, query: {} } as {
      body: Record<string, unknown>
      path: Record<string, unknown>
      query: Record<string, unknown>
    }

    for (const [index, argument] of (spec.arguments ?? []).entries()) {
      setTarget(argument.target, parseValue(args[index], argument.type), containers)
    }

    for (const flag of spec.flags ?? []) {
      setTarget(flag.target, parseValue(opts[flag.name], flag.type), containers)
    }

    const context = getCommandContext(command)
    const result = await context.request({
      body: hasValues(containers.body) ? containers.body : undefined,
      method: spec.method,
      path: containers.path,
      query: containers.query,
      template: spec.path,
    })

    printResult(result, {
      forceJson: opts.json !== undefined,
      format: parseFormat(opts.format),
      jsonFields: parseJsonFields(opts.json),
    })
  })

  parent.addCommand(leaf)
}
