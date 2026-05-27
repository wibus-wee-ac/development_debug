import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, join, resolve, sep } from 'node:path'

import fg from 'fast-glob'
import ignore from 'ignore'

export interface WorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

export type WorkspaceFilePreviewKind = 'text' | 'markdown' | 'image' | 'pdf' | 'office' | 'unsupported'

export interface WorkspaceFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: number
  mimeType: string
  extension: string
  previewKind: WorkspaceFilePreviewKind
}

export interface WorkspaceFileWriteBoundary {
  classification: 'non-cradle-owned'
  owner: 'workspace'
  consentRequired: true
  consentConfirmed: true
  workspacePath: string | null
  relativePath: string
  targetPath: string | null
}

export async function listFiles(workspacePath: string): Promise<WorkspaceFileEntry[]> {
  const ig = ignore()
  try {
    ig.add(await readFile(join(workspacePath, '.gitignore'), 'utf8'))
  }
  catch {
    // Missing .gitignore is fine.
  }
  ig.add(['node_modules', '.git', '.DS_Store'])

  const entries = await fg('**/*', {
    cwd: workspacePath,
    dot: false,
    onlyFiles: false,
    markDirectories: true,
  })

  return entries
    .filter(ig.createFilter())
    .map((entry) => {
      const isDirectory = entry.endsWith('/')
      const cleanPath = isDirectory ? entry.slice(0, -1) : entry
      return {
        type: isDirectory ? 'directory' as const : 'file' as const,
        name: basename(cleanPath),
        path: cleanPath,
      }
    })
}

export async function readTextFile(workspacePath: string, relativePath: string): Promise<string | null> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return null
  }
  try {
    return await readFile(fullPath, 'utf8')
  }
  catch {
    return null
  }
}

export async function getWorkspaceFileInfo(workspacePath: string, relativePath: string): Promise<WorkspaceFileInfo | null> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return null
  }
  try {
    const fileStat = await stat(fullPath)
    if (!fileStat.isFile()) {
      return null
    }
    const extension = extname(fullPath).toLowerCase()
    let mimeType = getWorkspaceFileMimeType(extension, basename(fullPath))
    let previewKind = getWorkspaceFilePreviewKind(extension, mimeType, basename(fullPath))

    if (previewKind === 'unsupported' && await looksLikeTextFile(fullPath)) {
      mimeType = 'text/plain; charset=utf-8'
      previewKind = 'text'
    }

    return {
      name: basename(fullPath),
      path: relativePath,
      size: fileStat.size,
      modifiedAt: Math.floor(fileStat.mtimeMs),
      mimeType,
      extension,
      previewKind,
    }
  }
  catch {
    return null
  }
}

export async function readWorkspaceFileBytes(workspacePath: string, relativePath: string): Promise<Uint8Array | null> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return null
  }
  try {
    const fileStat = await stat(fullPath)
    if (!fileStat.isFile()) {
      return null
    }
    return await readFile(fullPath)
  }
  catch {
    return null
  }
}

export async function renderWorkspaceFilePdf(input: {
  workspacePath: string
  relativePath: string
  cacheRoot: string
}): Promise<{ bytes: Uint8Array, source: 'native-pdf' | 'office-rendition' } | null> {
  const fullPath = resolveWorkspaceFilePath(input.workspacePath, input.relativePath)
  if (!fullPath) {
    return null
  }

  const info = await getWorkspaceFileInfo(input.workspacePath, input.relativePath)
  if (!info) {
    return null
  }

  if (info.previewKind === 'pdf') {
    const bytes = await readWorkspaceFileBytes(input.workspacePath, input.relativePath)
    return bytes ? { bytes, source: 'native-pdf' } : null
  }

  if (info.previewKind !== 'office') {
    return null
  }

  const fileStat = await stat(fullPath)
  const cacheKey = createHash('sha256')
    .update(fullPath)
    .update('\0')
    .update(String(fileStat.size))
    .update('\0')
    .update(String(fileStat.mtimeMs))
    .digest('hex')
  const cachePath = join(input.cacheRoot, `${cacheKey}.pdf`)

  if (existsSync(cachePath)) {
    return { bytes: await readFile(cachePath), source: 'office-rendition' }
  }

  await mkdir(dirname(cachePath), { recursive: true })
  const sofficeBin = findLibreOfficeCommand()
  if (!sofficeBin) {
    throw new Error('LibreOffice is not installed or not available on PATH.')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'cradle-office-rendition-'))
  try {
    await convertOfficeFileToPdf({
      command: sofficeBin,
      inputPath: fullPath,
      outputDir: tempDir,
    })
    const outputPath = await findConvertedPdf(tempDir, fullPath)
    if (!outputPath) {
      throw new Error('LibreOffice did not produce a PDF rendition.')
    }
    await rename(outputPath, cachePath)
    return { bytes: await readFile(cachePath), source: 'office-rendition' }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function writeTextFile(workspacePath: string, relativePath: string, content: string): Promise<boolean> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return false
  }
  try {
    await writeFile(fullPath, content, 'utf8')
    return true
  }
  catch {
    return false
  }
}

export async function createEmptyFile(workspacePath: string, relativePath: string): Promise<boolean> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return false
  }
  try {
    await writeFile(fullPath, '', { encoding: 'utf8', flag: 'wx' })
    return true
  }
  catch {
    return false
  }
}

export async function createDirectory(workspacePath: string, relativePath: string): Promise<boolean> {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relativePath)
  if (!fullPath) {
    return false
  }
  try {
    await mkdir(fullPath)
    return true
  }
  catch {
    return false
  }
}

export async function renameWorkspacePath(workspacePath: string, sourcePath: string, destinationPath: string): Promise<boolean> {
  const sourceFullPath = resolveWorkspaceFilePath(workspacePath, sourcePath)
  const destinationFullPath = resolveWorkspaceFilePath(workspacePath, destinationPath)
  if (!sourceFullPath || !destinationFullPath) {
    return false
  }
  try {
    await stat(destinationFullPath)
    return false
  }
  catch {
    // Missing destination is required so rename never overwrites user files.
  }
  try {
    await rename(sourceFullPath, destinationFullPath)
    return true
  }
  catch {
    return false
  }
}

export function resolveWorkspaceFilePath(workspacePath: string, relativePath: string): string | null {
  const resolvedWorkspace = resolve(workspacePath)
  const fullPath = resolve(resolvedWorkspace, relativePath)
  return isWithinRoot(resolvedWorkspace, fullPath) ? fullPath : null
}

export function createWorkspaceFileWriteBoundary(input: {
  workspacePath: string | null
  relativePath: string
}): WorkspaceFileWriteBoundary {
  const targetPath = input.workspacePath
    ? resolveWorkspaceFilePath(input.workspacePath, input.relativePath)
    : null
  return {
    classification: 'non-cradle-owned',
    owner: 'workspace',
    consentRequired: true,
    consentConfirmed: true,
    workspacePath: input.workspacePath,
    relativePath: input.relativePath,
    targetPath,
  }
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(targetPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

const mimeTypesByExtension: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const officeExtensions = new Set(['.doc', '.docx', '.odp', '.ods', '.odt', '.ppt', '.pptx', '.rtf', '.xls', '.xlsx'])
const imageExtensions = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const markdownExtensions = new Set(['.md', '.mdx'])
const textExtensions = new Set([
  '.astro',
  '.c',
  '.cfg',
  '.cjs',
  '.clj',
  '.cljs',
  '.conf',
  '.cpp',
  '.cs',
  '.cts',
  '.css',
  '.csv',
  '.dart',
  '.diff',
  '.dockerfile',
  '.editorconfig',
  '.env',
  '.erl',
  '.ex',
  '.exs',
  '.fs',
  '.fsx',
  '.gitattributes',
  '.gitignore',
  '.go',
  '.gql',
  '.graphql',
  '.hrl',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.lock',
  '.log',
  '.lua',
  '.mjs',
  '.mts',
  '.nix',
  '.patch',
  '.php',
  '.pl',
  '.pm',
  '.proto',
  '.r',
  '.rb',
  '.rs',
  '.scala',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zig',
  '.zsh',
])

const textFileNames = new Set([
  '.env',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'brewfile',
  'dockerfile',
  'gemfile',
  'justfile',
  'makefile',
  'procfile',
  'rakefile',
  'taskfile',
])

const TEXT_SAMPLE_BYTES = 8192

function getWorkspaceFileMimeType(extension: string, fileName: string): string {
  return mimeTypesByExtension[extension] ?? (isKnownTextFile(extension, fileName) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
}

function getWorkspaceFilePreviewKind(extension: string, mimeType: string, fileName: string): WorkspaceFilePreviewKind {
  if (markdownExtensions.has(extension)) {
    return 'markdown'
  }
  if (imageExtensions.has(extension) || mimeType.startsWith('image/')) {
    return 'image'
  }
  if (extension === '.pdf') {
    return 'pdf'
  }
  if (officeExtensions.has(extension)) {
    return 'office'
  }
  if (isKnownTextFile(extension, fileName) || mimeType.startsWith('text/') || mimeType.includes('json')) {
    return 'text'
  }
  return 'unsupported'
}

function isKnownTextFile(extension: string, fileName: string): boolean {
  const normalizedFileName = fileName.toLowerCase()
  return textExtensions.has(extension)
    || textFileNames.has(normalizedFileName)
    || normalizedFileName.startsWith('.env.')
}

async function looksLikeTextFile(fullPath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(fullPath, 'r')
    const sample = Buffer.alloc(TEXT_SAMPLE_BYTES)
    const { bytesRead } = await handle.read(sample, 0, sample.byteLength, 0)
    if (bytesRead === 0) {
      return true
    }

    const bytes = sample.subarray(0, bytesRead)
    if (bytes.includes(0)) {
      return false
    }

    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (!decoded) {
      return true
    }

    let replacementCount = 0
    let controlCount = 0
    for (const char of decoded) {
      if (char === '\uFFFD') {
        replacementCount += 1
        continue
      }
      const code = char.charCodeAt(0)
      if (code < 32 && char !== '\n' && char !== '\r' && char !== '\t') {
        controlCount += 1
      }
    }

    return replacementCount <= Math.max(1, decoded.length * 0.01)
      && controlCount <= Math.max(1, decoded.length * 0.02)
  }
  catch {
    return false
  }
  finally {
    await handle?.close()
  }
}

function findLibreOfficeCommand(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    process.env.SOFFICE_PATH,
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    findExecutableInPath('soffice'),
    findExecutableInPath('libreoffice'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate.includes(sep) && !existsSync(candidate)) {
      continue
    }
    return candidate
  }
  return null
}

function findExecutableInPath(command: string): string | null {
  const pathValue = process.env.PATH
  if (!pathValue) {
    return null
  }
  for (const dir of pathValue.split(delimiter)) {
    const candidate = join(dir, command)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function convertOfficeFileToPdf(input: {
  command: string
  inputPath: string
  outputDir: string
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(input.command, [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      input.outputDir,
      input.inputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('LibreOffice conversion timed out.'))
    }, 60_000)

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(stderr.trim() || `LibreOffice exited with code ${code}.`))
    })
  })
}

async function findConvertedPdf(outputDir: string, sourcePath: string): Promise<string | null> {
  const expected = join(outputDir, `${basename(sourcePath, extname(sourcePath))}.pdf`)
  if (existsSync(expected)) {
    return expected
  }
  const entries = await readdir(outputDir)
  const pdf = entries.find(entry => extname(entry).toLowerCase() === '.pdf')
  return pdf ? join(outputDir, pdf) : null
}
