// Input: Electron app lifecycle, database/events bootstrap, feature services, platform managers, IPC adapters
// Output: Main-process bootstrap that initializes infrastructure, registers IPC, and wires browser windows
// Position: Main-process composition root reached from the thin src/main/index.ts entrypoint

import { join } from 'node:path'

import { createServices } from '@cradle/ipc'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { getBackendControlPlaneService } from '@main/backend-control-plane/backend-control-plane'
import { eq, sql } from 'drizzle-orm'
import { app, BrowserWindow, shell } from 'electron'

import icon from '../../../resources/icon.png?asset'
import { getDb, initDb } from '../db'
import { acpAgents } from '../db/schema'
import { initializeIpcDevtool, subscribeRuntimeDevtools } from '../devtools/ipc-devtool'
import { bridgeChatTurnFinishedEvents } from '../events/chat-turn-finished-bridge'
import { createInMemoryDomainEventBus } from '../events/domain-event-bus'
import {
  createDbCredentialStore,
} from '../agent-runtime/agent-runtime'
import { initProviderCatalog } from '../agent-runtime/catalog-instance'
import { acpChatProvider } from '../agent-runtime/providers/acp-chat-provider'
import { ClaudeAgentProvider } from '../agent-runtime/providers/claude-agent-provider'
import { cliTuiProvider } from '../agent-runtime/providers/cli-tui-provider'
import { CodexProvider } from '../agent-runtime/providers/codex-provider'
import { OpenAICompatibleProvider } from '../agent-runtime/providers/openai-compatible-provider'
import { createApprovalBroadcastSubscriber } from '../approval/approval-broadcast'
import { getApprovalService } from '../approval/approval-service'
import { chatEngine } from '../chat/chat-engine'
import { createBroadcastSubscriber } from '../chat/broadcast'
import { createFtsSubscriber } from '../chat/fts-subscriber'
import { createUsageSubscriber } from '../chat/usage-subscriber'
import { threadSearchEngine } from '../chat/thread-search'
import { issueAgentRunner } from '../issue-agent/issue-agent-runner'
import { initPackCodebaseWasm } from '../pack-codebase/pack-codebase'
import { acpConnectionManager } from '../acp/acp-connection'
import { ptyManager } from '../pty/pty-manager'
import { initSignalBroadcaster } from '../signal/broadcaster'
import { scanSkills } from '../skills/skills'
import { startSocketServer, stopSocketServer } from '../socket/socket-server'
import { decryptSecret, encryptSecret } from '../storage/safe-storage'
import { revealWindow } from '../window/window-activation'
import { AcpService } from './ipc/acp'
import { AgentService } from './ipc/agent'
import { AgentRuntimeService } from './ipc/agent-runtime'
import { ApprovalService } from './ipc/approval'
import { ChatService } from './ipc/chat'
import { DevService } from './ipc/dev'
import { GitService } from './ipc/git'
import { IpcDevtoolService } from './ipc/ipc-devtool'
import { IssueAgentService } from './ipc/issue-agent'
import { KanbanService } from './ipc/kanban'
import { PackCodebaseService } from './ipc/pack-codebase'
import { PreferencesService } from './ipc/preferences'
import { PtyService } from './ipc/pty'
import { SearchService } from './ipc/search'
import { SessionService } from './ipc/session'
import { SkillsService } from './ipc/skills'
import { UsageService } from './ipc/usage'
import { WindowService } from './ipc/window'
import { WorkflowRulesService } from './ipc/workflow-rules'
import { WorkspaceService } from './ipc/workspace'
import { restoreWindowState, saveWindowState } from './store/app'

function bootstrapProviderCatalog(): void {
  const credentialStore = createDbCredentialStore(getDb(), {
    encrypt: encryptSecret,
    decrypt: decryptSecret,
  })
  const readSecret = (credentialRef: string) => credentialStore.readSecret(credentialRef)

  // Resolve active Cradle-owned skill SKILL.md paths for injection into codex/claude-agent
  const resolveSkillPaths = (workspacePath: string): string[] => {
    const entries = scanSkills({ workspacePath: workspacePath === '.' ? undefined : workspacePath })
    return entries.map(e => e.location)
  }

  const openAIProvider = new OpenAICompatibleProvider({ readSecret })
  const codexProvider = new CodexProvider({ readSecret, resolveSkillPaths })
  const claudeAgentProvider = new ClaudeAgentProvider({ readSecret, resolveSkillPaths })

  initProviderCatalog([acpChatProvider, cliTuiProvider, openAIProvider, codexProvider, claudeAgentProvider])
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          vibrancy: 'sidebar',
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    restoreWindowState('main', mainWindow)
    revealWindow(mainWindow)
  })

  mainWindow.on('close', () => {
    saveWindowState('main', mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
 else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.commandLine.appendSwitch('remote-debugging-port', '9222')

app.whenReady().then(() => {
  // Initialise database
  const dbPath = join(app.getPath('userData'), 'cradle.db')
  initDb(dbPath)

  // Rebuild FTS index if empty (first run after migration)
  try {
    const ftsCount = getDb().all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM messages_fts`)
    if (ftsCount[0]?.cnt === 0) {
      threadSearchEngine.rebuildIndex()
    }
  }
  catch {
    // FTS table may not exist yet, will be created by migration on next restart
  }

  // Reset any ACP agents stuck in 'installing' state from a previous crash/restart
  getDb()
    .update(acpAgents)
    .set({ status: 'failed' })
    .where(eq(acpAgents.status, 'installing'))
    .run()

  initializeIpcDevtool()
  initPackCodebaseWasm()

  // Bootstrap provider catalog (must happen after DB init)
  bootstrapProviderCatalog()

  // Bootstrap chat engine (crash recovery + transport hooks)
  chatEngine.initialize()

  const domainEventBus = createInMemoryDomainEventBus()
  chatEngine.bindEventBus(domainEventBus)
  issueAgentRunner.bindDomainEventBus(domainEventBus)
  bridgeChatTurnFinishedEvents({
    source: chatEngine,
    eventBus: domainEventBus,
  })

  // Create unified signal broadcaster — single push gateway for all renderer events
  const signalBroadcaster = initSignalBroadcaster()
  chatEngine.bindSignalBroadcaster(signalBroadcaster)
  ptyManager.bindBroadcaster(signalBroadcaster)

  // Wire domain event subscribers (Open/Closed — add new behaviors here)
  createBroadcastSubscriber({
    eventBus: domainEventBus,
    broadcaster: signalBroadcaster,
    getSessionWatchers: () => chatEngine.getSessionWatchers(),
  })
  createFtsSubscriber({
    eventBus: domainEventBus,
    db: getDb(),
    searchEngine: threadSearchEngine,
  })
  createUsageSubscriber({
    eventBus: domainEventBus,
    db: getDb(),
  })

  // Wire approval broadcast (pushes approval lifecycle events to renderer)
  const approvalService = getApprovalService()
  createApprovalBroadcastSubscriber({
    approvalService,
    broadcaster: signalBroadcaster,
  })

  // Wire ACP permission handler → approval service
  acpConnectionManager.setPermissionHandler(async (request) => {
    const bindings = getBackendControlPlaneService().listBindingsByBackendSessionId(request.sessionId)
    const chatSessionId = bindings[0]?.chatSessionId ?? null

    const options = request.options.map(opt => ({
      optionId: opt.optionId,
      label: opt.name,
      description: opt.kind,
    }))

    const response = await approvalService.requestApproval({
      chatSessionId,
      agentId: request.agentId,
      prompt: request.toolTitle,
      options,
    })

    if (response.decision === 'rejected') {
      const rejectOption = request.options.find(o => o.kind === 'reject_once' || o.kind === 'reject_always')
      if (rejectOption) {
        return { outcome: 'selected', optionId: rejectOption.optionId }
      }
      return { outcome: 'cancelled' }
    }

    return { outcome: 'selected', optionId: response.selectedOptionId }
  })

  // Register IPC services
  const services = createServices([
    WorkspaceService,
    SessionService,
    AgentService,
    AgentRuntimeService,
    AcpService,
    ApprovalService,
    PreferencesService,
    IpcDevtoolService,
    DevService,
    ChatService,
    SearchService,
    PtyService,
    WindowService,
    GitService,
    KanbanService,
    IssueAgentService,
    UsageService,
    SkillsService,
    WorkflowRulesService,
    PackCodebaseService,
  ] as const)

  // Start Unix domain socket server for CLI access
  startSocketServer(services)

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  signalBroadcaster.subscribe(mainWindow.webContents)
  chatEngine.subscribe(mainWindow.webContents)
  subscribeRuntimeDevtools(mainWindow.webContents)

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      signalBroadcaster.subscribe(win.webContents)
      chatEngine.subscribe(win.webContents)
      subscribeRuntimeDevtools(win.webContents)
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => {
  stopSocketServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
