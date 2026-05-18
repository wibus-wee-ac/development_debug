import type { SkillDefinition } from '@cradle/plugin-sdk/server'

const skills: SkillDefinition[] = []

export function registerPluginSkill(skill: SkillDefinition): void {
  skills.push(skill)
}

export function getPluginSkills(): readonly SkillDefinition[] {
  return skills
}
