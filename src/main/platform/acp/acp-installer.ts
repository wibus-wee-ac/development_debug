// Input: electron app, net module; tar, extract-zip npm packages; ACP audit log store
// Output: binary/package install helpers, uninstall helper, and low-level file audit logging
// Position: ACP capability module used by AcpService; all FS writes remain
//           confined to app.getPath('userData')/acp/ and fully audited in DB.

import { createWriteStream, promises as fsp } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'

import { net } from 'electron'
import extractZip from 'extract-zip'
import * as tar from 'tar'

import { getDb } from '../../db'
import { acpAuditLog } from '../../db/schema'
import type { PackageDistribution, RegistryAgent } from './acp-registry'
import { getPlatformKey } from './acp-registry'

// ── Path safety ───────────────────────────────────────────────────────────────

const AGENT_ID_RE = /^[a-z][a-z0-9-]*$/

/** Throw if agentId contains path-traversal characters or is otherwise unsafe. */
function assertSafeAgentId(agentId: string): void {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Unsafe agent ID: ${JSON.stringify(agentId)}`)
  }
}

/**
 * Validate that a cmd string is a relative path and does not escape the
 * extraction directory.  Allows `./foo`, `foo/bar`, or `foo`.
 */
function assertSafeCmd(cmd: string): void {
  if (isAbsolute(cmd) || normalize(cmd).includes('..')) {
    throw new Error(`Unsafe cmd path: ${JSON.stringify(cmd)}`)
  }
}

/** Compute (and assert within destDir) the full path for an extracted entry. */
function resolveExtractedPath(destDir: string, entryPath: string): string {
  const resolved = join(destDir, entryPath)
  const prefix = normalize(destDir) + sep
  if (!resolved.startsWith(prefix) && resolved !== normalize(destDir)) {
    throw new Error(`Path traversal detected in archive entry: ${entryPath}`)
  }
  return resolved
}

// ── Directories ───────────────────────────────────────────────────────────────

/** `userData/acp/agents/<agentId>` — unique installation directory. */
export function getAgentInstallDir(userData: string, agentId: string): string {
  assertSafeAgentId(agentId)
  return join(userData, 'acp', 'agents', agentId)
}

/** `userData/acp/tmp` — scratch space for in-progress downloads. */
function getTmpDir(userData: string): string {
  return join(userData, 'acp', 'tmp')
}

// ── Audit ────────────────────────────────────────────────────────────────────

type AuditAction = 'install_start' | 'file_download' | 'file_extract' | 'file_chmod' | 'install_complete' | 'install_failed' | 'uninstall_start' | 'file_delete' | 'uninstall_complete'

function audit(
  agentId: string,
  action: AuditAction,
  path: string | null,
  details: Record<string, unknown> = {},
): void {
  getDb()
    .insert(acpAuditLog)
    .values({
      agentId,
      action,
      path,
      details: JSON.stringify(details),
    })
    .run()
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Stream a file from `url` to `destPath`.
 * Only HTTPS URLs are accepted.
 */
function downloadFile(url: string, destPath: string, signal?: AbortSignal): Promise<void> {
  if (!url.startsWith('https://')) {
    throw new Error(`Only HTTPS download URLs are accepted, got: ${url}`)
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Install cancelled', 'AbortError'))
      return
    }

    const request = net.request({ url, redirect: 'follow' })

    const onAbort = () => {
      request.abort()
      reject(new DOMException('Install cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        signal?.removeEventListener('abort', onAbort)
        reject(new Error(`Download of ${url} failed with HTTP ${response.statusCode}`))
        return
      }

      const fileStream = createWriteStream(destPath)

      // pipeline (stream/promises) is not available here because net.ClientRequest
      // is not a Node ReadableStream — wire up events manually.
      response.on('data', (chunk: Buffer) => {
        fileStream.write(chunk)
      })
      response.on('end', () => {
        signal?.removeEventListener('abort', onAbort)
        fileStream.end(() => resolve())
      })
      response.on('error', (err: Error) => {
        signal?.removeEventListener('abort', onAbort)
        fileStream.destroy()
        reject(err)
      })
    })

    request.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    request.end()
  })
}

// ── Extraction ────────────────────────────────────────────────────────────────

function archiveExtension(url: string): string {
  const u = url.split('?')[0].toLowerCase()
  if (u.endsWith('.tar.gz') || u.endsWith('.tgz')) {
    return '.tar.gz'
  }
  if (u.endsWith('.tar.bz2') || u.endsWith('.tbz2')) {
    return '.tar.bz2'
  }
  if (u.endsWith('.zip')) {
    return '.zip'
  }
  throw new Error(`Unsupported archive extension for URL: ${url}`)
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  ext: string,
): Promise<void> {
  if (ext === '.zip') {
    await extractZip(archivePath, {
      dir: destDir,
      // Validate every entry before it is written.
      onEntry(entry) {
        resolveExtractedPath(destDir, entry.fileName) // throws on traversal
      },
    })
    return
  }

  // .tar.gz or .tar.bz2
  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter(entryPath) {
      try {
        resolveExtractedPath(destDir, entryPath)
        return true
      }
      catch {
        return false // skip unsafe entries
      }
    },
  })
}

// ── Installation ──────────────────────────────────────────────────────────────

export interface InstallResult {
  installPath: string | null
  cmd: string | null
  args: string[]
  env: Record<string, string>
}

/** Install a binary-distribution agent for the current platform. */
export async function installBinaryAgent(
  agent: RegistryAgent,
  userData: string,
  signal?: AbortSignal,
): Promise<InstallResult> {
  const platformKey = getPlatformKey()
  if (!platformKey) {
    throw new Error('Unsupported platform for binary distribution')
  }

  const target = agent.distribution.binary?.[platformKey]
  if (!target) {
    throw new Error(`No binary distribution for platform ${platformKey} in agent ${agent.id}`)
  }

  assertSafeCmd(target.cmd)
  audit(agent.id, 'install_start', null, { distributionType: 'binary', platform: platformKey })

  const installDir = getAgentInstallDir(userData, agent.id)
  const tmpDir = getTmpDir(userData)

  // Ensure directories exist (both are inside userData)
  await fsp.mkdir(installDir, { recursive: true })
  await fsp.mkdir(tmpDir, { recursive: true })

  const ext = archiveExtension(target.archive)
  const tmpFile = join(tmpDir, `${agent.id}-${Date.now()}${ext}`)

  try {
    // 1. Download archive to temp location
    await downloadFile(target.archive, tmpFile, signal)
    if (signal?.aborted) {
      throw new DOMException('Install cancelled', 'AbortError')
    }
    audit(agent.id, 'file_download', tmpFile, { url: target.archive })

    // 2. Extract to install directory
    await extractArchive(tmpFile, installDir, ext)
    audit(agent.id, 'file_extract', installDir, { archive: tmpFile })

    // 3. Make executable (macOS / Linux)
    if (process.platform !== 'win32') {
      const execPath = join(installDir, target.cmd)
      await fsp.chmod(execPath, 0o755)
      audit(agent.id, 'file_chmod', execPath, { mode: '0755' })
    }
  }
  finally {
    // Always clean up the temp file
    await fsp.rm(tmpFile, { force: true })
  }

  return {
    installPath: installDir,
    cmd: target.cmd,
    args: target.args ?? [],
    env: target.env ?? {},
  }
}

/** "Install" a package-manager agent (npx/uvx) — no files are written. */
export function installPackageAgent(
  agent: RegistryAgent,
  type: 'npx' | 'uvx',
): InstallResult {
  const spec: PackageDistribution | undefined
    = type === 'npx' ? agent.distribution.npx : agent.distribution.uvx

  if (!spec) {
    throw new Error(`No ${type} distribution found for agent ${agent.id}`)
  }

  audit(agent.id, 'install_start', null, { distributionType: type })
  // No FS writes — audit complete immediately.
  audit(agent.id, 'install_complete', null, { distributionType: type })

  return {
    installPath: null,
    cmd: spec.package,
    args: spec.args ?? [],
    env: spec.env ?? {},
  }
}

/** Delete an installed binary agent's directory and record the audit trail. */
export async function uninstallBinaryAgent(
  agentId: string,
  installPath: string,
  userData: string,
): Promise<void> {
  // Safety: path must be inside userData/acp/agents/
  const expectedPrefix = join(userData, 'acp', 'agents') + sep
  const normalized = normalize(installPath)
  if (!normalized.startsWith(expectedPrefix)) {
    throw new Error(
      `Refusing to delete path outside of userData/acp/agents: ${installPath}`,
    )
  }

  audit(agentId, 'uninstall_start', installPath, {})
  await fsp.rm(installPath, { recursive: true, force: true })
  audit(agentId, 'file_delete', installPath, {})
  audit(agentId, 'uninstall_complete', null, {})
}

// pipeline re-export for potential future use
export { pipeline } from 'node:stream/promises'
