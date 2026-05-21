<!--
Input: Alma sqlite-vec/Transformers evidence and Cradle Chronicle memory audit.
Output: Spec for vector memory and local embeddings.
Position: docs/specs/alma-inspired/memory-vector-embeddings.md
-->

# Vector Memory And Local Embeddings

## Goal

Cradle should turn Chronicle memory search into a measurable local semantic memory system with explicit embedding model lifecycle and vector index diagnostics.

## Alma Evidence

Alma uses `@huggingface/transformers`, `sqlite-vec`, memory embedding tables, embedding model download/status/rebuild, similarity threshold settings, and semantic search.

## Cradle Current State

Chronicle has memory storage, memory search UI, model resource categories including `embedding`, and screen OCR memory pipeline. No concrete local embedding runtime or vector index implementation was found.

## Target Ownership

`chronicle` owns local model resources, embedding generation, vector index storage, rebuild jobs, and semantic memory APIs. Provider profiles may be used only for remote summary generation.

## Target Behavior

- Users can select and download a local embedding model.
- Chronicle can build, rebuild, and inspect vector indexes.
- Memory search can report whether it used lexical, semantic, or hybrid retrieval.
- Index health and model status are visible in Settings.

## API Sketch

- `GET /chronicle/model-resources`
- `POST /chronicle/embeddings/models/:id/download`
- `POST /chronicle/embeddings/rebuild`
- `GET /chronicle/embeddings/status`
- `GET /chronicle/memories/search?mode=semantic`

## Data Model

Add vector index tables or sqlite-vec virtual tables under Chronicle-owned migrations. Store embedding model id, vector dimension, source memory id, and index version.

## Acceptance

- Rebuilding the index is resumable and reports progress.
- Semantic search returns provenance and score.
- Changing embedding model invalidates or version-bumps existing vectors.
