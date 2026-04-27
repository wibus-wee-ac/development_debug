// Input: node:fs, node:path, node:os, js-yaml for SKILL.md frontmatter parsing
// Output: scanSkills() — discovers and returns skill catalog entries
// Position: Main-process utility for skills progressive disclosure (tier 1: catalog)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import yaml from 'js-yaml'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

export interface SkillCatalogEntry {
  name: string
  description: string
  location: string
}

/**
 * Scan `.agents/skills/` directories for SKILL.md files.
 * Project-level skills override user-level skills with the same name.
 */
export function scanSkills(workspacePath?: string): SkillCatalogEntry[] {
  const skillsByName = new Map<string, SkillCatalogEntry>()

  // User-level skills (lower priority — scanned first, overwritten by project-level)
  const userSkillsDir = path.join(os.homedir(), '.agents', 'skills')
  scanDirectory(userSkillsDir, skillsByName)

  // Project-level skills (higher priority — overwrites user-level)
  if (workspacePath) {
    const projectSkillsDir = path.join(workspacePath, '.agents', 'skills')
    scanDirectory(projectSkillsDir, skillsByName)
  }

  return Array.from(skillsByName.values())
}

function scanDirectory(skillsDir: string, result: Map<string, SkillCatalogEntry>): void {
  if (!fs.existsSync(skillsDir)) {
    return
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  }
  catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) {
      continue
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const parsed = parseFrontmatter(content)
      if (parsed?.name && parsed?.description) {
        result.set(parsed.name, {
          name: parsed.name,
          description: parsed.description,
          location: skillMdPath,
        })
      }
    }
    catch {
      // Malformed SKILL.md — skip
    }
  }
}

function parseFrontmatter(content: string): { name?: string, description?: string } | null {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    return null
  }
  try {
    const data = yaml.load(match[1]) as Record<string, unknown>
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
    }
  }
  catch {
    return null
  }
}

/**
 * Build a skill catalog text block for injection into system prompts.
 */
export function buildSkillCatalog(entries: SkillCatalogEntry[]): string {
  if (entries.length === 0) {
    return ''
  }
  const lines = entries.map(e => `- ${e.name}: ${e.description} [${e.location}]`)
  return `\nAvailable skills (read the SKILL.md file at the listed path when the task matches):\n${lines.join('\n')}`
}
