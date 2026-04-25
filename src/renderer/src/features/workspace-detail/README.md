<!-- Once this directory changes, update this README.md -->

# Workspace Detail

Project detail page for viewing and editing workspace configuration files.
Uses Tiptap for WYSIWYG Markdown editing of README.md and AGENTS.md.
Shiki provides syntax highlighting for code blocks with a language selector.

## Files

- **workspace-detail-page.tsx**: Main page component with two-column layout (editor tabs + sidebar)
- **markdown-editor.tsx**: Tiptap-based WYSIWYG Markdown editor with auto-save
- **shiki-code-block.tsx**: Custom Tiptap extension using Shiki for code block highlighting
- **code-block-view.tsx**: React NodeView for code blocks with language selector dropdown
- **use-workspace-file.ts**: Hook for reading/writing workspace text files via IPC
- **index.ts**: Barrel exports
