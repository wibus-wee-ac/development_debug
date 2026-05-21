<!--
Input: Alma data export/cloud sync evidence and Cradle import/export audit.
Output: Spec for backup, restore, and optional cloud sync.
Position: docs/specs/alma-inspired/backup-cloud-sync.md
-->

# Backup 与 Cloud Sync

## 目标

Cradle 需要先定义 owner-aware backup/restore boundary，再考虑 whole-product cloud sync。Backup orchestrator 只能调用各 namespace 提供的 serializer 和 restore adapter，不能直接写入其他 owner 的 tables。

## Alma 证据

Alma data settings 支持按类别 export/import：settings、providers、threads、promptApps、prompts、workspaces、mcpServers、customThemes 和 memories。它还有 experimental cloud sync state、启停和 push snapshot。

## Cradle 当前状态

Cradle 有 DB state、skills import/export、workspace file data 和部分 module-specific exports。当前没有 whole-product backup，也没有按 namespace 协作的 restore boundary 或 cloud sync policy。

## Owner / Namespace

未来 `backup` 模块负责 archive manifest、export orchestration、restore plan 和 validation report。每个 capability owner 贡献 serializers、validators 和 restore policies。`backup` 不拥有 provider、session、workspace、skills、plugin 或 memory 的语义。

## 目标行为

- 用户可以选择 categories 导出 versioned archive。
- Restore 在写入前检查 schema version、owner compatibility、conflicts、secrets 和 workspace paths。
- Secrets 默认不以明文导出；restore 后需要 explicit rehydration policy。
- Cloud sync 暂缓，直到 local backup semantics 稳定并可验证。

## API 草案

- `GET /backup/categories`
- `POST /backup/export`
- `POST /backup/inspect`
- `POST /backup/restore`

## 数据模型

Backup archive 包含 manifest、schema version、category payloads、checksums、redaction metadata、owner version map 和 restore compatibility report。Archive 内的每个 category payload 由对应 owner 生成。

## 验收

- Restore providers without secrets 会创建 disabled profiles，并解释缺失 credentials。
- Partial restore 可以只恢复 skills、sessions 或 preferences。
- Backup validation 如果发现任何 selected category incompatible，必须在 DB mutation 前失败。
- Cloud sync 不得绕过 local restore validation。
