<!-- Once this directory changes, update this README.md -->

# Components/Editor

Shared Tiptap-based Markdown editor with WYSIWYG editing, slash commands, and syntax highlighting.
Extracted from workspace-detail feature for reuse across kanban issue descriptions and other features.
Extensions: StarterKit, HeadingWithId, Markdown, SlashCommand, ShikiCodeBlock, BubbleMenu.

## Files

- **index.ts**: Barrel export for the editor module
- **markdown-editor.tsx**: Main `MarkdownEditor` component (content/onSave/readonly/placeholder/className)
- **editor-bubble-menu.tsx**: Floating toolbar for inline formatting (bold/italic/strike/code/link)
- **slash-command.tsx**: Tiptap extension for `/` command menu
- **slash-command-list.tsx**: Dropdown UI for slash command suggestions
- **heading-with-id.ts**: Heading extension with auto-slugified anchor IDs
- **shiki-code-block.tsx**: Code block extension with Shiki syntax highlighting
- **code-block-view.tsx**: React NodeView for code blocks with language selector
