import type { Disposable } from '@cradle/plugin-sdk'
import type { SkillDefinition } from '@cradle/plugin-sdk/server'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const skills: SkillDefinition[] = []

export function registerPluginSkill(skill: SkillDefinition): void {
  skills.push(skill)
}

export function registerOwnedPluginSkill(owner: string, skill: SkillDefinition): Disposable {
  const record = registerPluginCapability(owner, 'skill', 'server', skill.name, skill.name, {
    description: skill.description,
    skillFile: skill.skillFile,
  }, [`skill.${skill.name}`])
  registerPluginSkill(skill)
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      const index = skills.indexOf(skill)
      if (index >= 0) {
        skills.splice(index, 1)
      }
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function getPluginSkills(): readonly SkillDefinition[] {
  return skills
}
