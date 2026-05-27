/**
 * Output: Desktop-owned script injection runtime for Browser Panel webviews.
 * Input: Renderer IPC requests keyed by Electron webContents id.
 * Position: Electron main-process boundary for UserScript-like browser tab tools.
 */

import { IpcMethod, IpcService } from '@cradle/ipc'
import { webContents } from 'electron'
import { z } from 'zod'

const ScriptRunAtSchema = z.enum(['document-start', 'document-end', 'document-idle'])

const BrowserTabScriptSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(128).optional(),
  runAt: ScriptRunAtSchema,
  source: z.string().min(1).max(512_000),
})

const WebContentsScriptRequestSchema = z.object({
  webContentsId: z.number().int().positive(),
  scripts: z.array(BrowserTabScriptSchema).max(24),
})

const WebContentsScriptRunRequestSchema = z.object({
  webContentsId: z.number().int().positive(),
  script: BrowserTabScriptSchema,
})

const WebContentsRequestSchema = z.object({
  webContentsId: z.number().int().positive(),
})

type BrowserTabScript = z.infer<typeof BrowserTabScriptSchema>

interface RegisteredDocumentStartScript {
  source: string
  identifier: string
}

interface WebContentsScriptState {
  documentStartScripts: Map<string, RegisteredDocumentStartScript>
  deferredScripts: Map<string, BrowserTabScript>
  listenersBound: boolean
}

const stateByWebContentsId = new Map<number, WebContentsScriptState>()

function readWebContents(webContentsId: number): Electron.WebContents {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) {
    throw new Error(`Browser tab webContents ${webContentsId} is not available`)
  }
  if (wc.getType() !== 'webview') {
    throw new Error(`Browser tab scripts can only target webview contents`)
  }
  return wc
}

function readScriptState(webContentsId: number): WebContentsScriptState {
  let state = stateByWebContentsId.get(webContentsId)
  if (!state) {
    state = {
      documentStartScripts: new Map(),
      deferredScripts: new Map(),
      listenersBound: false,
    }
    stateByWebContentsId.set(webContentsId, state)
  }
  return state
}

function prepareDebuggerSession(wc: Electron.WebContents): void {
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3')
  }
}

async function addDocumentStartScript(
  wc: Electron.WebContents,
  state: WebContentsScriptState,
  script: BrowserTabScript,
): Promise<void> {
  const current = state.documentStartScripts.get(script.id)
  if (current?.source === script.source) {
    return
  }
  if (current) {
    await removeDocumentStartScript(wc, state, script.id)
  }

  prepareDebuggerSession(wc)
  const response = await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: script.source,
  }) as { identifier?: string }

  if (!response.identifier) {
    throw new Error(`Electron did not return an injection identifier for ${script.id}`)
  }
  state.documentStartScripts.set(script.id, {
    source: script.source,
    identifier: response.identifier,
  })
}

async function removeDocumentStartScript(
  wc: Electron.WebContents,
  state: WebContentsScriptState,
  scriptId: string,
): Promise<void> {
  const current = state.documentStartScripts.get(scriptId)
  if (!current) {
    return
  }

  prepareDebuggerSession(wc)
  await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: current.identifier,
  })
  state.documentStartScripts.delete(scriptId)
}

async function runScript(wc: Electron.WebContents, script: BrowserTabScript): Promise<unknown> {
  return wc.executeJavaScript(script.source, true)
}

function bindDeferredScriptListeners(
  webContentsId: number,
  wc: Electron.WebContents,
  state: WebContentsScriptState,
): void {
  if (state.listenersBound) {
    return
  }
  state.listenersBound = true

  wc.on('dom-ready', () => {
    const currentState = stateByWebContentsId.get(webContentsId)
    if (!currentState || wc.isDestroyed()) {
      return
    }
    for (const script of currentState.deferredScripts.values()) {
      if (script.runAt !== 'document-end') {
        continue
      }
      void runScript(wc, script).catch((error) => {
        console.warn(`[browser-tab-scripts] document-end script ${script.id} failed:`, error)
      })
    }
  })

  wc.on('did-finish-load', () => {
    const currentState = stateByWebContentsId.get(webContentsId)
    if (!currentState || wc.isDestroyed()) {
      return
    }
    for (const script of currentState.deferredScripts.values()) {
      if (script.runAt !== 'document-idle') {
        continue
      }
      void runScript(wc, script).catch((error) => {
        console.warn(`[browser-tab-scripts] document-idle script ${script.id} failed:`, error)
      })
    }
  })

  wc.once('destroyed', () => {
    stateByWebContentsId.delete(webContentsId)
  })
}

export class BrowserTabScriptsService extends IpcService {
  static readonly groupName = 'browserTabScripts'

  @IpcMethod()
  async setScripts(input: unknown): Promise<{ scriptIds: string[] }> {
    const request = WebContentsScriptRequestSchema.parse(input)
    const wc = readWebContents(request.webContentsId)
    const state = readScriptState(request.webContentsId)
    bindDeferredScriptListeners(request.webContentsId, wc, state)

    const nextDocumentStartIds = new Set(
      request.scripts
        .filter(script => script.runAt === 'document-start')
        .map(script => script.id),
    )
    for (const scriptId of [...state.documentStartScripts.keys()]) {
      if (!nextDocumentStartIds.has(scriptId)) {
        await removeDocumentStartScript(wc, state, scriptId)
      }
    }

    state.deferredScripts.clear()
    for (const script of request.scripts) {
      if (script.runAt === 'document-start') {
        await addDocumentStartScript(wc, state, script)
        continue
      }
      state.deferredScripts.set(script.id, script)
    }

    return { scriptIds: request.scripts.map(script => script.id) }
  }

  @IpcMethod()
  async runScript(input: unknown): Promise<{ result: unknown }> {
    const request = WebContentsScriptRunRequestSchema.parse(input)
    const wc = readWebContents(request.webContentsId)
    return { result: await runScript(wc, request.script) }
  }

  @IpcMethod()
  async clearScripts(input: unknown): Promise<void> {
    const request = WebContentsRequestSchema.parse(input)
    const state = stateByWebContentsId.get(request.webContentsId)
    if (!state) {
      return
    }
    const wc = webContents.fromId(request.webContentsId)
    if (!wc || wc.isDestroyed()) {
      stateByWebContentsId.delete(request.webContentsId)
      return
    }
    for (const scriptId of [...state.documentStartScripts.keys()]) {
      await removeDocumentStartScript(wc, state, scriptId)
    }
    state.deferredScripts.clear()
    stateByWebContentsId.delete(request.webContentsId)
  }
}
