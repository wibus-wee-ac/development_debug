import type { SkillDefinition } from '@cradle/plugin-sdk/server'
import { registerPluginCapability } from './runtime-registry'

const skills: SkillDefinition[] = []

export function registerPluginSkill(skill: SkillDefinition): void {
  skills.push(skill)
}

export function registerOwnedPluginSkill(owner: string, skill: SkillDefinition): void {
  registerPluginSkill(skill)
  registerPluginCapability(owner, 'skill', 'server', skill.name, skill.name, {
    description: skill.description,
    skillFile: skill.skillFile,
  })
}

export function getPluginSkills(): readonly SkillDefinition[] {
  return skills
}
