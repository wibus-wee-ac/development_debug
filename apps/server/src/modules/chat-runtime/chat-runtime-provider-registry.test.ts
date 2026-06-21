import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { registerPluginSkill, resetPluginSkillRegistry } from '../../plugins/skill-registry'
import { resolveRuntimeSkillPaths } from './chat-runtime-provider-registry'

let tempDir: string | undefined

function createTempDir(): string {
  tempDir = fs.mkdtempSync(join(tmpdir(), 'cradle-runtime-skill-paths-'))
  return tempDir
}

function createSkillPackage(root: string): string {
  const skillDir = join(root, 'plugin-extra-root')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: plugin-extra-root',
    'description: Plugin extra root',
    '---',
    '',
    '# Plugin Extra Root',
  ].join('\n'))
  return skillDir
}

describe('runtime skill path resolution', () => {
  afterEach(() => {
    resetPluginSkillRegistry()
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('includes registered plugin skill packages and invalidates cached paths when registrations change', () => {
    const root = createTempDir()
    const workspacePath = join(root, 'workspace')
    const skillDir = createSkillPackage(root)

    expect(resolveRuntimeSkillPaths(workspacePath)).not.toContain(skillDir)

    registerPluginSkill('@cradle/plugin-extra-root', {
      name: 'plugin-extra-root',
      description: 'Plugin extra root',
      skillFile: join(skillDir, 'SKILL.md'),
    })
    expect(resolveRuntimeSkillPaths(workspacePath)).toContain(skillDir)

    resetPluginSkillRegistry()
    expect(resolveRuntimeSkillPaths(workspacePath)).not.toContain(skillDir)
  })
})
