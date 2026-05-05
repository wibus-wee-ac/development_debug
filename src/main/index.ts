import { join } from 'node:path'

import { createServices } from '@cradle/ipc'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { eq, sql } from 'drizzle-orm'
import { app, BrowserWindow, shell } from 'electron'

import icon from '../../resources/icon.png?asset'
import { initProviderCatalog } from './agent-runtime/catalog-instance'
import { acpChatProvider } from './agent-runtime/providers/acp-chat-provider'
import { cliTuiProvider } from './agent-runtime/providers/cli-tui-provider'
import { OpenAICompatibleProvider } from './agent-runtime/providers/openai-compatible-provider'
import { IssueAgentRunner } from './contexts/issue-agent/infrastructure/issue-agent-runner'
import { getDb, initDb } from './db'
import { acpAgents, agentCredentials } from './db/schema'
import { bridgeChatTurnFinishedEvents } from './events/chat-turn-finished-bridge'
import { createInMemoryDomainEventBus } from './events/domain-event-bus'
import { ChatEngine } from './lib/chat-engine'
import { initializeIpcDevtool, subscribeRuntimeDevtools } from './lib/ipc-devtool'
import { PtyManager } from './lib/pty-manager'
import { decryptSecret } from './lib/safe-storage'
import { startSocketServer, stopSocketServer } from './lib/socket-server'
import { revealWindow } from './lib/window-activation'
import { AcpService } from './services/acp'
import { AgentService } from './services/agent'
import { AgentRuntimeService } from './services/agent-runtime'
import { ChatService } from './services/chat'
import { DevService } from './services/dev'
import { GitService } from './services/git'
import { IpcDevtoolService } from './services/ipc-devtool'
import { KanbanService } from './services/kanban'
import { PreferencesService } from './services/preferences'
import { PtyService } from './services/pty'
import { SearchService } from './services/search'
import { SessionService } from './services/session'
import { SkillsService } from './services/skills'
import { UsageService } from './services/usage'
import { WindowService } from './services/window'
import { WorkflowRulesService } from './services/workflow-rules'
import { WorkspaceService } from './services/workspace'
import { restoreWindowState, saveWindowState } from './store/app'

function bootstrapProviderCatalog(): void {
  const openAIProvider = new OpenAICompatibleProvider({
    readSecret: (credentialRef) => {
      const row = getDb()
        .select()
        .from(agentCredentials)
        .where(eq(agentCredentials.id, credentialRef))
        .get()
      if (!row) {
        throw new Error(`Credential not found: ${credentialRef}`)
      }
      return decryptSecret(row.encryptedSecret)
    },
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
    const { ThreadSearchEngine } = require('./lib/thread-search') as typeof import('./lib/thread-search')
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

  // Bootstrap provider catalog (must happen after DB init)
  bootstrapProviderCatalog()

  // Bootstrap chat engine (crash recovery + transport hooks)
  const chatEngine = ChatEngine.getInstance()
  chatEngine.initialize()

  const domainEventBus = createInMemoryDomainEventBus()
  IssueAgentRunner.getInstance().bindDomainEventBus(domainEventBus)
  bridgeChatTurnFinishedEvents({
    source: chatEngine,
    eventBus: domainEventBus,
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
    UsageService,
    SkillsService,
    WorkflowRulesService,
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
