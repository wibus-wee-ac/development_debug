// Input: skills feature modules
// Output: Public barrel exports for skills management UIs and hooks
// Position: Feature entry point for settings, workspace detail, and agent identity integration

export { GlobalSkillsSettings } from './global-skills-settings'
export { SkillImportDialog } from './skill-import-dialog'
export { SkillManager } from './skill-manager'
export { useSkillDocument, useSkills, useSkillSourceImport } from './use-skills'
