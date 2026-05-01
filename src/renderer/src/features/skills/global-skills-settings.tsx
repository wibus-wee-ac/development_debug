// Input: SkillManager shared UI
// Output: Settings page for global skills management
// Position: Settings section for filesystem-backed global skills CRUD with built-in skills shown as context

import { SkillManager } from './skill-manager'

export function GlobalSkillsSettings() {
  return (
    <SkillManager
      editableScope="global"
      pageTestId="global-skills-page"
      title="Skills"
      description="Manage your global skills under ~/.agents/skills and review the built-in skills bundled with Cradle."
    />
  )
}
