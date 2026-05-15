# AI Assistant UI Design Reference

Research date: 2026-05-15

---

## 1. Linear Agent Chat

### Trigger
- **Position**: Bottom-right of the desktop app (toolbar area)
- **Shortcut**: `⌘J` / `Ctrl+J`
- **Also accessible**: `@Linear` mention in any comment field
- **Select text anywhere → press shortcut** to send selected text as context

### Chat Surface
- **Type**: Maximized overlay (not a small popover — it takes over the main content area like a full page)
- **Recent change**: "Agent chat now opens in a maximized overlay, so it feels like a natural extension of the toolbar chat instead of a separate page"
- **Multi-tab support**: Each open chat appears as a tab in the toolbar for switching between topics
- **Tabs show**: short label + unread indicator + "agent is working" indicator

### Layout (from screenshots)
- **Full-width content area** with generous padding
- **Input at bottom**: Standard text input with slash-command support (`/` to invoke skills)
- **Message display**: Clean markdown rendering, agent shows progress as it works
- **Chat history**: Accessible from toolbar, grouped by recency (Today, Last week, 4 weeks ago, Older)
- **Contextual suggestions**: Related past chats surfaced based on current view

### Design Language (from UI refresh blog)
- **Color palette**: Warm gray (moved away from cool blue-ish), crisp but less saturated
- **Borders**: Rounded edges, softened contrast — "structure should be felt not seen"
- **Navigation sidebar**: Slightly dimmer than content area to reduce competition for attention
- **Icons**: Redrawn, smaller, fewer — reduced colored backgrounds
- **Tabs**: Compact, rounded corners, smaller icon and text sizing
- **Philosophy**: "Not every element should carry equal visual weight"

### Keyboard Shortcuts
- `⌘J` / `Ctrl+J` — Open/new chat
- Select text + shortcut — Send selection as context to agent
- `/` in input — Invoke skills/commands

---

## 2. Raycast AI

### Quick AI (Popover)
- **Trigger**: Single global hotkey (user-configurable)
- **Type**: Floating window above all other apps
- **Appearance**: Instantly appears as overlay
- **Position**: Centered on screen (command-palette style)
- **Size**: ~600px wide, variable height

### AI Chat (Full Panel)
- **Layout**: Sidebar with chat history (left) + main chat area (right)
- **Chat list**: Pinned chats + chronological history (Today, Yesterday sections)
- **Input**: Bottom-fixed, with model selector and submit button
- **Input field text**: "Ask AI anything…"
- **Controls around input**:
  - Model picker (dropdown showing current model e.g. "Ray-1")
  - Submit button
  - Actions menu (`⌘K`)
  - System Instructions field
  - AI Extensions toggle

### Design Details
- **Window style**: macOS-native, rounded corners (~12px radius)
- **Background**: Dark translucent/vibrancy (macOS blur effect)
- **Input field**: Minimal border, full-width, monoline expanding
- **Message bubbles**: No bubble styling — flat, left-aligned, markdown rendered
- **Typography**: System font (SF Pro), ~14px body
- **Spacing**: Generous vertical spacing between messages (~16-24px)
- **Model indicator**: Small pill/badge showing active model name

### Key Pattern: "Quick AI"
- Light and unobtrusive
- Single hotkey away
- Floating above everything
- Answers inline then dismisses

---

## 3. Cursor AI Chat

### Trigger
- **Position**: Right sidebar panel (VS Code-style)
- **Shortcut**: `⌘L` to open chat
- **Also**: `⌘K` for inline edit (Cmd+K bar appears inline in editor)

### Chat Panel Layout
- **Type**: Persistent sidebar panel (right side)
- **Width**: ~380-450px default, resizable
- **Structure**:
  - Top: Agent/model selector dropdown (e.g. "Agent", "GPT-5.5", "Opus 4.7")
  - Middle: Scrollable message area
  - Bottom: Input with submit

### Input Area
- **Position**: Bottom of panel, sticky
- **Style**: Multi-line text area, grows with content
- **Controls**:
  - Model picker (inline dropdown)
  - Agent mode selector
  - Suggested/Composer mode toggle
  - Attach context (@ mentions)

### Message Display
- **User messages**: Minimal, left-aligned
- **Assistant messages**: Markdown with code blocks, file references, diffs
- **Tool calls**: Collapsed/expandable sections showing "Grepped", "Searched", "Reading" steps
- **File changes**: Inline diff view within chat

### Design Details
- **Background**: Matches IDE theme (dark by default)
- **No distinct message bubbles**: Flat layout with separator lines
- **Code blocks**: Syntax-highlighted, with copy button
- **Font**: Monospace for code, system sans for prose
- **Animations**: Streaming text appears character by character

---

## 4. GitHub Copilot Chat (VS Code)

### Surfaces
| Surface | Shortcut | Description |
|---------|----------|-------------|
| Chat view | `⌃⌘I` | Full sidebar, multi-turn, agentic workflows |
| Inline chat | `⌘I` | In-place code edits in editor |
| Quick chat | `⇧⌥⌘L` | Lightweight panel at top of editor |

### Chat View (Primary)
- **Position**: Left or right sidebar panel (configurable)
- **Type**: Standard VS Code panel/view
- **Layout**:
  - Top: Agent selector (Agent, Plan, Ask) + Target (Local, Cloud) + Permission level
  - Middle: Message history
  - Bottom: Input with `#` mentions, `@` participants

### Quick Chat
- **Position**: Top of editor (dropdown from command center)
- **Style**: Lightweight, temporary — doesn't persist in sidebar
- **Behavior**: Opens, answer, close flow

### Input Design
- **Multi-line expanding textarea**
- **Context chips**: `#file`, `@vscode`, `@terminal` shown as pills
- **Image/attachment**: Drag or paste images as context
- **Submit**: Enter key

---

## 5. Consolidated Design Patterns & CSS-Level Details

### Common Patterns Across All Products

| Aspect | Linear | Raycast | Cursor | Copilot |
|--------|--------|---------|--------|---------|
| Trigger type | Keyboard shortcut | Global hotkey | Sidebar persistent | Sidebar persistent |
| Primary shortcut | `⌘J` | Custom hotkey | `⌘L` | `⌃⌘I` |
| Surface type | Maximized overlay | Floating window | Side panel | Side panel |
| Input position | Bottom | Bottom | Bottom | Bottom |
| Slash commands | Yes (`/skills`) | Yes | Yes (`/`) | Yes (`/`) |
| Multi-turn | Yes | Yes | Yes | Yes |
| Streaming | Yes | Yes | Yes | Yes |

### Recommended CSS Specifications

#### Container / Popover
```css
/* If implementing as overlay/popover */
.ai-panel {
  border-radius: 12px;            /* Consistent with Linear/Raycast */
  background: var(--surface-primary);
  box-shadow: 
    0 0 0 1px rgba(0,0,0,0.08),   /* Subtle border-like shadow */
    0 8px 40px rgba(0,0,0,0.12),  /* Depth shadow */
    0 2px 8px rgba(0,0,0,0.08);   /* Close shadow */
  overflow: hidden;
  
  /* Animation */
  animation: panel-enter 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* If implementing as sidebar panel */
.ai-sidebar {
  border-left: 1px solid var(--border-subtle);
  background: var(--surface-primary);
  width: 400px;
  min-width: 320px;
  max-width: 600px;
}

@keyframes panel-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

#### Input Field
```css
.ai-input {
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--border-default);
  background: var(--surface-secondary);
  font-size: 14px;
  line-height: 1.5;
  min-height: 40px;
  max-height: 200px;           /* Grows then scrolls */
  resize: none;
  transition: border-color 150ms ease;
}

.ai-input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-alpha-10);
}

.ai-input::placeholder {
  color: var(--text-muted);
  opacity: 0.5;
}
```

#### Messages
```css
.message {
  padding: 8px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.message + .message {
  margin-top: 16px;
}

.message-user {
  /* No bubble — flat, left-aligned like Linear/Cursor */
  font-weight: 500;
}

.message-assistant {
  /* Markdown content, no bubble */
}

.message-thinking {
  color: var(--text-muted);
  font-size: 13px;
  opacity: 0.7;
}
```

#### Toolbar / Header
```css
.ai-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-subtle);
  height: 48px;
}

.model-selector {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 120ms ease;
}

.model-selector:hover {
  background: var(--surface-hover);
}
```

#### Animation Timing (consistent across products)
```css
:root {
  --duration-fast: 120ms;      /* Hover states, micro-interactions */
  --duration-normal: 200ms;    /* Panel open/close, transitions */
  --duration-slow: 300ms;      /* Page-level transitions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);    /* Spring-like out */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);  /* Standard motion */
}
```

---

## 6. Key Takeaways for Cradle

1. **Trigger**: `⌘J` is the standard for AI chat (Linear uses it). Consider adopting.
2. **Panel type**: For a desktop app, **maximized overlay** (Linear's approach) feels most premium. Sidebar works for IDE contexts.
3. **No bubbles**: Modern AI UIs (Linear, Cursor) avoid chat-bubble styling. Flat, left-aligned messages with generous spacing.
4. **Input always at bottom**: All products place input at the bottom, sticky.
5. **Slash commands**: Universal pattern for invoking skills/presets.
6. **Streaming + progress**: Show what the agent is doing (tool calls, searches) as collapsible steps.
7. **Context chips**: Show attached context as small pills/tags near the input.
8. **Multi-tab chat**: Linear's tab approach for multiple concurrent chats is elegant.
9. **Typography**: 14px body, 1.5-1.6 line-height, system font for prose.
10. **Borders**: Minimal. Use spacing and subtle color differences instead of heavy borders.
11. **Color**: Warm neutrals (not cool blue). Content area brighter than surrounding chrome.
12. **Animation**: 200ms with spring-like easing for panel entry. Fast (120ms) for hover states.
