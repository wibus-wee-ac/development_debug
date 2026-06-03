# 本地数据存储

## 目标

Cradle 应继续使用 typed SQLite/Drizzle 存储 local-first durable state，并要求每个 capability 明确拥有自己的 schema、migration、cleanup 语义。

## Alma 证据

Alma 使用 `better-sqlite3`、Drizzle、FTS tables、`jieba-wasm`、`sqlite-vec`。表面覆盖 chat、providers、prompt apps、workspaces、plugins、MCP、memories、activity recorder、computer use、agent missions、gallery、channels、usage。

## Cradle 当前状态

Cradle 已使用 SQLite、Drizzle、migrations、WAL 和 `packages/db` typed schema。现有 schema 覆盖 chat、usage、approvals、agents、profiles、issues、automation、ACP、Chronicle、observability、session await、workspace。

## Owner / Namespace

`packages/db` 拥有 schema 与 migrations。每个 `apps/server/src/modules/*` owner 拥有语义生命周期和 cleanup。禁止一个 feature 直接写入另一个 owner namespace。

## 目标行为

- 每个新 spec 都要声明 owned tables 与 foreign keys。
- 共享实体通过 id 引用，除非是不可变 snapshot，否则不复制对方数据。
- import/export 由 backup owner 编排，各 feature 提供 serializer，不做 ad hoc SQL dump。

## 验收

- Alma-inspired feature 的实现计划包含 migration 和 cleanup。
- 删除 parent entity 后不留下 orphan rows。
- 数据访问保持 Drizzle-first。
