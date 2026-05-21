<!--
Input: Alma sqlite-vec/Transformers evidence and Cradle Chronicle memory audit.
Output: Spec for vector memory and local embeddings.
Position: docs/specs/alma-inspired/memory-vector-embeddings.md
-->

# Vector Memory 与 Local Embeddings

## 目标

Cradle 需要把 Chronicle memory search 演进成可度量的本地 semantic memory system，包含明确的 embedding model lifecycle 和 vector index diagnostics。

## Alma 证据

Alma 使用 `@huggingface/transformers`、`sqlite-vec`、memory embedding tables、embedding model download/status/rebuild、similarity threshold settings 和 semantic search。

## Cradle 当前状态

Chronicle 有 memory storage、memory search UI、包含 `embedding` 的 model resource categories，以及 screen OCR memory pipeline。但未发现具体 local embedding runtime 或 vector index implementation。

## Owner / Namespace

`chronicle` 拥有 local model resources、embedding generation、vector index storage、rebuild jobs、semantic memory APIs。Provider profiles 只能用于 remote summary generation，不拥有本地模型生命周期。

## 目标行为

- 用户可以选择并下载 local embedding model。
- Chronicle 可以 build、rebuild、inspect vector indexes。
- Memory search 可以说明使用 lexical、semantic 还是 hybrid retrieval。
- Index health 和 model status 在 Settings 中可见。

## API 草案

- `GET /chronicle/model-resources`
- `POST /chronicle/embeddings/models/:id/download`
- `POST /chronicle/embeddings/rebuild`
- `GET /chronicle/embeddings/status`
- `GET /chronicle/memories/search?mode=semantic`

## 数据模型

在 Chronicle-owned migrations 中增加 vector index tables 或 sqlite-vec virtual tables。记录 embedding model id、vector dimension、source memory id、index version。

## 验收

- Rebuild index 可恢复，并报告 progress。
- Semantic search 返回 provenance 和 score。
- 切换 embedding model 会 invalidate 或 version-bump 旧 vectors。
