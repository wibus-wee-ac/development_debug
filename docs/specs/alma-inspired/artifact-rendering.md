# Artifact Rendering

## 目标

Cradle 需要为 chat-generated artifacts 定义安全、可扩展的 rendering contract，覆盖 code、HTML、React、Mermaid、SVG、script-like output、charts 和 preview/code switching。该能力应服务 agent workspace 审阅，而不是绕过 workspace 或 browser sandbox。

## Alma 证据

Alma renderer 包含 `HtmlRenderer`、`ReactRenderer`、`MermaidRenderer`、`SvgRenderer`、`ScriptRenderer`、`CodeRenderer` 和 `PreviewRenderer`。`ReactRenderer` 使用 sandbox iframe，`SvgRenderer` 会移除 `<script>` 和 inline event handler，消息与 artifact 还使用 KaTeX、Mermaid、Shiki 和 chart 相关 assets。

## Cradle 当前状态

Cradle 已有 `@cradle/streamdown`、chat message rendering、tool call classification、diff preview、code blocks、citation popover 和 workspace/file views。当前没有看到和 Alma 等价的独立 artifact renderer registry、sandbox policy 和 preview/code tab contract。

## Owner / Namespace

`apps/web/src/features/chat` 拥有消息内 artifact projection。未来 `apps/web/src/features/artifacts` 可以拥有 renderer registry、sandbox host 和 artifact toolbar。`chat-runtime` 只保存 artifact metadata 和 source message provenance，不拥有 renderer implementation。

## 目标行为

- Artifact type 由 structured message part 或 server-owned metadata 决定，不从自由文本猜测。
- HTML、React、SVG 和 script-like artifacts 默认在 sandbox 中渲染。
- Preview/code tab 可切换，且 preview failure 不影响原始 code 查看。
- Mermaid、math、charts 等 renderer 有 size/time limits 和 graceful fallback。

## API 草案

- 复用 chat session message APIs。
- Optional `GET /artifacts/:id`
- Optional `POST /artifacts/:id/render-metadata`

## 数据模型

Artifact record 保存 source session、message id、type、mime、content ref、createdAt、renderer version 和 safety classification。Large content 应引用 asset 或 workspace file，不直接塞入 projection-only UI state。

## 验收

- Malicious SVG 不会执行 script 或 inline handler。
- React artifact 不能访问 parent window secrets、Node APIs 或 arbitrary filesystem。
- Renderer crash 只影响当前 artifact preview，不破坏整条 chat message。
