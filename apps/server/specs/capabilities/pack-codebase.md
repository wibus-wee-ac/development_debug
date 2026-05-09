# Pack Codebase Capability SPEC

## Goal

提供一个 HTTP-first 的代码库打包能力：给定 `workspaceId` 和打包选项，服务端使用 `repomix` 产出可直接返回给客户端的打包结果。

## Current Behavior Evidence

- 旧入口：`src/main/app/ipc/pack-codebase.ts`
- 旧核心：`src/main/pack-codebase/pack-codebase.ts`
- 旧世界只暴露 `workspaceId -> pack(params)` 契约，最终结果包含：
  - `content`
  - `totalFiles`
  - `totalTokens`

## Product Semantics

- 输入属于 `workspace` owner：只能基于已登记的 `workspaceId` 打包
- 打包工作在服务端完成
- 结果直接通过 HTTP 返回
- 剪贴板写入不是 server capability 的一部分

## Target HTTP API

- `POST /workspaces/:workspaceId/pack`

请求体：

```json
{
  "style": "plain | markdown | xml",
  "compress": true,
  "include": "optional glob",
  "ignore": "optional glob",
  "removeComments": true,
  "removeEmptyLines": true
}
```

响应体：

```json
{
  "content": "...",
  "totalFiles": 12,
  "totalTokens": 3456
}
```

## Dependencies

- `WorkspaceModule`：解析 `workspaceId -> workspace.path`
- `repomix`
- Node `fs/promises` / `os.tmpdir` / `path`

## Non-Goals

- Electron clipboard
- IPC compatibility layer
- 持久化 pack 结果
- packaged Electron runtime 路径兼容逻辑

## Test Plan

- happy path：对真实临时 workspace 进行打包并返回内容/统计
- invalid payload：返回结构化 400
- missing workspace：返回结构化 404
- ignore/include 选项生效
