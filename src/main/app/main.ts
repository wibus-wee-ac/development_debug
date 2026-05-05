// Input: Electron app lifecycle, database/events bootstrap, feature services, platform managers, IPC adapters
// Output: Main-process bootstrap that initializes infrastructure, registers IPC, and wires browser windows
// Position: Main-process composition root reached from the thin src/main/index.ts entrypoint

import { join } from 'node:path'

import { createServices } from '@cradle/ipc'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
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
} from '../features/agent-runtime/agent-runtime'
import { initPackCodebaseWasm } from '../features/pack-codebase/pack-codebase'
import { initProviderCatalog } from '../features/agent-runtime/catalog-instance'
import { acpChatProvider } from '../features/agent-runtime/providers/acp-chat-provider'
import { cliTuiProvider } from '../features/agent-runtime/providers/cli-tui-provider'
import { OpenAICompatibleProvider } from '../features/agent-runtime/providers/openai-compatible-provider'
import { ChatEngine } from '../features/chat/chat-engine'
import { createBroadcastSubscriber } from '../features/chat/subscribers/broadcast-subscriber'
import { createFtsSubscriber } from '../features/chat/subscribers/fts-subscriber'
import { createUsageSubscriber } from '../features/chat/subscribers/usage-subscriber'
import { ThreadSearchEngine } from '../features/chat/thread-search'
import { IssueAgentRunner } from '../features/issue-agent/issue-agent-runner'
import { PtyManager } from '../platform/pty/pty-manager'
import { startSocketServer, stopSocketServer } from '../platform/socket/socket-server'
import { decryptSecret, encryptSecret } from '../platform/storage/safe-storage'
import { revealWindow } from '../platform/window/window-activation'
import { AcpService } from './ipc/acp'
import { AgentService } from './ipc/agent'
import { AgentRuntimeService } from './ipc/agent-runtime'
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
  const openAIProvider = new OpenAICompatibleProvider({
    readSecret: credentialRef => credentialStore.readSecret(credentialRef),
  })

  initProviderCatalog([acpChatProvider, cliTuiProvider, openAIProvider])
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
      ThreadSearchEngine.getInstance().rebuildIndex()
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
  const chatEngine = ChatEngine.getInstance()
  chatEngine.initialize()

  const domainEventBus = createInMemoryDomainEventBus()
  chatEngine.bindEventBus(domainEventBus)
  IssueAgentRunner.getInstance().bindDomainEventBus(domainEventBus)
  bridgeChatTurnFinishedEvents({
    source: chatEngine,
    eventBus: domainEventBus,
  })

  // Wire domain event subscribers (Open/Closed — add new behaviors here)
  createBroadcastSubscriber({
    eventBus: domainEventBus,
    getSessionWatchers: () => chatEngine.getSessionWatchers(),
    getGlobalSubscribers: () => chatEngine.getGlobalSubscribers(),
    detachWebContents: wc => chatEngine.detachRenderer(wc),
  })
  createFtsSubscriber({
    eventBus: domainEventBus,
    db: getDb(),
    searchEngine: ThreadSearchEngine.getInstance(),
  })
  createUsageSubscriber({
    eventBus: domainEventBus,
    db: getDb(),
  })

  // Register IPC services
  const services = createServices([
    WorkspaceService,
    SessionService,
    AgentService,
    AgentRuntimeService,
    AcpService,
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
  chatEngine.subscribe(mainWindow.webContents)
  subscribeRuntimeDevtools(mainWindow.webContents)
  PtyManager.getInstance().subscribe(mainWindow.webContents)

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      chatEngine.subscribe(win.webContents)
      subscribeRuntimeDevtools(win.webContents)
      PtyManager.getInstance().subscribe(win.webContents)
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
