import type { UIMessage } from 'ai'
import {
  ActivityIcon,
  BarChart3Icon,
  BotIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  Code2Icon,
  ClockIcon,
  FileDiffIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GlobeIcon,
  HomeIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PanelBottomIcon,
  PanelLeftCloseIcon,
  PanelRightIcon,
  PinIcon,
  PlusIcon,
  RssIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SquareTerminalIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, LayoutGroup, m } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { RuntimeSelector } from '~/features/composer-toolbar/runtime-selector'
import type { ModelsByProfileId, ProviderModelOption, ThinkingEffort } from '~/features/composer-toolbar/types'
import { ToolCallBlock } from '~/features/chat/blocks/tool-call-block'
import { Composer } from '~/features/chat/composer'
import { MessageBubble } from '~/features/chat/message-bubble'
import type { MentionItem } from '~/features/chat/mention-panel'
import type { SkillMentionItem } from '~/features/chat/skill-mention-panel'
import { KanbanBoard } from '~/features/kanban/kanban-board'
import type { KanbanCardRuntimeData } from '~/features/kanban/kanban-card'
import type { ParentIssueRef } from '~/features/kanban/shared/parent-issue-ref'
import type { ViewConfig } from '~/features/kanban/use-view-config'
import { cn } from '~/lib/cn'
import type { Agent, KanbanIssue, KanbanMilestone, KanbanStatus, ModelDescriptor, RuntimeKind, Workspace } from '~/lib/types'

import { AnimatedCursorLayer } from './animated-cursor'
import type { CursorWaypoint } from './animated-cursor'

interface OnboardingProductPreviewProps {
  step: number
}

type OnboardingKey = keyof typeof import('~/locales/default').default.onboarding
type Translate = (key: OnboardingKey) => string
type CenterRoute = 'new-chat' | 'chat' | 'workspace' | 'agent'
type AsideTab = 'files' | 'changes' | 'git' | 'issue' | 'runtime' | 'await'
type PreviewAction
  = 'open-aside'
    | 'open-new-chat'
    | 'select-workspace'
    | 'select-model'
    | 'compose-draft'
    | 'apply-quick-prompt'
    | 'send-draft'
    | 'open-workspace'
    | 'select-issue'
    | 'move-issue'
    | 'open-issue-aside'
    | 'open-agent'
    | 'agent-read'
    | 'agent-edit'
    | 'agent-check'
    | 'open-runtime-aside'
    | 'open-changes-aside'
    | 'open-await-aside'

interface PreviewInitialState {
  centerRoute: CenterRoute
  asideOpen: boolean
  asideTab: AsideTab
  draft: string
  workspaceSelected: boolean
  providerTargetId: string
  modelId: string
  selectedIssueId: string | null
  movedIssue: boolean
  agentPhase: number
}

interface PreviewData {
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  issues: KanbanIssue[]
  messages: UIMessage[]
  skills: SkillMentionItem[]
}

const STEP_WAYPOINTS: CursorWaypoint[][] = [
  [
    { target: 'header-aside-toggle', dwell: 840, action: 'open-aside' },
    { target: 'new-chat-workspace-selector', anchorX: 0.35, dwell: 820, action: 'select-workspace' },
    { target: 'new-chat-quick-explain', anchorX: 0.45, dwell: 840, action: 'apply-quick-prompt' },
  ],
  [
    { target: 'composer-model-picker-trigger', anchorX: 0.45, dwell: 760, action: 'select-model' },
    { target: 'new-chat-textarea', anchorX: 0.28, anchorY: 0.45, dwell: 920, action: 'compose-draft' },
    { target: 'new-chat-send-btn', dwell: 840, action: 'send-draft' },
  ],
  [
    { target: 'sidebar-workspace-cradle', dwell: 760, action: 'open-workspace' },
    { target: 'issue-card-issue-1', anchorX: 0.62, dwell: 820, action: 'select-issue' },
    { target: 'right-aside-tab-issue', dwell: 820, action: 'open-issue-aside' },
    { target: 'issue-status-started', anchorX: 0.72, dwell: 820, action: 'move-issue' },
  ],
  [
    { target: 'sidebar-session-agent', dwell: 760, action: 'open-agent' },
    { target: 'agent-tool-read', anchorX: 0.42, dwell: 820, action: 'agent-read' },
    { target: 'agent-tool-edit', anchorX: 0.42, dwell: 820, action: 'agent-edit' },
    { target: 'agent-tool-check', anchorX: 0.42, dwell: 820, action: 'agent-check' },
    { target: 'right-aside-tab-await', dwell: 760, action: 'open-await-aside' },
  ],
  [
    { target: 'right-aside-tab-changes', dwell: 820, action: 'open-changes-aside' },
    { target: 'new-chat-textarea', anchorX: 0.26, anchorY: 0.42, dwell: 820, action: 'compose-draft' },
    { target: 'new-chat-send-btn', dwell: 760, action: 'send-draft' },
  ],
]

const MOCK_WORKSPACE: Workspace = {
  id: 'workspace-cradle',
  name: 'Cradle',
  path: '/Users/wibus/dev/Cradle',
  identifier: 'CRA',
  pinned: 1,
  createdAt: 1779775200,
  updatedAt: 1779861600,
}

const MOCK_AGENT: Agent = {
  id: 'agent-codex',
  name: 'Codex',
  description: 'Local coding agent',
  avatarUrl: null,
  avatarStyle: 'bottts-neutral',
  avatarSeed: 'codex-preview',
  providerTargetId: 'provider-openai',
  modelId: 'gpt-5.1-codex',
  thinkingEffort: 'auto',
  runtimeKind: 'codex',
  configJson: '{}',
  enabled: true,
  createdAt: 1779775200,
  updatedAt: 1779861600,
}

const MOCK_KANBAN_RUNTIME: KanbanCardRuntimeData = {
  workspaces: [MOCK_WORKSPACE],
  agents: [MOCK_AGENT],
}

const MOCK_PROVIDER_TARGETS: ProviderModelOption[] = [
  {
    id: 'provider-openai',
    kind: 'manual',
    name: 'OpenAI',
    providerKind: 'openai-compatible',
    enabled: true,
    iconSlug: null,
  },
]

const MOCK_MODELS: ModelDescriptor[] = [
  {
    id: 'gpt-5.1-codex',
    label: 'GPT-5.1 Codex',
    providerKind: 'openai-compatible',
    capabilities: {
      reasoning: true,
      toolCall: true,
      inputModalities: ['text', 'image'],
      contextWindow: 256000,
      family: 'gpt-5.1',
    },
  },
]

const MOCK_MODELS_BY_PROFILE: ModelsByProfileId = {
  'provider-openai': [MOCK_MODELS[0]!],
}

const MOCK_FILES: MentionItem[] = [
  { type: 'directory', name: 'apps', path: 'apps' },
  { type: 'directory', name: 'web', path: 'apps/web' },
  { type: 'file', name: 'onboarding-page.tsx', path: 'apps/web/src/features/onboarding/onboarding-page.tsx' },
  { type: 'file', name: 'kanban-board.tsx', path: 'apps/web/src/features/kanban/kanban-board.tsx' },
]

const MOCK_VIEW_CONFIG: ViewConfig = {
  layout: 'board',
  groupBy: 'status',
  orderBy: 'manual',
  orderDirection: 'asc',
  showEmptyGroups: true,
  displayProperties: {
    id: true,
    priority: true,
    status: false,
    labels: true,
    assignee: true,
    subIssueProgress: false,
    agentIndicator: true,
    milestone: false,
    dueDate: false,
    createdAt: false,
  },
}

const MOCK_PARENT_REFS = new Map<string, ParentIssueRef>()
const EMPTY_PROVIDER_LOADING_IDS = new Set<string>()

function createPreviewData(t: Translate): PreviewData {
  const statuses: KanbanStatus[] = [
    {
      id: 'status-triage',
      workspaceId: MOCK_WORKSPACE.id,
      name: t('preview.kanban.status.triage'),
      color: null,
      category: 'triage',
      order: 0,
      createdAt: 1779775200,
    },
    {
      id: 'status-started',
      workspaceId: MOCK_WORKSPACE.id,
      name: t('preview.kanban.status.started'),
      color: null,
      category: 'started',
      order: 1,
      createdAt: 1779775200,
    },
    {
      id: 'status-completed',
      workspaceId: MOCK_WORKSPACE.id,
      name: t('preview.kanban.status.completed'),
      color: null,
      category: 'completed',
      order: 2,
      createdAt: 1779775200,
    },
  ]

  const milestones: KanbanMilestone[] = [
    {
      id: 'milestone-preview',
      workspaceId: MOCK_WORKSPACE.id,
      title: t('preview.kanban.milestone.title'),
      description: t('preview.kanban.milestone.description'),
      dueDate: 1780210800,
      status: 'open',
      createdAt: 1779775200,
      updatedAt: 1779861600,
    },
  ]

  const issues: KanbanIssue[] = [
    {
      id: 'issue-1',
      workspaceId: MOCK_WORKSPACE.id,
      number: 18,
      statusId: 'status-triage',
      milestoneId: 'milestone-preview',
      parentIssueId: null,
      title: t('preview.kanban.issue.firstRun'),
      description: null,
      priority: 'high',
      labels: [t('preview.kanban.label.onboarding'), t('preview.kanban.label.ux')],
      assigneeKind: 'user',
      assigneeId: '__self__',
      dueDate: null,
      createdByKind: 'user',
      createdById: '__self__',
      delegateAgentId: null,
      delegateAgentProfileId: null,
      contextRefs: '[]',
      order: 0,
      createdAt: 1779775200,
      updatedAt: 1779861600,
    },
    {
      id: 'issue-2',
      workspaceId: MOCK_WORKSPACE.id,
      number: 19,
      statusId: 'status-started',
      milestoneId: 'milestone-preview',
      parentIssueId: null,
      title: t('preview.kanban.issue.mockData'),
      description: null,
      priority: 'urgent',
      labels: [t('preview.kanban.label.frontend'), t('preview.kanban.label.designSystem')],
      assigneeKind: null,
      assigneeId: null,
      dueDate: null,
      createdByKind: 'agent',
      createdById: MOCK_AGENT.id,
      delegateAgentId: MOCK_AGENT.id,
      delegateAgentProfileId: MOCK_AGENT.providerTargetId,
      contextRefs: '[]',
      order: 0,
      createdAt: 1779775200,
      updatedAt: 1779861600,
    },
    {
      id: 'issue-3',
      workspaceId: MOCK_WORKSPACE.id,
      number: 20,
      statusId: 'status-started',
      milestoneId: 'milestone-preview',
      parentIssueId: null,
      title: t('preview.kanban.issue.responsive'),
      description: null,
      priority: 'medium',
      labels: [t('preview.kanban.label.layout')],
      assigneeKind: null,
      assigneeId: null,
      dueDate: null,
      createdByKind: 'user',
      createdById: '__self__',
      delegateAgentId: null,
      delegateAgentProfileId: null,
      contextRefs: '[]',
      order: 1,
      createdAt: 1779775200,
      updatedAt: 1779861600,
    },
    {
      id: 'issue-4',
      workspaceId: MOCK_WORKSPACE.id,
      number: 21,
      statusId: 'status-completed',
      milestoneId: 'milestone-preview',
      parentIssueId: null,
      title: t('preview.kanban.issue.devOnly'),
      description: null,
      priority: 'low',
      labels: [t('preview.kanban.label.runtime')],
      assigneeKind: 'user',
      assigneeId: '__self__',
      dueDate: null,
      createdByKind: 'user',
      createdById: '__self__',
      delegateAgentId: null,
      delegateAgentProfileId: null,
      contextRefs: '[]',
      order: 0,
      createdAt: 1779775200,
      updatedAt: 1779861600,
    },
  ]

  const messages: UIMessage[] = [
    {
      id: 'preview-message-user',
      role: 'user',
      parts: [{ type: 'text', text: t('preview.chat.user') }],
    },
    {
      id: 'preview-message-assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: t('preview.chat.assistant') }],
    },
  ]

  const skills: SkillMentionItem[] = [
    {
      name: 'react-doctor',
      description: t('preview.skill.reactDoctor'),
      scope: 'workspace',
      skillDir: '/Users/wibus/dev/Cradle/.agents/skills/react-doctor',
    },
    {
      name: 'agent-browser',
      description: t('preview.skill.agentBrowser'),
      scope: 'workspace',
      skillDir: '/Users/wibus/dev/Cradle/.agents/skills/agent-browser',
    },
  ]

  return { statuses, milestones, issues, messages, skills }
}

function composerSignalKey(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function readPreviewAction(action?: string): PreviewAction | null {
  switch (action) {
    case 'open-aside':
    case 'open-new-chat':
    case 'select-workspace':
    case 'select-model':
    case 'compose-draft':
    case 'apply-quick-prompt':
    case 'send-draft':
    case 'open-workspace':
    case 'select-issue':
    case 'move-issue':
    case 'open-issue-aside':
    case 'open-agent':
    case 'agent-read':
    case 'agent-edit':
    case 'agent-check':
    case 'open-runtime-aside':
    case 'open-changes-aside':
    case 'open-await-aside':
      return action
    default:
      return null
  }
}

function createPreviewInitialState(step: number): PreviewInitialState {
  const base: PreviewInitialState = {
    centerRoute: 'new-chat',
    asideOpen: true,
    asideTab: 'files',
    draft: '',
    workspaceSelected: step >= 1,
    providerTargetId: 'provider-openai',
    modelId: 'gpt-5.1-codex',
    selectedIssueId: null,
    movedIssue: false,
    agentPhase: 0,
  }

  if (step === 0) {
    return {
      ...base,
      asideOpen: false,
      workspaceSelected: false,
    }
  }

  if (step === 2) {
    return {
      ...base,
      centerRoute: 'workspace',
      workspaceSelected: true,
    }
  }

  if (step === 3) {
    return {
      ...base,
      centerRoute: 'new-chat',
      workspaceSelected: true,
      asideTab: 'runtime',
    }
  }

  if (step === 4) {
    return {
      ...base,
      workspaceSelected: true,
      asideTab: 'files',
    }
  }

  return base
}

export function OnboardingProductPreview({ step }: OnboardingProductPreviewProps) {
  const { t } = useTranslation('onboarding')
  const translate = useMemo(() => ((key: OnboardingKey): string => t(key)), [t])
  const data = useMemo(() => createPreviewData(translate), [translate])
  const initialState = useMemo(() => createPreviewInitialState(step), [step])
  const [centerRoute, setCenterRoute] = useState<CenterRoute>(initialState.centerRoute)
  const [asideOpen, setAsideOpen] = useState(initialState.asideOpen)
  const [asideTab, setAsideTab] = useState<AsideTab>(initialState.asideTab)
  const [draft, setDraft] = useState(initialState.draft)
  const [workspaceSelected, setWorkspaceSelected] = useState(initialState.workspaceSelected)
  const [providerTargetId, setProviderTargetId] = useState(initialState.providerTargetId)
  const [modelId, setModelId] = useState(initialState.modelId)
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(initialState.selectedIssueId)
  const [movedIssue, setMovedIssue] = useState(initialState.movedIssue)
  const [agentPhase, setAgentPhase] = useState(initialState.agentPhase)

  const resetPreview = useCallback(() => {
    const next = createPreviewInitialState(step)
    setCenterRoute(next.centerRoute)
    setAsideOpen(next.asideOpen)
    setAsideTab(next.asideTab)
    setDraft(next.draft)
    setWorkspaceSelected(next.workspaceSelected)
    setProviderTargetId(next.providerTargetId)
    setModelId(next.modelId)
    setSelectedIssueId(next.selectedIssueId)
    setMovedIssue(next.movedIssue)
    setAgentPhase(next.agentPhase)
  }, [step])

  useEffect(() => {
    resetPreview()
  }, [resetPreview])

  const handleWaypointClick = useCallback((waypoint: CursorWaypoint) => {
    const action = readPreviewAction(waypoint.action)
    if (!action) {
      return
    }

    switch (action) {
      case 'open-aside':
        setAsideOpen(true)
        break
      case 'open-new-chat':
        setCenterRoute('new-chat')
        setDraft('')
        break
      case 'select-workspace':
        setAsideOpen(true)
        setWorkspaceSelected(true)
        setAsideTab('files')
        break
      case 'select-model':
        setProviderTargetId('provider-openai')
        setModelId('gpt-5.1-codex')
        break
      case 'compose-draft':
        setDraft(t('preview.chat.composerDraft'))
        break
      case 'apply-quick-prompt':
        setDraft(t('preview.newChat.quick.explain'))
        break
      case 'send-draft':
        setDraft('')
        setAsideOpen(true)
        setCenterRoute('chat')
        setAsideTab('runtime')
        setAgentPhase(1)
        break
      case 'open-workspace':
        setAsideOpen(true)
        setWorkspaceSelected(true)
        setCenterRoute('workspace')
        setAsideTab('files')
        break
      case 'select-issue':
        setSelectedIssueId('issue-1')
        break
      case 'move-issue':
        setMovedIssue(true)
        setSelectedIssueId('issue-1')
        break
      case 'open-issue-aside':
        setAsideOpen(true)
        setAsideTab('issue')
        break
      case 'open-agent':
        setAsideOpen(true)
        setCenterRoute('agent')
        setAsideTab('runtime')
        setAgentPhase(0)
        break
      case 'agent-read':
        setAgentPhase(1)
        break
      case 'agent-edit':
        setAgentPhase(2)
        break
      case 'agent-check':
        setAgentPhase(3)
        break
      case 'open-runtime-aside':
        setAsideOpen(true)
        setAsideTab('runtime')
        break
      case 'open-changes-aside':
        setAsideOpen(true)
        setAsideTab('changes')
        break
      case 'open-await-aside':
        setAsideOpen(true)
        setAsideTab('await')
        break
    }
  }, [t])

  return (
    <section
      className="relative flex h-full min-h-0 w-full overflow-hidden bg-sidebar text-foreground"
      data-onboarding-cursor-root
    >
      <PreviewSidebar
        activeRoute={centerRoute}
        workspaceSelected={workspaceSelected}
        t={translate}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-foreground">
        <PreviewHeader
          activeRoute={centerRoute}
          asideOpen={asideOpen}
          t={translate}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <m.div
            className="m-1 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-[var(--shadow-sm)]"
            layout
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
          >
            <main className="flex min-h-0 flex-1 overflow-hidden rounded-xl bg-background">
              <div className="min-w-0 flex-1 overflow-hidden">
                <AnimatePresence mode="wait" initial={false}>
                  <m.div
                    key={centerRoute}
                    className="h-full min-h-0"
                    initial={{ opacity: 0, x: 12, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: -10, filter: 'blur(4px)' }}
                    transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                  >
                    {centerRoute === 'workspace'
                      ? (
                          <WorkspaceRoute
                            data={data}
                            selectedIssueId={selectedIssueId}
                            movedIssue={movedIssue}
                          />
                        )
                      : centerRoute === 'agent'
                        ? <AgentRoute phase={agentPhase} t={translate} />
                        : centerRoute === 'chat'
                          ? (
                              <ChatRoute
                                data={data}
                                t={translate}
                                providerTargetId={providerTargetId}
                                modelId={modelId}
                              />
                            )
                          : (
                              <NewChatRoute
                                draft={draft}
                                selectedWorkspace={workspaceSelected ? MOCK_WORKSPACE : null}
                                providerTargetId={providerTargetId}
                                modelId={modelId}
                                onProviderTargetChange={setProviderTargetId}
                                onModelChange={setModelId}
                                skills={data.skills}
                                t={translate}
                              />
                            )}
                  </m.div>
                </AnimatePresence>
              </div>
            </main>
          </m.div>
          <m.div
            className="hidden shrink-0 bg-border/60 lg:block"
            aria-hidden="true"
            initial={false}
            animate={{ width: asideOpen ? 1 : 0, opacity: asideOpen ? 1 : 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
          />
          <m.aside
            className="hidden shrink-0 overflow-hidden bg-sidebar lg:flex"
            initial={false}
            animate={{
              width: asideOpen ? 236 : 0,
              opacity: asideOpen ? 1 : 0,
            }}
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
            data-testid="app-layout-right-aside"
            data-aside-open={asideOpen ? 'true' : 'false'}
          >
            <PreviewRightAside
              activeTab={asideTab}
              selectedIssueId={selectedIssueId}
              movedIssue={movedIssue}
              agentPhase={agentPhase}
              onTabChange={setAsideTab}
              t={translate}
            />
          </m.aside>
        </div>
      </div>

      <AnimatedCursorLayer
        key={`cursor-${step}`}
        waypoints={STEP_WAYPOINTS[step] ?? []}
        active
        startDelay={540}
        onLoopStart={resetPreview}
        onWaypointClick={handleWaypointClick}
      />
    </section>
  )
}

function PreviewSidebar({
  activeRoute,
  workspaceSelected,
  t,
}: {
  activeRoute: CenterRoute
  workspaceSelected: boolean
  t: Translate
}) {
  return (
    <aside
      className="hidden w-64 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground md:flex"
      data-testid="app-sidebar"
      data-sidebar-mode="main"
      data-sidebar-collapsed="false"
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
          <SidebarNavItem
            icon={MessageSquarePlusIcon}
            label={t('preview.sidebar.item.newChat')}
            active={activeRoute === 'new-chat' || activeRoute === 'chat'}
            target="sidebar-new-chat"
          />
          <SidebarNavItem
            icon={SearchIcon}
            label={t('preview.sidebar.item.search')}
            shortcut="⌘K"
          />
          <SidebarNavItem
            icon={CalendarClockIcon}
            label={t('preview.sidebar.item.automation')}
          />
          <SidebarNavItem
            icon={BarChart3Icon}
            label={t('preview.sidebar.item.usage')}
          />
          <SidebarNavItem
            icon={SettingsIcon}
            label={t('preview.sidebar.item.settings')}
            shortcut="⌘,"
          />
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-col">
            <SidebarSectionHeader
              label={t('preview.sidebar.section.kanban')}
              trailing={(
                <PlusIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
              )}
            />
            <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-2">
              <SidebarNavItem
                icon={FolderTreeIcon}
                label={t('preview.sidebar.kanban.board')}
                active={activeRoute === 'workspace'}
              />
              <SidebarNavItem
                icon={GitBranchIcon}
                label={t('preview.sidebar.kanban.milestone')}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <SidebarSectionHeader label={t('preview.sidebar.section.plugins')} />
            <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-2">
              <SidebarNavItem
                icon={BotIcon}
                label={t('preview.sidebar.plugin.codex')}
                active={activeRoute === 'agent'}
              />
              <SidebarNavItem
                icon={FolderOpenIcon}
                label={t('preview.sidebar.item.pluginLab')}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <SidebarSectionHeader
              label={t('preview.sidebar.section.projects')}
              trailing={(
                <div className="flex items-center gap-0.5">
                  <GitBranchIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
                  <PlusIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />
                </div>
              )}
            />
            <nav className="flex min-w-0 flex-col gap-0.5 px-2 pb-2" data-testid="workspace-list">
              <PreviewWorkspaceGroup
                activeRoute={activeRoute}
                workspaceSelected={workspaceSelected}
                t={t}
              />
            </nav>
          </div>
        </div>
      </div>
    </aside>
  )
}

function SidebarNavItem({
  icon: Icon,
  label,
  active = false,
  target,
  shortcut,
  trailing,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  target?: string
  shortcut?: string
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-onboarding-target={target}
      className={cn(
        'group flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 text-left text-xs',
        'transition-[background-color,color] duration-150 ease-out',
        active ? 'bg-accent/70 text-sidebar-foreground' : 'text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground',
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
      {shortcut && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100">
          {shortcut}
        </span>
      )}
      {trailing}
    </button>
  )
}

function SidebarSectionHeader({
  label,
  trailing,
}: {
  label: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center px-2.5 py-1.5">
      <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">
        {label}
      </span>
      {trailing}
    </div>
  )
}

function PreviewWorkspaceGroup({
  activeRoute,
  workspaceSelected,
  t,
}: {
  activeRoute: CenterRoute
  workspaceSelected: boolean
  t: Translate
}) {
  const workspaceActive = activeRoute === 'workspace' || workspaceSelected

  return (
    <div className="flex min-w-0 flex-col" data-testid="workspace-group-workspace-cradle" data-workspace-pinned="true">
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5',
          'transition-[background-color] duration-150 ease-out hover:bg-accent/50',
          workspaceActive && 'bg-accent/70',
        )}
        data-onboarding-target="sidebar-workspace-cradle"
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('preview.sidebar.workspace.toggle')}
          className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70"
        >
          <FolderOpenIcon className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <PinIcon className="size-3 shrink-0 text-primary/60" aria-hidden="true" />
          <span className="truncate text-xs font-medium text-sidebar-foreground/80">Cradle</span>
        </button>
        <MoreHorizontalIcon className="size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden="true" />
      </div>

      <m.div
        initial={false}
        animate={{ height: 'auto', opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
        className="min-w-0 overflow-hidden"
      >
        <div className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 py-0.5 pl-2">
          <PreviewSessionItem
            icon={MessageSquareIcon}
            label={t('preview.sidebar.session.onboarding')}
            active={activeRoute === 'chat'}
          />
          <PreviewSessionItem
            icon={BotIcon}
            label={t('preview.sidebar.session.agent')}
            active={activeRoute === 'agent'}
            target="sidebar-session-agent"
            running
          />
          <PreviewSessionItem
            icon={MessageSquareIcon}
            label={t('preview.sidebar.session.workspace')}
            active={false}
          />
          <button
            type="button"
            tabIndex={-1}
            className="mt-0.5 flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-sidebar-foreground"
          >
            <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{t('preview.sidebar.session.showAll')}</span>
          </button>
        </div>
      </m.div>
    </div>
  )
}

function PreviewSessionItem({
  icon: Icon,
  label,
  active,
  target,
  running,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  target?: string
  running?: boolean
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-onboarding-target={target}
      className={cn(
        'group flex h-7 min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
        'transition-[background-color,color] duration-150 ease-out',
        active ? 'bg-accent/70 text-sidebar-foreground' : 'text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {running && (
        <ActivityIcon className="size-3 shrink-0 animate-pulse text-primary" aria-hidden="true" />
      )}
    </button>
  )
}

function PreviewHeader({
  activeRoute,
  asideOpen,
  t,
}: {
  activeRoute: CenterRoute
  asideOpen: boolean
  t: Translate
}) {
  const tabs = [
    { id: 'home', label: t('preview.header.tab.home'), icon: HomeIcon, active: false },
    { id: 'new-chat', label: t('preview.header.tab.newChat'), icon: MessageSquarePlusIcon, active: activeRoute === 'new-chat' },
    { id: 'workspace', label: 'Cradle', icon: FolderIcon, active: activeRoute === 'workspace' },
    { id: 'agent', label: t('preview.header.tab.agentRun'), icon: BotIcon, active: activeRoute === 'agent' || activeRoute === 'chat' },
  ]

  return (
    <header className="relative mt-1 mb-0 flex h-11 shrink-0 items-center bg-sidebar pe-1 pl-1">
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground"
        tabIndex={-1}
        aria-label={t('preview.header.action.sidebar')}
      >
        <PanelLeftCloseIcon className="size-3.5" aria-hidden="true" />
      </Button>
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            tabIndex={-1}
            className={cn(
              'flex h-8 min-w-0 max-w-36 items-center gap-1.5 rounded-lg px-2 text-xs',
              'transition-[background-color,color] duration-150 ease-out',
              tab.active ? 'bg-background text-foreground shadow-[var(--shadow-xs)]' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <tab.icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          tabIndex={-1}
          aria-label={t('preview.header.action.browser')}
        >
          <GlobeIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          tabIndex={-1}
          aria-label={t('preview.header.action.panel')}
        >
          <PanelBottomIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            'text-muted-foreground transition-[background-color,color] duration-150 ease-out',
            asideOpen && 'bg-accent text-foreground',
          )}
          tabIndex={-1}
          aria-label={t('preview.header.action.aside')}
          data-onboarding-target="header-aside-toggle"
          data-active={asideOpen ? 'true' : 'false'}
        >
          <PanelRightIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}

function NewChatRoute({
  draft,
  selectedWorkspace,
  providerTargetId,
  modelId,
  onProviderTargetChange,
  onModelChange,
  skills,
  t,
}: {
  draft: string
  selectedWorkspace: Workspace | null
  providerTargetId: string
  modelId: string
  onProviderTargetChange: (id: string) => void
  onModelChange: (id: string) => void
  skills: SkillMentionItem[]
  t: Translate
}) {
  return (
    <div className="relative flex h-full flex-col bg-background" data-testid="new-chat-page" data-new-chat-ready="true">
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-4">
        <m.div
          className="w-full max-w-160"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 40 }}
        >
          <PreviewComposer
            replaceText={draft}
            selectedWorkspace={selectedWorkspace}
            providerTargetId={providerTargetId}
            modelId={modelId}
            onProviderTargetChange={onProviderTargetChange}
            onModelChange={onModelChange}
            skills={skills}
            t={t}
          />
          <div className="mt-3 flex flex-wrap gap-1.5 px-1">
            {[
              ['preview.newChat.quick.explain', 'new-chat-quick-explain'],
              ['preview.newChat.quick.risk', 'new-chat-quick-risk'],
              ['preview.newChat.quick.refactor', 'new-chat-quick-refactor'],
            ].map(([key, target]) => (
              <button
                key={key}
                type="button"
                tabIndex={-1}
                data-onboarding-target={target}
                className={cn(
                  'h-7 rounded-lg border border-border px-2.5',
                  'select-none text-[12px] text-muted-foreground/70',
                  'transition-[background-color,border-color,color] duration-150 ease-out',
                  'hover:bg-accent hover:text-foreground',
                )}
              >
                {t(key as OnboardingKey)}
              </button>
            ))}
          </div>
        </m.div>
      </div>
      <div className="hidden shrink-0 border-t border-border/50 px-6 py-4 xl:block">
        <div className="mx-auto grid max-w-160 grid-cols-3 gap-2">
          {[
            ['preview.newChat.recent.onboarding', ClockIcon],
            ['preview.newChat.recent.workspace', FolderIcon],
            ['preview.newChat.recent.agent', BotIcon],
          ].map(([key, Icon]) => (
            <button
              key={key as string}
              type="button"
              tabIndex={-1}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-[12px] text-muted-foreground"
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(key as OnboardingKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ChatRoute({
  data,
  providerTargetId,
  modelId,
  t,
}: {
  data: PreviewData
  providerTargetId: string
  modelId: string
  t: Translate
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {data.messages.map(message => (
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={false}
            />
          ))}
          <ToolCallBlock
            toolName="functions.exec_command"
            toolCallId="preview-tool-typecheck"
            state="output-available"
            input={{ command: 'pnpm --filter @cradle/web exec tsc --noEmit', timeout: 120000 }}
            output={{ stdout: t('preview.chat.toolOutput') }}
            animated={false}
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-border p-3">
        <PreviewComposer
          replaceText=""
          selectedWorkspace={MOCK_WORKSPACE}
          providerTargetId={providerTargetId}
          modelId={modelId}
          onProviderTargetChange={() => {}}
          onModelChange={() => {}}
          skills={data.skills}
          t={t}
        />
      </div>
    </div>
  )
}

function WorkspaceRoute({
  data,
  selectedIssueId,
  movedIssue,
}: {
  data: PreviewData
  selectedIssueId: string | null
  movedIssue: boolean
}) {
  const issues = useMemo(() => {
    if (!movedIssue) {
      return data.issues
    }
    return data.issues.map(issue => (
      issue.id === 'issue-1'
        ? { ...issue, statusId: 'status-started', order: 2 }
        : issue
    ))
  }, [data.issues, movedIssue])
  const selectedIssueIds = useMemo(
    () => selectedIssueId ? new Set([selectedIssueId]) : undefined,
    [selectedIssueId],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Badge variant="secondary">
          <FolderIcon className="size-3" aria-hidden="true" />
          Cradle
        </Badge>
        <Badge variant="outline">apps/web</Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <KanbanBoard
          workspaceId={MOCK_WORKSPACE.id}
          issues={issues}
          statuses={data.statuses}
          milestones={data.milestones}
          parentIssueRefs={MOCK_PARENT_REFS}
          config={MOCK_VIEW_CONFIG}
          onIssueClick={() => {}}
          onMoveIssue={() => {}}
          onCreateIssue={() => {}}
          highlightedIssueId={selectedIssueId}
          selectedIssueIds={selectedIssueIds}
          runtimeData={MOCK_KANBAN_RUNTIME}
        />
      </div>
    </div>
  )
}

function AgentRoute({ phase, t }: { phase: number, t: Translate }) {
  const steps = [
    {
      target: 'agent-tool-read',
      icon: FileIcon,
      title: t('preview.agent.plan.read'),
      detail: 'apps/web/src/features/onboarding/onboarding-page.tsx',
      active: phase === 1,
      done: phase >= 1,
    },
    {
      target: 'agent-tool-edit',
      icon: Code2Icon,
      title: t('preview.agent.plan.patch'),
      detail: 'onboarding-product-preview.tsx',
      active: phase === 2,
      done: phase >= 2,
    },
    {
      target: 'agent-tool-check',
      icon: SquareTerminalIcon,
      title: t('preview.agent.plan.typecheck'),
      detail: 'pnpm --filter @cradle/web exec tsc --noEmit',
      active: phase === 3,
      done: phase >= 3,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Badge variant="secondary">
          <BotIcon className="size-3" aria-hidden="true" />
          {t('preview.agent.runTitle')}
        </Badge>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">{t('preview.agent.taskTitle')}</span>
        <div className="ml-auto w-32">
          <Progress value={Math.max(12, phase * 33)} className="h-1.5" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div className="flex justify-end">
            <div className="max-w-[76%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground shadow-[0_12px_32px_rgba(0,0,0,0.12)] text-pretty">
              {t('preview.agent.userPrompt')}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <BotIcon className="size-3.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-background/80 p-3.5 shadow-[var(--shadow-xs)]">
              <p className="text-sm leading-relaxed text-foreground text-pretty">
                {t('preview.agent.assistantIntro')}
              </p>
              <div className="mt-3 grid gap-2">
                {steps.map(step => (
                  <AgentStepRow key={step.target} {...step} />
                ))}
              </div>
              {phase >= 3 && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-success/10 px-2.5 py-2 text-[12px] text-success">
                  <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{t('preview.agent.checkPassed')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentStepRow({
  target,
  icon: Icon,
  title,
  detail,
  active,
  done,
}: {
  target: string
  icon: LucideIcon
  title: string
  detail: string
  active: boolean
  done: boolean
}) {
  return (
    <div
      data-onboarding-target={target}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left',
        'transition-[background-color,box-shadow,transform] duration-200',
        active ? 'bg-primary/10 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.24)]' : 'bg-muted/45',
      )}
    >
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg',
          done ? 'bg-success/15 text-success' : 'bg-background text-muted-foreground',
        )}
      >
        {done ? <CheckCircle2Icon className="size-3.5" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-foreground">{title}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function PreviewComposer({
  replaceText,
  selectedWorkspace,
  providerTargetId,
  modelId,
  onProviderTargetChange,
  onModelChange,
  skills,
  t,
}: {
  replaceText: string
  selectedWorkspace: Workspace | null
  providerTargetId: string
  modelId: string
  onProviderTargetChange: (id: string) => void
  onModelChange: (id: string) => void
  skills: SkillMentionItem[]
  t: Translate
}) {
  const [runtimeKind, setRuntimeKind] = useState<RuntimeKind>('codex')
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium')
  const models = MOCK_MODELS_BY_PROFILE[providerTargetId] ?? []
  const selectedModel = models.find(model => model.id === modelId) ?? models[0] ?? null
  const replaceTextKey = useMemo(() => composerSignalKey(replaceText), [replaceText])

  const contextBar = (
    <button
      type="button"
      tabIndex={-1}
      data-onboarding-target="new-chat-workspace-selector"
      data-testid="new-chat-workspace-selector"
      className="inline-flex h-7 max-w-40 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground/60 hover:bg-accent hover:text-foreground"
    >
      <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{selectedWorkspace?.name ?? t('preview.newChat.workspace.adhoc')}</span>
    </button>
  )

  const toolbar = useMemo(() => (
    <div className="flex flex-wrap items-center gap-1">
      <RuntimeSelector value={runtimeKind} onChange={setRuntimeKind} />
      <div data-onboarding-target="composer-model-picker">
        <ProviderModelPicker
          triggerTestId="composer-model-picker-trigger"
          providerTargets={MOCK_PROVIDER_TARGETS}
          selectedProviderTargetId={providerTargetId}
          selectedModelId={selectedModel?.id ?? modelId}
          selectedModel={selectedModel}
          modelsByProviderTargetId={MOCK_MODELS_BY_PROFILE}
          loadingProviderTargetIds={EMPTY_PROVIDER_LOADING_IDS}
          thinkingValue={thinkingEffort}
          thinkingOptions={[
            { value: null, label: t('preview.thinking.auto.label'), description: t('preview.thinking.auto.description') },
            { value: 'low', label: t('preview.thinking.low.label'), description: t('preview.thinking.low.description') },
            { value: 'medium', label: t('preview.thinking.medium.label'), description: t('preview.thinking.medium.description') },
            { value: 'high', label: t('preview.thinking.high.label'), description: t('preview.thinking.high.description') },
          ]}
          onRequestProviderTargetModels={() => {}}
          onSelectProviderTarget={(id) => {
            onProviderTargetChange(id)
            onModelChange(MOCK_MODELS_BY_PROFILE[id]?.[0]?.id ?? '')
          }}
          onSelectModel={(id) => {
            if (id) {
              onModelChange(id)
            }
          }}
          onSelectThinking={setThinkingEffort}
        />
      </div>
    </div>
  ), [modelId, onModelChange, onProviderTargetChange, providerTargetId, runtimeKind, selectedModel, t, thinkingEffort])

  return (
    <Composer
      send={{
        submit: () => false,
        allowEmptySend: false,
      }}
      attachments={{ supportsAttachments: true }}
      slots={{ toolbar, contextBar }}
      externalSignals={{ replaceText, replaceTextKey }}
      view={{
        placeholder: t('preview.composer.placeholder'),
        availableFiles: MOCK_FILES,
        availableSkills: skills,
        sessionTokens: 18420,
        sessionContextWindow: 256000,
        className: 'relative',
        cardClassName: cn(
          'overflow-hidden rounded-2xl',
          'border-border/60 bg-background shadow-none',
          'ring-1 ring-inset ring-white/[0.02] dark:ring-white/[0.04]',
          'transition-[border-color,box-shadow] duration-200',
          'focus-within:border-ring/50 focus-within:shadow-[var(--shadow-xs)]',
        ),
        textareaRows: 5,
        textareaClassName: 'px-5 pt-5 pb-3 text-[15px] leading-[1.75] placeholder:text-muted-foreground/30 min-h-30 max-h-80 rounded-t-2xl disabled:opacity-30',
        attachmentListClassName: 'border-border/60 px-3 py-2',
        actionBarClassName: 'border-t border-border/60 px-2.5 py-2',
        toolbarClassName: 'px-3 pb-2',
        attachButtonClassName: 'text-muted-foreground/30',
        attachIconClassName: 'size-3',
        sendButtonClassName: 'ml-0.5',
      }}
      accessibility={{
        textareaAriaLabel: t('preview.composer.textareaAria'),
        sendButtonAriaLabel: t('preview.composer.sendAria'),
      }}
      testIds={{
        actionTarget: 'new-chat-composer-action-target',
        textarea: 'new-chat-textarea',
        fileInput: 'new-chat-file-input',
        attachButton: 'new-chat-attach-btn',
        sendButton: 'new-chat-send-btn',
      }}
    />
  )
}

function PreviewRightAside({
  activeTab,
  selectedIssueId,
  movedIssue,
  agentPhase,
  onTabChange,
  t,
}: {
  activeTab: AsideTab
  selectedIssueId: string | null
  movedIssue: boolean
  agentPhase: number
  onTabChange: (tab: AsideTab) => void
  t: Translate
}) {
  const tabs = [
    { id: 'files', label: t('preview.aside.tab.files'), icon: FolderTreeIcon },
    { id: 'changes', label: t('preview.aside.tab.changes'), icon: FileDiffIcon },
    { id: 'git', label: t('preview.aside.tab.git'), icon: GitBranchIcon },
    { id: 'issue', label: t('preview.aside.tab.issue'), icon: CircleDotIcon },
    { id: 'runtime', label: t('preview.aside.tab.runtime'), icon: ActivityIcon },
    { id: 'await', label: t('preview.aside.tab.await'), icon: RssIcon },
  ] satisfies Array<{ id: AsideTab, label: string, icon: typeof FolderTreeIcon }>

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside" data-active-tab={activeTab}>
      <div className="flex shrink-0 justify-center border-b border-border px-2 py-1.5">
        <LayoutGroup id="onboarding-right-aside-tabs">
          <div className="relative flex items-center justify-center gap-0.5">
            {tabs.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id
              const button = (
                <m.button
                  key={id}
                  type="button"
                  layout
                  tabIndex={-1}
                  onClick={() => onTabChange(id)}
                  aria-label={label}
                  data-testid={`right-aside-tab-${id}`}
                  data-onboarding-target={`right-aside-tab-${id}`}
                  data-active={isActive ? 'true' : 'false'}
                  initial={false}
                  transition={{ type: 'spring', stiffness: 480, damping: 31, mass: 0.8 }}
                  className={cn(
                    'relative z-10 grid h-7 place-items-center overflow-hidden rounded-md px-2 text-xs select-none',
                    'transition-[color] duration-150 ease-out',
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {isActive && (
                    <m.span
                      layoutId="onboarding-right-aside-tab-pill"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={{ type: 'spring', stiffness: 480, damping: 31, mass: 0.8 }}
                    />
                  )}
                  <span className="relative flex min-w-0 items-center justify-center">
                    <Icon className="relative size-3.5 shrink-0" aria-hidden="true" />
                    <m.span
                      aria-hidden={!isActive}
                      initial={false}
                      animate={{ width: isActive ? 'auto' : 0 }}
                      transition={{ width: { type: 'spring', stiffness: 390, damping: 32, mass: 0.8 } }}
                      className="block overflow-hidden"
                    >
                      <m.span
                        initial={false}
                        animate={{
                          opacity: isActive ? 1 : 0,
                          x: isActive ? 0 : 6,
                          filter: isActive ? 'blur(0px)' : 'blur(3px)',
                        }}
                        transition={{
                          opacity: { duration: 0.12, ease: 'easeOut', delay: 0.03 },
                          x: { duration: 0.24, ease: [0.16, 1, 0.3, 1], delay: 0.02 },
                          filter: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
                        }}
                        className="ml-1.5 block whitespace-nowrap text-left will-change-transform"
                      >
                        {label}
                      </m.span>
                    </m.span>
                  </span>
                </m.button>
              )

              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  {!isActive && (
                    <TooltipContent side="bottom" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </div>
        </LayoutGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={activeTab}
            className="h-full min-h-0"
            initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
          >
            {activeTab === 'files' && <AsideFiles t={t} />}
            {activeTab === 'changes' && <AsideChanges t={t} />}
            {activeTab === 'git' && <AsideGit t={t} />}
            {activeTab === 'issue' && <AsideIssue selectedIssueId={selectedIssueId} movedIssue={movedIssue} t={t} />}
            {activeTab === 'runtime' && <AsideRuntime phase={agentPhase} t={t} />}
            {activeTab === 'await' && <AsideAwait t={t} />}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function AsideFiles({ t }: { t: Translate }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
      <AsideRow icon={FolderIcon} label="apps" depth={0} open />
      <AsideRow icon={FolderIcon} label="web" depth={1} open />
      <AsideRow icon={FolderIcon} label="src" depth={2} open />
      <AsideRow icon={FolderIcon} label="features" depth={3} open />
      <AsideRow icon={FolderIcon} label="onboarding" depth={4} open active />
      <AsideRow icon={FileIcon} label="onboarding-page.tsx" depth={5} />
      <AsideRow icon={FileIcon} label="onboarding-product-preview.tsx" depth={5} active />
      <AsideRow icon={FileIcon} label="animated-cursor.tsx" depth={5} />
      <div className="mt-auto rounded-lg border border-border bg-background/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        {t('preview.aside.files.footer')}
      </div>
    </div>
  )
}

function AsideRow({
  icon: Icon,
  label,
  depth,
  open,
  active,
}: {
  icon: LucideIcon
  label: string
  depth: number
  open?: boolean
  active?: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px]',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {open && <span className="size-1.5 rounded-full bg-primary/70" aria-hidden="true" />}
    </div>
  )
}

function AsideChanges({ t }: { t: Translate }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-3">
      <AsideSectionTitle icon={FileDiffIcon} label={t('preview.aside.changes.title')} />
      <ChangeRow status="M" file="apps/web/src/features/onboarding/onboarding-product-preview.tsx" active />
      <ChangeRow status="M" file="apps/web/src/features/onboarding/animated-cursor.tsx" />
      <ChangeRow status="M" file="apps/web/src/features/onboarding/onboarding-page.tsx" />
      <ChangeRow status="A" file="apps/web/src/features/onboarding/README.md" />
    </div>
  )
}

function ChangeRow({ status, file, active }: { status: string, file: string, active?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px]',
        active ? 'border-primary/30 bg-primary/5 text-foreground' : 'border-border bg-background/60 text-muted-foreground',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-medium tabular-nums">
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate">{file}</span>
    </div>
  )
}

function AsideGit({ t }: { t: Translate }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <AsideSectionTitle icon={GitBranchIcon} label={t('preview.aside.git.title')} />
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-foreground">
          <GitBranchIcon className="size-3.5" aria-hidden="true" />
          <span className="font-medium">codex/onboarding-product-frame</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <StatPill label={t('preview.aside.git.changed')} value="8" />
          <StatPill label={t('preview.aside.git.ready')} value="3" />
        </div>
      </div>
    </div>
  )
}

function AsideIssue({
  selectedIssueId,
  movedIssue,
  t,
}: {
  selectedIssueId: string | null
  movedIssue: boolean
  t: Translate
}) {
  const issueNumber = selectedIssueId === 'issue-1' ? '18' : '19'
  const issueTitle = selectedIssueId === 'issue-1'
    ? t('preview.kanban.issue.firstRun')
    : t('preview.kanban.issue.mockData')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <AsideSectionTitle icon={CircleDotIcon} label={t('preview.aside.issue.title')} />
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">
            CRA-
            {issueNumber}
          </Badge>
          <Badge variant={movedIssue ? 'secondary' : 'outline'}>
            {movedIssue ? t('preview.kanban.status.started') : t('preview.kanban.status.triage')}
          </Badge>
        </div>
        <p className="text-sm font-medium leading-snug text-foreground">
          {issueTitle}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          <Badge variant="outline">{t('preview.kanban.label.onboarding')}</Badge>
          <Badge variant="outline">{t('preview.kanban.label.ux')}</Badge>
        </div>
        <div className="mt-4 grid gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            data-onboarding-target="issue-status-started"
            data-active={movedIssue ? 'true' : 'false'}
            className={cn(
              'flex h-8 items-center justify-between rounded-md border px-2.5 text-left text-[12px]',
              'transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]',
              movedIssue
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span>{t('preview.kanban.status.started')}</span>
            {movedIssue && <CheckCircle2Icon className="size-3.5 text-success" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function AsideRuntime({ phase, t }: { phase: number, t: Translate }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <AsideSectionTitle icon={ActivityIcon} label={t('preview.aside.runtime.title')} />
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">{t('preview.agent.runTitle')}</span>
          <Badge variant={phase >= 3 ? 'secondary' : 'outline'}>
            {phase >= 3 ? t('preview.aside.runtime.done') : t('preview.aside.runtime.running')}
          </Badge>
        </div>
        <Progress value={Math.max(12, phase * 33)} className="h-1.5" />
        <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground">
          <RuntimeStep done={phase >= 1} label={t('preview.agent.plan.read')} />
          <RuntimeStep done={phase >= 2} label={t('preview.agent.plan.patch')} />
          <RuntimeStep done={phase >= 3} label={t('preview.agent.plan.typecheck')} />
        </div>
      </div>
    </div>
  )
}

function RuntimeStep({ done, label }: { done: boolean, label: string }) {
  return (
    <div className="flex items-center gap-2">
      {done
        ? <CheckCircle2Icon className="size-3.5 text-success" aria-hidden="true" />
        : <ClockIcon className="size-3.5 text-muted-foreground/60" aria-hidden="true" />}
      <span>{label}</span>
    </div>
  )
}

function AsideAwait({ t }: { t: Translate }) {
  const checks = [
    { label: t('preview.aside.await.github.check.typecheck'), done: true },
    { label: t('preview.aside.await.github.check.lint'), done: true },
    { label: t('preview.aside.await.github.check.preview'), done: false },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <AsideSectionTitle icon={RssIcon} label={t('preview.aside.await.title')} />
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="flex items-start gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <GitPullRequestIcon className="size-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">
              {t('preview.aside.await.github.title')}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t('preview.aside.await.github.subtitle')}
            </div>
          </div>
          <Badge variant="outline">{t('preview.aside.await.github.badge')}</Badge>
        </div>
        <div className="mt-3 grid gap-2">
          {checks.map(check => (
            <div key={check.label} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              {check.done
                ? <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                : <ClockIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{check.label}</span>
              <span className="shrink-0 tabular-nums">{check.done ? '12s' : '34s'}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          gh run watch --repo cradle/cradle
        </div>
      </div>
    </div>
  )
}

function AsideSectionTitle({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function StatPill({ label, value }: { label: string, value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums text-foreground">{value}</div>
    </div>
  )
}
