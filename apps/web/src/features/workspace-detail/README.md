<!-- Once this directory changes, update this README.md -->

# Workspace Detail

Project detail page for viewing and editing workspace configuration files.
Uses Tiptap for WYSIWYG Markdown editing of AGENTS.md plus dedicated panes for workflow rules and workspace skills.
Shiki provides syntax highlighting for code blocks with a language selector where rich text editing is used.

## Files

- **workspace-detail-page.tsx**: Main page component with inline workspace rename, Overview AGENTS.md content, Workflow Rules + Skills tabs, scroll-position-aware right outline minimap, and two-column layout; its capsule launcher now shares the chat feature's response-start command when opening a fresh chat
- **capsule-composer.tsx**: Workspace overview composer，复用 shared persisted new-chat preference state，避免组件自己直接读写 localStorage
- **workspace-workflow-rules.tsx**: Workflow rules editor with Agent scope selector, stable E2E anchors, and scope-safe editor remounting so async-loaded global / per-Agent rules stay aligned during switching and reopen flows
- **markdown-editor.tsx**: Tiptap-based WYSIWYG Markdown editor with auto-save
- **shiki-code-block.tsx**: Custom Tiptap extension using Shiki for code block highlighting
- **code-block-view.tsx**: React NodeView for code blocks with language selector dropdown
- **use-workspace-file.ts**: Hook for reading/writing workspace text files via IPC
- **index.ts**: Barrel exports
