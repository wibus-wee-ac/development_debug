import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type HotkeyHandler = (payload: unknown) => void

function installCradleIpc(captureAppshot: (payload: unknown) => unknown) {
  let hotkeyHandler: HotkeyHandler | null = null
  window.cradle = {
    ipc: {
      invoke: vi.fn(async (channel: string, _envelope: unknown, payload: unknown) => {
        if (channel === 'macCapture.captureAppshot') {
          return captureAppshot(payload)
        }
        throw new Error(`Unexpected IPC channel: ${channel}`)
      }),
      on: vi.fn((channel: string, handler: HotkeyHandler) => {
        if (channel === 'capture:appshot-hotkey') {
          hotkeyHandler = handler
        }
        return () => {
          if (hotkeyHandler === handler) {
            hotkeyHandler = null
          }
        }
      }),
    },
    env: {
      serverUrl: 'http://127.0.0.1:21423',
      sessionId: null,
      isTearoff: false,
      surface: null,
      platform: 'darwin',
      isElectron: true,
    },
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      startPointerMonitor: vi.fn(),
      stopPointerMonitor: vi.fn(),
      onTearoffSessionClosed: vi.fn(() => () => {}),
      onPointerOutsideWindow: vi.fn(() => () => {}),
    },
    desktopUpdate: {
      onStatusChanged: vi.fn(() => () => {}),
    },
    desktopTray: {
      performAction: vi.fn(),
      consumePendingActionRequests: vi.fn(),
      onActionRequested: vi.fn(() => () => {}),
    },
  }

  return {
    triggerHotkey: (payload: unknown) => hotkeyHandler?.(payload),
  }
}

function createActionTarget() {
  const target = document.createElement('div')
  Object.defineProperty(target, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 220,
      right: 650,
      width: 640,
      height: 200,
      toJSON: () => ({}),
    }),
  })
  document.body.append(target)
  return target
}

function installImageDecodeStub() {
  class MockImage {
    decoding: 'async' | 'sync' | 'auto' = 'sync'
    onload: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event('load')))
    }

    decode(): Promise<void> {
      return Promise.resolve()
    }
  }

  vi.stubGlobal('Image', MockImage)
}

function createCaptureResponse() {
  return {
    strategy: 'cradle-native',
    capture: {
      filePath: '/tmp/appshot.png',
      metadataPath: '/tmp/appshot.json',
      capturedAt: '2026-06-06T00:00:00Z',
      window: {
        windowId: 42,
        appName: 'Finder',
        bundleId: 'com.apple.finder',
        appIconDataUrl: null,
        axTree: 'AXWindow | Finder\n  AXButton | Share',
        processId: 100,
        title: 'Downloads',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
      appshot: {
        strategy: 'cradle-native',
        animationDuration: 0.001,
        transitionSnapshotPath: '/tmp/appshot-transition.png',
        transitionSnapshotHeight: 140,
        transitionSpringDampingFraction: null,
        transitionSpringResponse: null,
      },
    },
    asset: {
      path: '/tmp/appshot.png',
      dataURL: 'data:image/png;base64,final',
      mimeType: 'image/png',
    },
    transitionSnapshotAsset: {
      path: '/tmp/appshot-transition.png',
      dataURL: 'data:image/png;base64,transition',
      mimeType: 'image/png',
    },
    sink: {
      sink: 'file',
      ok: true,
      message: null,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  document.body.innerHTML = ''
  delete window.cradle
})

describe('useComposerAppshotCapture', () => {
  it('ignores desktop hotkeys when the owning tab is inactive', async () => {
    const captureAppshot = vi.fn(async (_payload: unknown) => createCaptureResponse())
    const ipc = installCradleIpc(captureAppshot)
    const { useComposerAppshotCapture } = await import('./use-composer-appshot-capture')

    renderHook(() => useComposerAppshotCapture({ active: false, supportsAttachments: true }))

    act(() => {
      ipc.triggerHotkey({ trigger: 'bothCommand', capturedAt: '2026-06-06T00:00:00Z' })
    })

    expect(captureAppshot).not.toHaveBeenCalled()
  })

  it('captures only from the active tab and stores the AX tree in AppShot metadata', async () => {
    installImageDecodeStub()
    vi.stubGlobal('devicePixelRatio', 2)
    const captureAppshot = vi.fn(async (_payload: unknown) => createCaptureResponse())
    const ipc = installCradleIpc(captureAppshot)
    const { useComposerAppshotCapture } = await import('./use-composer-appshot-capture')
    const actionTarget = createActionTarget()
    const { result } = renderHook(() => useComposerAppshotCapture({ active: true, supportsAttachments: true }))

    act(() => {
      result.current.setActionTargetElement(actionTarget)
    })
    act(() => {
      ipc.triggerHotkey({
        trigger: 'bothCommand',
        capturedAt: '2026-06-06T00:00:00Z',
        targetWindow: { windowId: 42, processId: 100, bundleId: 'com.apple.finder' },
      })
    })

    await waitFor(() => expect(captureAppshot).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.externalFileParts).toHaveLength(1))

    const filePart = result.current.externalFileParts[0]
    expect(captureAppshot.mock.calls[0]?.[0]).toMatchObject({
      targetWindow: { windowId: 42, processId: 100, bundleId: 'com.apple.finder' },
      transitionSnapshotHeight: 280,
    })
    expect(filePart?.providerMetadata?.cradle?.appshot).toMatchObject({
      appName: 'Finder',
      windowTitle: 'Downloads',
      axTree: 'AXWindow | Finder\n  AXButton | Share',
    })
  })
})
