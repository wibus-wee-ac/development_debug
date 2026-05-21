<p align="center">
  <p align="center">
    <img src="./.github/Cradle.png" alt="Preview" width="182" />
  </p>
  <h1 align="center"><b>Cradle</b></h1>
  <p align="center">
    AI agent management platform. It provides a unified interface for organizing information, managing AI agents, and facilitating human-AI collaboration.
    <br />
    <br />
    <b>Download for </b>
    <a href="">Source Code</a>
    <br />
  </p>
</p>

<pre align="center">
🧪 Working in Progress
</pre>

## Architecture Snapshot

Cradle's current chat/runtime stack is centered on:

- durable chat history stored as `messages.messageJson` snapshots
- derived plain-text cache in `messages.content`
- live chat updates streamed as sequenced SSE delta events (`message_delta`, `subagent_message_delta`, `run_*`)

Current architecture references:

- `docs/SPEC-v2.md`
- `docs/for-users/`
- `docs/exec-plans/20260516-03-message-snapshot-chat-runtime.md`

## Packages

| Package | Description | Status |
|---|---|---|
| [`@cradle/tabs-next`](./packages/tabs-next) | Navigation-context tab runtime for React desktop apps — retained tab history, bounded Activity rendering, hash-based URL sync, and `<Link>` routing. | ![Beta](https://img.shields.io/badge/status-Beta-yellow) |
| [`@cradle/ipc`](./packages/ipc) [^ipc-decorator] | Type-safe IPC communication layer for Electron apps, built on top of `electron-ipc-decorator`. Provides a structured way to define IPC services with decorators, automatic type inference, and error handling. | ![Stable](https://img.shields.io/badge/status-Stable-green) |

## Official Plugins

| Plugin | Description | Status |
|---|---|---|
| [`@cradle/browser-use`](./plugins/browser-use) | 控制 Cradle 内置浏览器的 MCP 插件，支持导航、点击、输入、截图、页面文本读取和 DOM 结构检查。 | ![Beta](https://img.shields.io/badge/status-Beta-yellow) |
| [`@cradle/cc-switch`](./plugins/cc-switch) | 将 CC Switch provider 数据以只读 external provider source 的方式映射到 Cradle。 | ![Beta](https://img.shields.io/badge/status-Beta-yellow) |
| [`@cradle/system-info`](./plugins/system-info) | 通过插件 API 和 Web command 暴露系统信息能力。 | ![Beta](https://img.shields.io/badge/status-Beta-yellow) |

## Author

Cradle © Wibus, Released under AGPLv3. Created on Apr 25, 2026

> [Personal Website](http://wibus.ren/) · [Blog](https://blog.wibus.ren/) · GitHub [@wibus-wee](https://github.com/wibus-wee/) · Telegram [@wibus✪](https://t.me/wibus_wee)


[^ipc-decorator]: Thanks to [Innei/electron-ipc-decorator](https://github.com/Innei/electron-ipc-decorator) for the IPC decorator inspiration and some utility code patterns.
