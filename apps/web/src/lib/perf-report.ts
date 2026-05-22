// Output: Builds structured Cradle performance acceptance reports from runtime samples.
// Input: Web Vitals, memory snapshots, Cradle performance marks, and measures.
// Position: Shared renderer performance reporting used by perf-monitor and acceptance gates.

import type {
  MemorySnapshot,
  PerfMarkEntry,
  PerfMeasureEntry,
  VitalEntry,
} from './perf-monitor'

export interface PerfReportThresholds {
  startupToShellMs: number
  startupToPluginsReadyMs: number
  approvalsFirstRenderMs: number
  automationFirstRenderMs: number
  awaitsFirstRenderMs: number
  assetPrecacheRegisterMs: number
  bottomPanelShellFirstRenderMs: number
  browserPanelFirstRenderMs: number
  chatFirstRenderMs: number
  commandPaletteOpenMs: number
  commandPaletteQuerySettleMs: number
  homeFirstRenderMs: number
  issueMutationConfirmMs: number
  jarvisPopoverFirstRenderMs: number
  kanbanSidebarFirstRenderMs: number
  kanbanFirstRenderMs: number
  newChatFirstRenderMs: number
  packCodebaseDialogFirstRenderMs: number
  pluginPanelFirstRenderMs: number
  pluginsSidebarFirstRenderMs: number
  resourcesPopoverFirstRenderMs: number
  rightAsideAwaitFirstRenderMs: number
  rightAsideFilesFirstRenderMs: number
  rightAsideGitFirstRenderMs: number
  rightAsideIssueFirstRenderMs: number
  settingsAgentsFirstRenderMs: number
  settingsAppearanceFirstRenderMs: number
  settingsChronicleFirstRenderMs: number
  settingsDesktopFirstRenderMs: number
  settingsJarvisFirstRenderMs: number
  settingsProvidersFirstRenderMs: number
  settingsSkillsFirstRenderMs: number
  settingsSupportFirstRenderMs: number
  tuiViewFirstRenderMs: number
  usageFirstRenderMs: number
  workspaceFirstRenderMs: number
  workspaceSkillsFirstRenderMs: number
  workspaceWorkflowRulesFirstRenderMs: number
}

export interface PerfReportGate {
  id: string
  label: string
  status: 'pass' | 'fail' | 'missing'
  value: number | null
  threshold: number | null
}

export interface PerfReport {
  generatedAt: number
  marks: PerfMarkEntry[]
  measures: PerfMeasureEntry[]
  vitals: VitalEntry[]
  snapshots: MemorySnapshot[]
  gates: PerfReportGate[]
}

const DEFAULT_THRESHOLDS: PerfReportThresholds = {
  startupToShellMs: 1_000,
  startupToPluginsReadyMs: 5_000,
  approvalsFirstRenderMs: 1_500,
  automationFirstRenderMs: 1_500,
  awaitsFirstRenderMs: 1_500,
  assetPrecacheRegisterMs: 2_000,
  bottomPanelShellFirstRenderMs: 1_500,
  browserPanelFirstRenderMs: 1_500,
  chatFirstRenderMs: 1_500,
  commandPaletteOpenMs: 100,
  commandPaletteQuerySettleMs: 750,
  homeFirstRenderMs: 1_500,
  issueMutationConfirmMs: 1_500,
  jarvisPopoverFirstRenderMs: 1_500,
  kanbanSidebarFirstRenderMs: 1_500,
  kanbanFirstRenderMs: 1_500,
  newChatFirstRenderMs: 1_500,
  packCodebaseDialogFirstRenderMs: 1_500,
  pluginPanelFirstRenderMs: 1_500,
  pluginsSidebarFirstRenderMs: 1_500,
  resourcesPopoverFirstRenderMs: 1_500,
  rightAsideAwaitFirstRenderMs: 1_500,
  rightAsideFilesFirstRenderMs: 1_500,
  rightAsideGitFirstRenderMs: 1_500,
  rightAsideIssueFirstRenderMs: 1_500,
  settingsAgentsFirstRenderMs: 1_500,
  settingsAppearanceFirstRenderMs: 1_500,
  settingsChronicleFirstRenderMs: 1_500,
  settingsDesktopFirstRenderMs: 1_500,
  settingsJarvisFirstRenderMs: 1_500,
  settingsProvidersFirstRenderMs: 1_500,
  settingsSkillsFirstRenderMs: 1_500,
  settingsSupportFirstRenderMs: 1_500,
  tuiViewFirstRenderMs: 1_500,
  usageFirstRenderMs: 1_500,
  workspaceFirstRenderMs: 1_500,
  workspaceSkillsFirstRenderMs: 1_500,
  workspaceWorkflowRulesFirstRenderMs: 1_500,
}

function readMeasureDuration(measures: PerfMeasureEntry[], name: string): number | null {
  const entry = measures.findLast(measure => measure.name === name)
  return entry?.duration ?? null
}

function createGate({
  id,
  label,
  value,
  threshold,
}: {
  id: string
  label: string
  value: number | null
  threshold: number
}): PerfReportGate {
  return {
    id,
    label,
    status: value === null ? 'missing' : value <= threshold ? 'pass' : 'fail',
    value,
    threshold,
  }
}

function buildGates(measures: PerfMeasureEntry[], thresholds: PerfReportThresholds): PerfReportGate[] {
  return [
    createGate({
      id: 'startup-to-shell',
      label: 'Startup to shell visible',
      value: readMeasureDuration(measures, 'cradle:startup-to-shell'),
      threshold: thresholds.startupToShellMs,
    }),
    createGate({
      id: 'startup-to-plugins-ready',
      label: 'Startup to plugins ready',
      value: readMeasureDuration(measures, 'cradle:startup-to-plugins-ready'),
      threshold: thresholds.startupToPluginsReadyMs,
    }),
    createGate({
      id: 'approvals-first-render',
      label: 'Approvals first render',
      value: readMeasureDuration(measures, 'cradle:approvals-first-render'),
      threshold: thresholds.approvalsFirstRenderMs,
    }),
    createGate({
      id: 'automation-first-render',
      label: 'Automation first render',
      value: readMeasureDuration(measures, 'cradle:automation-first-render'),
      threshold: thresholds.automationFirstRenderMs,
    }),
    createGate({
      id: 'awaits-first-render',
      label: 'Awaits first render',
      value: readMeasureDuration(measures, 'cradle:awaits-first-render'),
      threshold: thresholds.awaitsFirstRenderMs,
    }),
    createGate({
      id: 'asset-precache-register',
      label: 'Asset precache register',
      value: readMeasureDuration(measures, 'cradle:asset-precache-register'),
      threshold: thresholds.assetPrecacheRegisterMs,
    }),
    createGate({
      id: 'bottom-panel-shell-first-render',
      label: 'Bottom panel shell first render',
      value: readMeasureDuration(measures, 'cradle:bottom-panel-shell-first-render'),
      threshold: thresholds.bottomPanelShellFirstRenderMs,
    }),
    createGate({
      id: 'browser-panel-first-render',
      label: 'Browser panel first render',
      value: readMeasureDuration(measures, 'cradle:browser-panel-first-render'),
      threshold: thresholds.browserPanelFirstRenderMs,
    }),
    createGate({
      id: 'chat-first-render',
      label: 'Chat first render',
      value: readMeasureDuration(measures, 'cradle:chat-first-render'),
      threshold: thresholds.chatFirstRenderMs,
    }),
    createGate({
      id: 'command-palette-open',
      label: 'Command palette open',
      value: readMeasureDuration(measures, 'cradle:command-palette-open'),
      threshold: thresholds.commandPaletteOpenMs,
    }),
    createGate({
      id: 'command-palette-query-settle',
      label: 'Command palette query settle',
      value: readMeasureDuration(measures, 'cradle:command-palette-query-settle'),
      threshold: thresholds.commandPaletteQuerySettleMs,
    }),
    createGate({
      id: 'home-first-render',
      label: 'Home first render',
      value: readMeasureDuration(measures, 'cradle:home-first-render'),
      threshold: thresholds.homeFirstRenderMs,
    }),
    createGate({
      id: 'issue-mutation-confirm',
      label: 'Issue mutation confirm',
      value: readMeasureDuration(measures, 'cradle:issue-mutation-confirm'),
      threshold: thresholds.issueMutationConfirmMs,
    }),
    createGate({
      id: 'jarvis-popover-first-render',
      label: 'Jarvis popover first render',
      value: readMeasureDuration(measures, 'cradle:jarvis-popover-first-render'),
      threshold: thresholds.jarvisPopoverFirstRenderMs,
    }),
    createGate({
      id: 'kanban-first-render',
      label: 'Kanban first render',
      value: readMeasureDuration(measures, 'cradle:kanban-first-render'),
      threshold: thresholds.kanbanFirstRenderMs,
    }),
    createGate({
      id: 'kanban-sidebar-first-render',
      label: 'Kanban sidebar first render',
      value: readMeasureDuration(measures, 'cradle:kanban-sidebar-first-render'),
      threshold: thresholds.kanbanSidebarFirstRenderMs,
    }),
    createGate({
      id: 'new-chat-first-render',
      label: 'New chat first render',
      value: readMeasureDuration(measures, 'cradle:new-chat-first-render'),
      threshold: thresholds.newChatFirstRenderMs,
    }),
    createGate({
      id: 'pack-codebase-dialog-first-render',
      label: 'Pack codebase dialog first render',
      value: readMeasureDuration(measures, 'cradle:pack-codebase-dialog-first-render'),
      threshold: thresholds.packCodebaseDialogFirstRenderMs,
    }),
    createGate({
      id: 'plugin-panel-first-render',
      label: 'Plugin panel first render',
      value: readMeasureDuration(measures, 'cradle:plugin-panel-first-render'),
      threshold: thresholds.pluginPanelFirstRenderMs,
    }),
    createGate({
      id: 'plugins-sidebar-first-render',
      label: 'Plugins sidebar first render',
      value: readMeasureDuration(measures, 'cradle:plugins-sidebar-first-render'),
      threshold: thresholds.pluginsSidebarFirstRenderMs,
    }),
    createGate({
      id: 'resources-popover-first-render',
      label: 'Resources popover first render',
      value: readMeasureDuration(measures, 'cradle:resources-popover-first-render'),
      threshold: thresholds.resourcesPopoverFirstRenderMs,
    }),
    createGate({
      id: 'right-aside-await-first-render',
      label: 'Right aside Feed first render',
      value: readMeasureDuration(measures, 'cradle:right-aside-await-first-render'),
      threshold: thresholds.rightAsideAwaitFirstRenderMs,
    }),
    createGate({
      id: 'right-aside-files-first-render',
      label: 'Right aside Files first render',
      value: readMeasureDuration(measures, 'cradle:right-aside-files-first-render'),
      threshold: thresholds.rightAsideFilesFirstRenderMs,
    }),
    createGate({
      id: 'right-aside-git-first-render',
      label: 'Right aside Git first render',
      value: readMeasureDuration(measures, 'cradle:right-aside-git-first-render'),
      threshold: thresholds.rightAsideGitFirstRenderMs,
    }),
    createGate({
      id: 'right-aside-issue-first-render',
      label: 'Right aside Issue first render',
      value: readMeasureDuration(measures, 'cradle:right-aside-issue-first-render'),
      threshold: thresholds.rightAsideIssueFirstRenderMs,
    }),
    createGate({
      id: 'settings-agents-first-render',
      label: 'Settings agents first render',
      value: readMeasureDuration(measures, 'cradle:settings-agents-first-render'),
      threshold: thresholds.settingsAgentsFirstRenderMs,
    }),
    createGate({
      id: 'settings-appearance-first-render',
      label: 'Settings Appearance first render',
      value: readMeasureDuration(measures, 'cradle:settings-appearance-first-render'),
      threshold: thresholds.settingsAppearanceFirstRenderMs,
    }),
    createGate({
      id: 'settings-chronicle-first-render',
      label: 'Settings Chronicle first render',
      value: readMeasureDuration(measures, 'cradle:settings-chronicle-first-render'),
      threshold: thresholds.settingsChronicleFirstRenderMs,
    }),
    createGate({
      id: 'settings-desktop-first-render',
      label: 'Settings Desktop first render',
      value: readMeasureDuration(measures, 'cradle:settings-desktop-first-render'),
      threshold: thresholds.settingsDesktopFirstRenderMs,
    }),
    createGate({
      id: 'settings-jarvis-first-render',
      label: 'Settings Jarvis first render',
      value: readMeasureDuration(measures, 'cradle:settings-jarvis-first-render'),
      threshold: thresholds.settingsJarvisFirstRenderMs,
    }),
    createGate({
      id: 'settings-providers-first-render',
      label: 'Settings providers first render',
      value: readMeasureDuration(measures, 'cradle:settings-providers-first-render'),
      threshold: thresholds.settingsProvidersFirstRenderMs,
    }),
    createGate({
      id: 'settings-skills-first-render',
      label: 'Settings skills first render',
      value: readMeasureDuration(measures, 'cradle:settings-skills-first-render'),
      threshold: thresholds.settingsSkillsFirstRenderMs,
    }),
    createGate({
      id: 'settings-support-first-render',
      label: 'Settings Support first render',
      value: readMeasureDuration(measures, 'cradle:settings-support-first-render'),
      threshold: thresholds.settingsSupportFirstRenderMs,
    }),
    createGate({
      id: 'tui-view-first-render',
      label: 'TUI view first render',
      value: readMeasureDuration(measures, 'cradle:tui-view-first-render'),
      threshold: thresholds.tuiViewFirstRenderMs,
    }),
    createGate({
      id: 'usage-first-render',
      label: 'Usage first render',
      value: readMeasureDuration(measures, 'cradle:usage-first-render'),
      threshold: thresholds.usageFirstRenderMs,
    }),
    createGate({
      id: 'workspace-first-render',
      label: 'Workspace first render',
      value: readMeasureDuration(measures, 'cradle:workspace-first-render'),
      threshold: thresholds.workspaceFirstRenderMs,
    }),
    createGate({
      id: 'workspace-skills-first-render',
      label: 'Workspace Skills first render',
      value: readMeasureDuration(measures, 'cradle:workspace-skills-first-render'),
      threshold: thresholds.workspaceSkillsFirstRenderMs,
    }),
    createGate({
      id: 'workspace-workflow-rules-first-render',
      label: 'Workspace Workflow Rules first render',
      value: readMeasureDuration(measures, 'cradle:workspace-workflow-rules-first-render'),
      threshold: thresholds.workspaceWorkflowRulesFirstRenderMs,
    }),
  ]
}

export function buildCradlePerfReport({
  marks,
  measures,
  vitals,
  snapshots,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  marks: PerfMarkEntry[]
  measures: PerfMeasureEntry[]
  vitals: VitalEntry[]
  snapshots: MemorySnapshot[]
  thresholds?: PerfReportThresholds
}): PerfReport {
  return {
    generatedAt: Date.now(),
    marks,
    measures,
    vitals,
    snapshots,
    gates: buildGates(measures, thresholds),
  }
}
