<!--
Input: Alma livecoding/Strudel renderer evidence and Cradle TUI/editor audit.
Output: Spec for live coding and audio coding surface.
Position: docs/specs/alma-inspired/live-coding-strudel.md
-->

# Live Coding 与 Strudel

## 目标

Cradle 如果引入 live coding 和 Strudel-style audio coding，应把它作为独立 creative tool surface，而不是 terminal replacement。Chat 可以生成代码，但执行、音频资源和 sandbox policy 必须由该 feature 自己拥有。

## Alma 证据

Alma 包含 `livecoding.html`、`LiveCodingEditor`、`LiveCodingVisualization`、`LiveCodingHelp`、`LiveCodingConsole`、CodeMirror、`@strudel/web` 和 `tone`。这说明它有面向 live music/code execution 的独立窗口。

## Cradle 当前状态

Cradle 有 PTY/TUI、workspace editor、chat code rendering 和 diff review。当前没有 live coding/audio runtime，也没有 browser audio sandbox surface。

## Owner / Namespace

未来 `apps/web/src/features/live-coding` 拥有 editor、visualization、console、draft state 和 audio runtime UI。Audio engine resources 必须显式 sandboxed。`chat-runtime` 只负责生成或引用代码，不拥有 execution。

## 目标行为

- 用户可以从 chat artifact 或 workspace file 打开 live coding surface。
- Code 在 sandboxed browser/audio context 中运行，不能访问 Node 或 shell。
- 用户可以把代码保存回 workspace，或发送回 chat。
- Audio autoplay、mute、stop 和 permission 行为遵循 browser/desktop policy。

## API / UI 草案

- Web route: `/live-coding?artifactId=...`
- Optional `POST /live-coding/sessions`
- Chat action: open selected code in live coding window.

## 数据模型

只有用户保存时才持久化 sessions。Unsaved live code 属于 local draft state。Saved session 记录 source artifact、workspace path、runtime version 和 last run metadata。

## 验收

- Running generated Strudel code 不能执行 arbitrary Node 或 shell code。
- 关闭 live coding window 前，如果有 unsaved code，需要提示用户确认。
- Audio output 可以可靠 mute 和 stop。
