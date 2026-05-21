import { SkillManager } from './skill-manager'

export function GlobalSkillsSettings() {
  return (
    <SkillManager
      editableScope="global"
      pageTestId="global-skills-page"
      title="Skills"
      description="Manage Cradle-only skills under ~/.cradle/skills while reviewing inherited standard .agents and built-in skills."
    />
  )
}
