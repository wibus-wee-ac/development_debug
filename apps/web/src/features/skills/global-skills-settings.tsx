// Input: SkillManager shared UI
// Output: Settings page wrapper for Cradle-managed skills under ~/.cradle/skills
// Position: Settings section for Cradle-only skills with standard and built-in layers shown as inherited read-only context

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
