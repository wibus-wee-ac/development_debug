// Output: Verifies Cradle performance report gate status calculation.
// Input: Synthetic Cradle performance measures, marks, vitals, and memory snapshots.
// Position: Regression coverage for src/lib/perf-report.ts.

import { describe, expect, it } from 'vitest'

import { buildCradlePerfReport } from './perf-report'

const thresholds = {
  startupToShellMs: 100,
  startupToPluginsReadyMs: 500,
  approvalsFirstRenderMs: 250,
  automationFirstRenderMs: 250,
  awaitsFirstRenderMs: 250,
  assetPrecacheRegisterMs: 200,
  bottomPanelShellFirstRenderMs: 250,
  browserPanelFirstRenderMs: 250,
  chatFirstRenderMs: 250,
  commandPaletteOpenMs: 50,
  commandPaletteQuerySettleMs: 250,
  homeFirstRenderMs: 250,
  issueMutationConfirmMs: 300,
  jarvisPopoverFirstRenderMs: 250,
  kanbanSidebarFirstRenderMs: 250,
  kanbanFirstRenderMs: 250,
  newChatFirstRenderMs: 250,
  packCodebaseDialogFirstRenderMs: 250,
  pluginPanelFirstRenderMs: 250,
  pluginsSidebarFirstRenderMs: 250,
  resourcesPopoverFirstRenderMs: 250,
  rightAsideAwaitFirstRenderMs: 250,
  rightAsideFilesFirstRenderMs: 250,
  rightAsideGitFirstRenderMs: 250,
  rightAsideIssueFirstRenderMs: 250,
  settingsAgentsFirstRenderMs: 250,
  settingsAppearanceFirstRenderMs: 250,
  settingsChronicleFirstRenderMs: 250,
  settingsDesktopFirstRenderMs: 250,
  settingsJarvisFirstRenderMs: 250,
  settingsProvidersFirstRenderMs: 250,
  settingsSkillsFirstRenderMs: 250,
  settingsSupportFirstRenderMs: 250,
  tuiViewFirstRenderMs: 250,
  usageFirstRenderMs: 250,
  workspaceFirstRenderMs: 250,
  workspaceSkillsFirstRenderMs: 250,
  workspaceWorkflowRulesFirstRenderMs: 250,
}

function measure(name: string, duration: number) {
  return {
    name,
    startMark: `${name}:start`,
    endMark: `${name}:end`,
    duration,
    timestamp: 1_000,
  }
}

describe('buildCradlePerfReport', () => {
  it('classifies passing, failing, and missing gates', () => {
    const report = buildCradlePerfReport({
      marks: [],
      measures: [
        measure('cradle:startup-to-shell', 80),
        measure('cradle:startup-to-plugins-ready', 600),
        measure('cradle:asset-precache-register', 120),
        measure('cradle:command-palette-open', 40),
        measure('cradle:command-palette-query-settle', 260),
      ],
      vitals: [],
      snapshots: [],
      thresholds,
    })

    expect(report.gates).toEqual([
      expect.objectContaining({ id: 'startup-to-shell', status: 'pass', value: 80, threshold: 100 }),
      expect.objectContaining({ id: 'startup-to-plugins-ready', status: 'fail', value: 600, threshold: 500 }),
      expect.objectContaining({ id: 'approvals-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'automation-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'awaits-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'asset-precache-register', status: 'pass', value: 120, threshold: 200 }),
      expect.objectContaining({ id: 'bottom-panel-shell-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'browser-panel-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'chat-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'command-palette-open', status: 'pass', value: 40, threshold: 50 }),
      expect.objectContaining({ id: 'command-palette-query-settle', status: 'fail', value: 260, threshold: 250 }),
      expect.objectContaining({ id: 'home-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'issue-mutation-confirm', status: 'missing', value: null, threshold: 300 }),
      expect.objectContaining({ id: 'jarvis-popover-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'kanban-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'kanban-sidebar-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'new-chat-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'pack-codebase-dialog-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'plugin-panel-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'plugins-sidebar-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'resources-popover-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'right-aside-await-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'right-aside-files-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'right-aside-git-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'right-aside-issue-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-agents-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-appearance-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-chronicle-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-desktop-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-jarvis-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-providers-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-skills-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'settings-support-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'tui-view-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'usage-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'workspace-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'workspace-skills-first-render', status: 'missing', value: null, threshold: 250 }),
      expect.objectContaining({ id: 'workspace-workflow-rules-first-render', status: 'missing', value: null, threshold: 250 }),
    ])
  })

  it('uses the newest measure when the same gate is recorded multiple times', () => {
    const report = buildCradlePerfReport({
      marks: [],
      measures: [
        measure('cradle:issue-mutation-confirm', 450),
        measure('cradle:issue-mutation-confirm', 120),
      ],
      vitals: [],
      snapshots: [],
      thresholds,
    })

    expect(report.gates).toContainEqual(
      expect.objectContaining({ id: 'issue-mutation-confirm', status: 'pass', value: 120 }),
    )
  })
})
