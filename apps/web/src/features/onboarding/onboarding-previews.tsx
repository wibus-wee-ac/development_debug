// Output: Onboarding step preview panels — realistic product UI mockups with cursor waypoints.
// Input: Step index; renders the matching product preview.
// Position: Right-side visual in OnboardingPage, paired with AnimatedCursorLayer.

import {
  ActivityIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CodeIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  SparklesIcon,
  TerminalIcon,
  ZapIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/cn'

import type { CursorWaypoint } from './animated-cursor'

// ── Waypoint definitions per step ─────────────────────────────────────────────

export const STEP_WAYPOINTS: CursorWaypoint[][] = [
  // Step 0 – Welcome: sweep around the app shell
  [
    { x: 8, y: 30, dwell: 800 },
    { x: 8, y: 50, dwell: 600 },
    { x: 8, y: 70, dwell: 600 },
    { x: 50, y: 50, dwell: 1000 },
    { x: 82, y: 30, dwell: 700 },
    { x: 82, y: 60, dwell: 700 },
  ],
  // Step 1 – Chat: click composer, then scroll messages
  [
    { x: 55, y: 88, dwell: 1200 },
    { x: 55, y: 65, dwell: 900 },
    { x: 30, y: 35, dwell: 700 },
    { x: 30, y: 55, dwell: 700 },
    { x: 78, y: 30, dwell: 600 },
  ],
  // Step 2 – Workspace: click project, then file
  [
    { x: 28, y: 28, dwell: 1000 },
    { x: 28, y: 45, dwell: 700 },
    { x: 28, y: 62, dwell: 700 },
    { x: 65, y: 40, dwell: 1000 },
    { x: 65, y: 60, dwell: 700 },
  ],
  // Step 3 – Agents: watch agent steps run
  [
    { x: 50, y: 20, dwell: 1000 },
    { x: 50, y: 42, dwell: 800 },
    { x: 50, y: 60, dwell: 800 },
    { x: 80, y: 78, dwell: 700 },
  ],
  // Step 4 – Done: hover action buttons
  [
    { x: 50, y: 60, dwell: 1200 },
    { x: 28, y: 75, dwell: 900 },
    { x: 50, y: 75, dwell: 900 },
    { x: 72, y: 75, dwell: 900 },
  ],
]

// ── Step 0 — Welcome App Shell ─────────────────────────────────────────────────

export function WelcomePreview() {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
      {/* Sidebar */}
      <div className="flex w-12 flex-col items-center gap-3 border-r border-border px-2 py-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
          <SparklesIcon className="size-3.5 text-primary-foreground" />
        </div>
        <Separator />
        {[MessageSquareIcon, FolderIcon, BotIcon, ZapIcon, ActivityIcon].map((Icon, i) => (
          <button
            key={i}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg transition-colors',
              i === 0 ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
        <div className="mt-auto">
          <button className="flex size-8 items-center justify-center rounded-lg text-muted-foreground">
            <Settings2Icon className="size-4" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-10 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              <SparklesIcon className="size-2.5" />
              Home
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-10 rounded-md" />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          {/* Sessions list */}
          <div className="flex w-52 flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Recent</p>
            {[
              { label: 'Auth module review', time: '2m', icon: CodeIcon },
              { label: 'Refactor data layer', time: '1h', icon: FileTextIcon },
              { label: 'CI pipeline fix', time: '3h', icon: TerminalIcon },
              { label: 'Browse docs', time: '1d', icon: GlobeIcon },
            ].map((s, i) => (
              <div
                key={i}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  i === 0 ? 'bg-muted/70 text-foreground' : 'text-muted-foreground',
                )}
              >
                <s.icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs">{s.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">{s.time}</span>
              </div>
            ))}
          </div>

          <Separator orientation="vertical" />

          {/* Quick dispatch */}
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">Quick dispatch</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: CodeIcon, label: 'Code', color: 'text-blue-500' },
                { icon: GlobeIcon, label: 'Browse', color: 'text-green-500' },
                { icon: FileTextIcon, label: 'Summarise', color: 'text-amber-500' },
                { icon: ZapIcon, label: 'Automate', color: 'text-purple-500' },
              ].map((a, i) => (
                <div
                  key={i}
                  className="flex cursor-default items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
                >
                  <a.icon className={cn('size-3.5 shrink-0', a.color)} />
                  <span className="text-xs font-medium">{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Step 1 — Chat Preview ──────────────────────────────────────────────────────

const MOCK_MESSAGES = [
  {
    role: 'user' as const,
    text: 'Analyse the auth module and suggest improvements',
  },
  {
    role: 'assistant' as const,
    text: "I'll review `apps/server/src/auth` now.\n\n**Findings**\n- JWT refresh doesn't rotate token\n- bcrypt cost 10 → consider argon2id\n- `/auth/login` lacks rate-limiting",
  },
]

export function ChatPreview() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
      {/* Tab bar */}
      <div className="flex h-9 items-center gap-0.5 border-b border-border px-3">
        <div className="flex h-7 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground">
          <MessageSquareIcon className="size-3" />
          Auth review
        </div>
        <div className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground">
          <BotIcon className="size-3" />
          New chat
        </div>
        <button className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-3">
        {MOCK_MESSAGES.map((msg, i) => (
          <div
            key={i}
            className={cn('flex gap-2.5', msg.role === 'user' && 'justify-end')}
          >
            {msg.role === 'assistant' && (
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                  AI
                </AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-foreground',
              )}
            >
              {msg.text.split('\n').map((line, j) => (
                <p key={j} className={j > 0 ? 'mt-1' : ''}>
                  {line || '\u00A0'}
                </p>
              ))}
            </div>
            {msg.role === 'user' && (
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback className="text-[10px]">Me</AvatarFallback>
              </Avatar>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        <div className="flex gap-2.5">
          <Avatar size="sm" className="mt-0.5 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
              AI
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-2.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="size-1.5 rounded-full bg-muted-foreground/50"
                style={{ animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5">
          <span className="flex-1 text-xs text-muted-foreground/60">
            Message Cradle…
          </span>
          <button className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <SendIcon className="size-2.5" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {['Claude Sonnet 4', 'claude-3-7-sonnet', 'GPT-4o'].map((m, i) => (
            <Badge key={i} variant={i === 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {m}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step 2 — Workspace Preview ─────────────────────────────────────────────────

const MOCK_FILES = [
  { name: 'src/', type: 'dir' },
  { name: '  auth/', type: 'dir' },
  { name: '    login.ts', type: 'file', active: true },
  { name: '    refresh.ts', type: 'file' },
  { name: '    middleware.ts', type: 'file' },
  { name: '  routes/', type: 'dir' },
  { name: '    index.ts', type: 'file' },
  { name: 'tests/', type: 'dir' },
  { name: '  auth.test.ts', type: 'file', changed: true },
]

export function WorkspacePreview() {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
      {/* Sidebar — projects */}
      <div className="flex w-44 flex-col border-r border-border">
        <div className="flex h-9 items-center justify-between px-3 text-xs font-medium text-muted-foreground">
          <span>Workspaces</span>
          <button>
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <Separator />
        <div className="flex flex-col gap-0.5 p-1.5">
          {[
            { name: 'my-app', branch: 'main', active: true },
            { name: 'api-service', branch: 'dev' },
            { name: 'docs-site', branch: 'main' },
          ].map((p, i) => (
            <div
              key={i}
              className={cn(
                'flex cursor-default flex-col rounded-lg px-2 py-2 transition-colors',
                p.active ? 'bg-muted/80 text-foreground' : 'text-muted-foreground',
              )}
            >
              <div className="flex items-center gap-1.5">
                <FolderIcon className="size-3 shrink-0" />
                <span className="text-xs font-medium">{p.name}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 pl-4.5">
                <GitBranchIcon className="size-2.5 text-muted-foreground/60" />
                <span className="text-[10px] text-muted-foreground/70">{p.branch}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* File tree + editor preview */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-9 items-center gap-1.5 border-b border-border px-3">
          <FolderIcon className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">my-app</span>
          <ChevronRightIcon className="size-3 text-muted-foreground/50" />
          <span className="text-xs font-medium text-foreground">auth / login.ts</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            <GitBranchIcon className="size-2.5" />
            feat/auth-refactor
          </Badge>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Mini file tree */}
          <div className="w-36 border-r border-border py-2">
            {MOCK_FILES.map((f, i) => (
              <div
                key={i}
                className={cn(
                  'flex cursor-default items-center gap-1 px-2 py-0.5 text-[11px] transition-colors',
                  f.active
                    ? 'bg-muted/70 text-foreground'
                    : f.changed
                      ? 'text-amber-500'
                      : 'text-muted-foreground',
                )}
              >
                {f.type === 'dir'
                  ? <FolderIcon className="size-3 shrink-0" />
                  : <FileTextIcon className="size-3 shrink-0" />}
                <span className="truncate">{f.name.trimStart()}</span>
              </div>
            ))}
          </div>

          {/* Code editor mockup */}
          <div className="flex-1 overflow-hidden bg-muted/20 p-3 font-mono">
            {[
              'import { sign } from \'jsonwebtoken\'',
              '',
              'export async function login(',
              '  email: string,',
              '  password: string,',
              ') {',
              '  const user = await db.users',
              '    .findFirst({ email })',
              '',
              '  // TODO: add rate-limiting',
              '  const valid = await',
              '    bcrypt.compare(password,',
              '      user.passwordHash)',
            ].map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground/40">
                  {i + 1}
                </span>
                <span
                  className={cn(
                    'text-[10px] leading-5',
                    line.startsWith('  // TODO')
                      ? 'text-amber-500/80'
                      : line.startsWith('import') || line.startsWith('export')
                        ? 'text-blue-400/80 dark:text-blue-300/80'
                        : 'text-foreground/70',
                  )}
                >
                  {line || '\u00A0'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Step 3 — Agents Preview ────────────────────────────────────────────────────

const AGENT_STEPS = [
  { label: 'Reading test output…', done: true, icon: TerminalIcon },
  { label: 'Patching `auth.test.ts`…', done: true, icon: FileTextIcon },
  { label: 'Updating CI workflow…', done: false, running: true, icon: Loader2Icon },
  { label: 'Push changes', done: false, icon: GitBranchIcon },
]

export function AgentsPreview() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <BotIcon className="size-3.5 text-primary" />
          <span className="text-xs font-medium">Agent · Code</span>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          <Loader2Icon className="size-2.5 animate-spin" />
          Running
        </Badge>
      </div>

      {/* Goal */}
      <div className="border-b border-border bg-muted/30 px-4 py-2.5">
        <p className="text-[11px] font-medium text-muted-foreground">Goal</p>
        <p className="mt-0.5 text-xs text-foreground">
          Fix the failing auth tests and update the CI config
        </p>
      </div>

      {/* Steps */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
        {AGENT_STEPS.map((step, i) => (
          <div
            key={i}
            className={cn(
              'flex items-start gap-3 rounded-lg p-3 ring-1 transition-colors',
              step.running
                ? 'bg-primary/5 ring-primary/20'
                : step.done
                  ? 'bg-muted/40 ring-transparent'
                  : 'bg-background ring-border/50',
            )}
          >
            <div
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                step.done
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : step.running
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {step.done
                ? <CheckIcon className="size-3" />
                : step.running
                  ? <step.icon className="size-3 animate-spin" />
                  : <step.icon className="size-3" />}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <p
                className={cn(
                  'text-xs font-medium',
                  step.done
                    ? 'text-muted-foreground line-through'
                    : step.running
                      ? 'text-foreground'
                      : 'text-muted-foreground/60',
                )}
              >
                {step.label}
              </p>
              {step.running && (
                <Progress value={62} className="h-0.5 w-full" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Skills badges */}
      <div className="flex items-center gap-1.5 border-t border-border px-4 py-2.5">
        <span className="text-[10px] text-muted-foreground">Skills:</span>
        {['shell', 'filesystem', 'git'].map(s => (
          <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
        ))}
      </div>
    </div>
  )
}

// ── Step 4 — Done Preview ──────────────────────────────────────────────────────

export function DonePreview() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10 px-8">
      {/* Hero icon */}
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
        <SparklesIcon className="size-8 text-primary" />
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <h3 className="text-base font-semibold text-foreground">Cradle is ready</h3>
        <p className="max-w-55 text-xs text-muted-foreground">
          Powerful AI at your fingertips. Pick an action to begin.
        </p>
      </div>

      {/* Action cards */}
      <div className="flex w-full flex-col gap-2">
        {[
          {
            icon: MessageSquareIcon,
            label: 'New chat',
            description: 'Start a conversation',
            primary: true,
          },
          {
            icon: FolderIcon,
            label: 'Add workspace',
            description: 'Connect a local project',
            primary: false,
          },
          {
            icon: Settings2Icon,
            label: 'Settings',
            description: 'Configure models & keys',
            primary: false,
          },
        ].map((action, i) => (
          <div
            key={i}
            className={cn(
              'flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors',
              action.primary
                ? 'bg-primary/8 ring-primary/25 text-primary'
                : 'bg-muted/30 ring-border/50 text-muted-foreground',
            )}
          >
            <div
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                action.primary ? 'bg-primary/15' : 'bg-muted',
              )}
            >
              <action.icon className={cn('size-4', action.primary ? 'text-primary' : 'text-muted-foreground')} />
            </div>
            <div className="flex-1">
              <p className={cn('text-xs font-medium', action.primary ? 'text-foreground' : 'text-foreground')}>{action.label}</p>
              <p className="text-[10px] text-muted-foreground">{action.description}</p>
            </div>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
          </div>
        ))}
      </div>
    </div>
  )
}
