// Input: SkillManager shared UI
// Output: Settings page wrapper for globally managed skills under ~/.cradle/skills
// Position: Settings section for shared skills management with legacy and built-in layers shown as inherited read-only context

import { SkillManager } from './skill-manager'

export function GlobalSkillsSettings() {
  return (
    <SkillManager
      editableScope="global"
      pageTestId="global-skills-page"
      title="Skills"
      description="Manage shared skills under ~/.cradle/skills while reviewing inherited legacy and built-in skills."
    />
  )
}
