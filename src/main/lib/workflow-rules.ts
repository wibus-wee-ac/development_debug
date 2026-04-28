// Input: Node.js fs/promises, os.homedir() for ~/.cradle/ path resolution
// Output: Functions to read, write, delete, and list workflow rules stored as Markdown files
// Position: Main-process utility for managing workflow rules on the filesystem under ~/.cradle/workflows/

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CRADLE_DIR = join(homedir(), '.cradle')
const WORKFLOWS_DIR = join(CRADLE_DIR, 'workflows')

const UNSAFE_ID_RE = /[/\\]|\.\./
const MD_EXT_RE = /\.md$/

/**
 * Validate an ID to prevent path traversal.
 * IDs should be UUID format (alphanumeric + hyphens).
 */
function assertSafeId(id: string): void {
  if (!id || UNSAFE_ID_RE.test(id)) {
    throw new Error(`Invalid ID: ${id}`)
  }
}

function getGlobalRulePath(workspaceId: string): string {
  assertSafeId(workspaceId)
  return join(WORKFLOWS_DIR, workspaceId, 'rules.md')
}

function getAgentRulePath(workspaceId: string, agentProfileId: string): string {
  assertSafeId(workspaceId)
  assertSafeId(agentProfileId)
  return join(WORKFLOWS_DIR, workspaceId, 'agents', `${agentProfileId}.md`)
}

export interface WorkflowRules {
  global: string | null
  profileSpecific: string | null
}

export async function getWorkflowRules(
  workspaceId: string,
  agentProfileId?: string,
): Promise<WorkflowRules> {
  let global: string | null = null
  let profileSpecific: string | null = null

  try {
    global = await readFile(getGlobalRulePath(workspaceId), 'utf-8')
  }
  catch {
    // File does not exist — no global rules
  }

  if (agentProfileId) {
    try {
      profileSpecific = await readFile(getAgentRulePath(workspaceId, agentProfileId), 'utf-8')
    }
    catch {
      // File does not exist — no profile-specific rules
    }
  }

  return { global, profileSpecific }
}

export async function saveWorkflowRule(
  workspaceId: string,
  agentProfileId: string | null,
  content: string,
): Promise<void> {
  const filePath = agentProfileId
    ? getAgentRulePath(workspaceId, agentProfileId)
    : getGlobalRulePath(workspaceId)

  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteWorkflowRule(
  workspaceId: string,
  agentProfileId: string | null,
): Promise<void> {
  const filePath = agentProfileId
    ? getAgentRulePath(workspaceId, agentProfileId)
    : getGlobalRulePath(workspaceId)

  try {
    await unlink(filePath)
  }
  catch {
    // File does not exist — nothing to delete
  }
}

export interface WorkflowRuleEntry {
  type: 'global' | 'agent'
  agentProfileId: string | null
  content: string
}

export async function listWorkflowRules(workspaceId: string): Promise<WorkflowRuleEntry[]> {
  assertSafeId(workspaceId)
  const entries: WorkflowRuleEntry[] = []

  // Check global rule
  try {
    const content = await readFile(getGlobalRulePath(workspaceId), 'utf-8')
    entries.push({ type: 'global', agentProfileId: null, content })
  }
  catch {
    // No global rule
  }

  // Check agent-specific rules
  const agentsDir = join(WORKFLOWS_DIR, workspaceId, 'agents')
  try {
    const files = await readdir(agentsDir)
    for (const file of files) {
      if (!file.endsWith('.md')) {
        continue
      }
      const agentProfileId = file.replace(MD_EXT_RE, '')
      try {
        const content = await readFile(join(agentsDir, file), 'utf-8')
        entries.push({ type: 'agent', agentProfileId, content })
      }
      catch {
        // Skip unreadable files
      }
    }
  }
  catch {
    // No agents directory
  }

  return entries
}
