import type { RuntimeUiSlot } from '../../chat-runtime/runtime-provider-types'
import type { CodexAppServerCapabilityManifest } from './app-server-capabilities'

interface CodexUiSlotDefinition extends Omit<RuntimeUiSlot, 'surfaces'> {
  surfaces?: RuntimeUiSlot['surfaces']
  requiredMethods?: string[]
  anyMethods?: string[]
  requiredNotifications?: string[]
  anyNotifications?: string[]
}

const CODEX_UI_SLOT_DEFINITIONS: CodexUiSlotDefinition[] = [
  {
    id: 'codex:ide-context',
    name: 'ide-context',
    label: 'IDE context',
    description: 'Include current selection, open files, and IDE context.',
    argumentHint: '',
    aliases: ['context'],
    iconKey: 'ide-context',
    commandText: '/context ',
    surfaces: ['slashCommand'],
    requiredMethods: ['fuzzyFileSearch'],
  },
  {
    id: 'codex:mcp',
    name: 'mcp',
    label: 'MCP',
    description: 'Show MCP server status.',
    argumentHint: '',
    iconKey: 'mcp',
    commandText: '/mcp ',
    anyMethods: ['mcpServerStatus/list', 'mcpServer/tool/call', 'mcpServer/resource/read', 'mcpServer/oauth/login'],
  },
  {
    id: 'codex:plan',
    name: 'plan',
    label: 'Plan',
    description: 'Show the current execution plan.',
    argumentHint: '',
    iconKey: 'plan',
    commandText: '/plan ',
    anyNotifications: ['turn/plan/updated', 'item/plan/delta'],
  },
  {
    id: 'codex:tool-activity',
    name: 'tools',
    label: 'Tool activity',
    description: 'Show recent runtime tool activity.',
    argumentHint: '',
    aliases: ['activity'],
    iconKey: 'tool-activity',
    commandText: '/tools ',
    anyNotifications: ['item/started', 'item/completed', 'serverRequest/resolved', 'item/mcpToolCall/progress'],
  },
  {
    id: 'codex:diff',
    name: 'diff',
    label: 'Diff',
    description: 'Show file changes for the current turn.',
    argumentHint: '',
    iconKey: 'diff',
    commandText: '/diff ',
    anyMethods: ['gitDiffToRemote'],
    anyNotifications: ['turn/diff/updated', 'item/fileChange/patchUpdated', 'item/fileChange/outputDelta'],
  },
  {
    id: 'codex:terminal',
    name: 'terminal',
    label: 'Terminal',
    description: 'Show command and process activity.',
    argumentHint: '',
    aliases: ['shell'],
    iconKey: 'terminal',
    commandText: '/terminal ',
    anyMethods: ['command/exec', 'process/spawn', 'thread/shellCommand'],
    anyNotifications: ['item/commandExecution/outputDelta', 'item/commandExecution/terminalInteraction', 'process/outputDelta', 'process/exited'],
  },
  {
    id: 'codex:approvals',
    name: 'approvals',
    label: 'Approvals',
    description: 'Show pending and recent approval reviews.',
    argumentHint: '',
    iconKey: 'approvals',
    commandText: '/approvals ',
    anyNotifications: ['item/autoApprovalReview/started', 'item/autoApprovalReview/completed', 'serverRequest/resolved'],
  },
  {
    id: 'codex:alerts',
    name: 'alerts',
    label: 'Alerts',
    description: 'Show recent warnings and recovery notices.',
    argumentHint: '',
    aliases: ['warnings'],
    iconKey: 'alert',
    commandText: '/alerts ',
    surfaces: ['runtimePanel'],
    anyNotifications: ['warning', 'guardianWarning', 'configWarning', 'deprecationNotice'],
  },
  {
    id: 'codex:filesystem',
    name: 'files',
    label: 'Filesystem',
    description: 'Show recent filesystem activity.',
    argumentHint: '',
    aliases: ['filesystem'],
    iconKey: 'filesystem',
    commandText: '/files ',
    anyMethods: ['fs/readFile', 'fs/readDirectory', 'fs/watch', 'fs/getMetadata'],
    anyNotifications: ['fs/changed'],
  },
  {
    id: 'codex:skills',
    name: 'skills',
    label: 'Skills',
    description: 'Show available runtime skills and load errors.',
    argumentHint: '',
    iconKey: 'skills',
    commandText: '/skills ',
    anyMethods: ['skills/list', 'skills/config/write', 'hooks/list'],
    anyNotifications: ['skills/changed'],
  },
  {
    id: 'codex:plugin',
    name: 'plugins',
    label: 'Plugins',
    description: 'Show plugin, marketplace, and app availability.',
    argumentHint: '',
    aliases: ['apps'],
    iconKey: 'plugin',
    commandText: '/plugins ',
    anyMethods: ['plugin/list', 'plugin/read', 'app/list', 'marketplace/add'],
    anyNotifications: ['app/list/updated'],
  },
  {
    id: 'codex:search',
    name: 'search',
    label: 'Search',
    description: 'Show search and file lookup activity.',
    argumentHint: '[query]',
    aliases: ['history'],
    iconKey: 'search',
    commandText: '/search ',
    anyMethods: ['thread/search', 'thread/read', 'thread/turns/list', 'fuzzyFileSearch'],
    anyNotifications: ['fuzzyFileSearch/sessionUpdated', 'fuzzyFileSearch/sessionCompleted'],
  },
  {
    id: 'codex:crew',
    name: 'crew',
    label: 'Crew',
    description: 'Show delegation, review, and collaboration activity.',
    argumentHint: '',
    aliases: ['delegation'],
    iconKey: 'crew',
    commandText: '/crew ',
    surfaces: ['runtimePanel', 'streamEvidence'],
    anyMethods: ['review/start', 'collaborationMode/list', 'thread/fork'],
    anyNotifications: ['item/started', 'item/completed'],
  },
  {
    id: 'codex:usage',
    name: 'usage',
    label: 'Usage',
    description: 'Show current usage and rate limit state.',
    argumentHint: '',
    iconKey: 'usage',
    commandText: '/usage ',
    surfaces: ['composerState', 'runtimePanel'],
    anyMethods: ['account/rateLimits/read'],
    anyNotifications: ['account/rateLimits/updated'],
  },
  {
    id: 'codex:config',
    name: 'config',
    label: 'Config',
    description: 'Show active runtime configuration constraints.',
    argumentHint: '',
    iconKey: 'config',
    commandText: '/config ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    anyMethods: ['config/read', 'configRequirements/read', 'experimentalFeature/list', 'permissionProfile/list'],
    anyNotifications: ['configWarning', 'thread/settings/updated', 'model/rerouted', 'model/verification'],
  },
  {
    id: 'codex:personality',
    name: 'personality',
    label: 'Personality',
    description: 'Choose how Codex responds.',
    argumentHint: '',
    aliases: ['style'],
    iconKey: 'personality',
    commandText: '/personality ',
    surfaces: ['toolbarPicker'],
    requiredMethods: ['thread/settings/update'],
  },
  {
    id: 'codex:review',
    name: 'review',
    label: 'Code review',
    description: 'Review unstaged changes or compare with a branch.',
    argumentHint: '[target]',
    aliases: ['code-review'],
    iconKey: 'code-review',
    commandText: '/review ',
    surfaces: ['slashCommand'],
    requiredMethods: ['review/start'],
  },
  {
    id: 'codex:side-chat',
    name: 'side',
    label: 'Side chat',
    description: 'Start a side conversation from a temporary branch.',
    argumentHint: '',
    aliases: ['branch-chat'],
    iconKey: 'side-chat',
    commandText: '/side ',
    surfaces: ['runtimePanel'],
    requiredMethods: ['thread/fork'],
  },
  {
    id: 'codex:compact',
    name: 'compact',
    label: 'Compact',
    description: 'Compact this conversation context.',
    argumentHint: '[instructions]',
    aliases: ['summarize'],
    iconKey: 'compact',
    commandText: '/compact ',
    surfaces: ['slashCommand', 'runtimePanel'],
    requiredMethods: ['thread/compact/start'],
    anyNotifications: ['thread/compacted'],
  },
  {
    id: 'codex:feedback',
    name: 'feedback',
    label: 'Feedback',
    description: 'Send feedback about this chat.',
    argumentHint: '',
    iconKey: 'feedback',
    commandText: '/feedback ',
    surfaces: ['slashCommand'],
    requiredMethods: ['feedback/upload'],
  },
  {
    id: 'codex:goal',
    name: 'goal',
    label: 'Goal',
    description: 'Set or show the active objective.',
    argumentHint: '<objective>',
    aliases: ['objective'],
    iconKey: 'goal',
    commandText: '/goal ',
    surfaces: ['slashCommand', 'composerState', 'runtimePanel'],
    requiredMethods: ['thread/goal/set', 'thread/goal/get', 'thread/goal/clear'],
    anyNotifications: ['thread/goal/updated', 'thread/goal/cleared'],
  },
  {
    id: 'codex:reasoning',
    name: 'reasoning',
    label: 'Reasoning mode',
    description: 'Adjust reasoning effort.',
    argumentHint: '[low|medium|high]',
    aliases: ['thinking'],
    iconKey: 'reasoning',
    commandText: '/reasoning ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    requiredMethods: ['thread/settings/update'],
  },
  {
    id: 'codex:model',
    name: 'model',
    label: 'Model',
    description: 'Switch the active model.',
    argumentHint: '[model]',
    iconKey: 'model',
    commandText: '/model ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    requiredMethods: ['model/list', 'modelProvider/capabilities/read'],
  },
  {
    id: 'codex:status',
    name: 'status',
    label: 'Status',
    description: 'Switch or inspect context usage.',
    argumentHint: '',
    iconKey: 'status',
    commandText: '/status ',
    anyMethods: ['account/rateLimits/read', 'configRequirements/read'],
    anyNotifications: ['thread/status/changed', 'thread/tokenUsage/updated', 'thread/settings/updated'],
  },
]

export function projectCodexUiSlots(manifest: CodexAppServerCapabilityManifest): RuntimeUiSlot[] {
  const methodNames = new Set(manifest.clientMethods.map(method => method.method))
  const notificationNames = new Set(manifest.serverNotifications.map(notification => notification.method))

  return CODEX_UI_SLOT_DEFINITIONS
    .filter(slot => supportsSlot(slot, methodNames, notificationNames))
    .map(({
      requiredMethods: _requiredMethods,
      anyMethods: _anyMethods,
      requiredNotifications: _requiredNotifications,
      anyNotifications: _anyNotifications,
      surfaces,
      ...slot
    }) => ({
      ...slot,
      surfaces: surfaces ?? ['runtimePanel'],
    }))
}

function supportsSlot(
  slot: CodexUiSlotDefinition,
  methodNames: Set<string>,
  notificationNames: Set<string>,
): boolean {
  if (slot.requiredMethods?.some(method => !methodNames.has(method))) {
    return false
  }
  if (slot.requiredNotifications?.some(notification => !notificationNames.has(notification))) {
    return false
  }
  if (slot.anyMethods && !slot.anyMethods.some(method => methodNames.has(method))) {
    return false
  }
  if (slot.anyNotifications && !slot.anyNotifications.some(notification => notificationNames.has(notification))) {
    return false
  }
  return true
}
