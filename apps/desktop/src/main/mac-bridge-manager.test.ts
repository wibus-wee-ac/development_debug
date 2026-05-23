/* Verifies Mac Bridge process management and binary resolution behavior. */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MacBridgeManager, resolveMacBridgeBinaryPath } from './mac-bridge-manager'

function createFakeBridgeScript(): string {
  const root = join(tmpdir(), `cradle-mac-bridge-test-${process.pid}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const scriptPath = join(root, 'fake-bridge.mjs')
  writeFileSync(scriptPath, `
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'bridge.status') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        name: 'cradle-mac-bridge',
        version: 'test',
        pid: process.pid,
        platform: 'darwin'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.input.configure') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        trigger: 'bothCommand',
        enabled: request.params.enabled
      }
    }) + '\\n')
    process.stdout.write(JSON.stringify({
      method: 'event.mac.hotkeyTriggered',
      params: {
        trigger: 'bothCommand',
        capturedAt: '2026-05-22T15:56:22Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.permissions.request') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        requested: request.params.permissions ?? ['accessibility', 'inputMonitoring', 'screenRecording'],
        status: {
          accessibility: 'denied',
          inputMonitoring: 'denied',
          screenRecording: 'granted'
        }
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.permissions.openSettings') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        target: request.params.target ?? 'privacy',
        url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
        opened: true
      }
    }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({
    id: request.id,
    error: {
      code: 'unknown-method',
      message: request.method
    }
  }) + '\\n')
})
`, 'utf8')
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

describe('resolveMacBridgeBinaryPath', () => {
  it('returns null on non-macOS platforms without explicit binary', () => {
    expect(resolveMacBridgeBinaryPath({
      platform: 'linux',
      env: {},
    })).toBeNull()
  })

  it('prefers explicit env override', () => {
    expect(resolveMacBridgeBinaryPath({
      platform: 'darwin',
      env: { CRADLE_MAC_BRIDGE_BIN: '/tmp/custom-mac-bridge' },
    })).toBe('/tmp/custom-mac-bridge')
  })

  it('resolves packaged resources when available', () => {
    const root = join(tmpdir(), `cradle-mac-bridge-resource-${process.pid}-${Date.now()}`)
    const binaryPath = join(root, 'mac-bridge', 'cradle-mac-bridge')
    mkdirSync(join(root, 'mac-bridge'), { recursive: true })
    writeFileSync(binaryPath, '')

    expect(resolveMacBridgeBinaryPath({
      platform: 'darwin',
      resourcesPath: root,
      env: {},
    })).toBe(binaryPath)
  })
})

describe('MacBridgeManager', () => {
  let manager: MacBridgeManager | null = null

  afterEach(async () => {
    await manager?.stop()
    manager = null
  })

  it('reports unavailable instead of throwing when binary is missing', async () => {
    manager = new MacBridgeManager({
      binaryPath: '/tmp/not-a-real-cradle-mac-bridge',
      platform: 'darwin',
      env: {},
    })

    await expect(manager.start()).resolves.toMatchObject({
      available: false,
      running: false,
      lastError: 'cradle-mac-bridge binary is not available',
    })
  })

  it('round-trips requests and hotkey events over NDJSON', async () => {
    const events: unknown[] = []
    manager = new MacBridgeManager({
      binaryPath: process.execPath,
      args: [createFakeBridgeScript()],
      platform: 'darwin',
      env: {},
    })
    manager.on('hotkeyTriggered', event => events.push(event))

    await expect(manager.readBridgeStatus()).resolves.toMatchObject({
      name: 'cradle-mac-bridge',
      version: 'test',
      platform: 'darwin',
    })
    await expect(manager.configureInput({ trigger: 'bothCommand', enabled: true })).resolves.toEqual({
      trigger: 'bothCommand',
      enabled: true,
    })
    await expect(manager.requestPermissions({
      permissions: ['accessibility', 'inputMonitoring'],
    })).resolves.toEqual({
      requested: ['accessibility', 'inputMonitoring'],
      status: {
        accessibility: 'denied',
        inputMonitoring: 'denied',
        screenRecording: 'granted',
      },
    })
    await expect(manager.openPermissionSettings({
      target: 'accessibility',
    })).resolves.toEqual({
      target: 'accessibility',
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      opened: true,
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toEqual([{
      trigger: 'bothCommand',
      capturedAt: '2026-05-22T15:56:22Z',
    }])
  })
})
