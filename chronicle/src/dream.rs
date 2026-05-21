//! Dream Engine — background maintenance on memory chunks.
//!
//! Performs three operations:
//! - **Archive**: remove chunks older than a configured threshold.
//! - **Merge**: cluster similar chunks and combine them.
//! - **Prune**: remove short or empty content.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::crystallizer::{KnowledgeCard, MemoryChunk};
use crate::dedup::DedupVerdict;
use crate::embedding::cosine_similarity;
use crate::time::Timestamp;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DreamMode {
    Archive,
    Merge,
    Prune,
    DryRun,
}

#[derive(Debug, Clone)]
pub struct DreamConfig {
    /// Days after which a chunk is archived (default 30).
    pub archive_after_days: u64,
    /// Cosine similarity threshold for merging (default 0.85).
    pub merge_similarity_threshold: f64,
    /// Minimum content length; shorter chunks are pruned (default 10).
    pub prune_min_content_length: usize,
    /// Maximum chunks in a single merge cluster (default 5).
    pub max_merge_cluster_size: usize,
}

impl Default for DreamConfig {
    fn default() -> Self {
        Self {
            archive_after_days: 30,
            merge_similarity_threshold: 0.85,
            prune_min_content_length: 10,
            max_merge_cluster_size: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamRunReport {
    pub mode: DreamMode,
    pub input_chunks: usize,
    pub archived_count: usize,
    pub merged_count: usize,
    pub pruned_count: usize,
    pub dry_run: bool,
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/// In-memory store of memory chunks the Dream Engine operates on.
pub struct DreamEngine {
    config: DreamConfig,
    chunks: Vec<MemoryChunk>,
}

impl DreamEngine {
    pub fn new(config: DreamConfig) -> Self {
        Self {
            config,
            chunks: Vec::new(),
        }
    }

    pub fn load_chunks(&mut self, chunks: Vec<MemoryChunk>) {
        self.chunks = chunks;
    }

    pub fn chunks(&self) -> &[MemoryChunk] {
        &self.chunks
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Consume the engine and return the remaining chunks.
    pub fn take_chunks(self) -> Vec<MemoryChunk> {
        self.chunks
    }

    /// Dispatch to the appropriate operation.
    pub fn run(&mut self, mode: DreamMode, now: Timestamp) -> DreamRunReport {
        match mode {
            DreamMode::Archive => self.run_archive(now),
            DreamMode::Merge => self.run_merge(),
            DreamMode::Prune => self.run_prune(),
            DreamMode::DryRun => self.run_dry(now),
        }
    }

    /// Archive chunks older than `archive_after_days`.
    pub fn run_archive(&mut self, now: Timestamp) -> DreamRunReport {
        let input_chunks = self.chunks.len();
        let cutoff = now
            .seconds_since_epoch()
            .saturating_sub(self.config.archive_after_days * 86400);

        let before = self.chunks.len();
        self.chunks
            .retain(|c| c.timestamp.seconds_since_epoch() > cutoff);
        let archived_count = before - self.chunks.len();

        DreamRunReport {
            mode: DreamMode::Archive,
            input_chunks,
            archived_count,
            merged_count: 0,
            pruned_count: 0,
            dry_run: false,
        }
    }

    /// Merge clusters of similar chunks.
    pub fn run_merge(&mut self) -> DreamRunReport {
        let input_chunks = self.chunks.len();
        let clusters = find_merge_clusters(
            &self.chunks,
            self.config.merge_similarity_threshold,
            self.config.max_merge_cluster_size,
        );

        if clusters.is_empty() {
            return DreamRunReport {
                mode: DreamMode::Merge,
                input_chunks,
                archived_count: 0,
                merged_count: 0,
                pruned_count: 0,
                dry_run: false,
            };
        }

        // Collect indices to remove (flattened, deduplicated).
        let mut remove_indices: HashSet<usize> = HashSet::new();
        let mut merged_chunks: Vec<MemoryChunk> = Vec::new();

        for cluster_indices in &clusters {
            for &idx in cluster_indices {
                remove_indices.insert(idx);
            }
            let cluster_chunks: Vec<MemoryChunk> = cluster_indices
                .iter()
                .map(|&i| self.chunks[i].clone())
                .collect();
            merged_chunks.push(merge_chunks(cluster_chunks));
        }

        let merged_count = remove_indices.len();

        // Remove originals in reverse order to preserve indices.
        let mut sorted_remove: Vec<usize> = remove_indices.into_iter().collect();
        sorted_remove.sort_unstable_by(|a, b| b.cmp(a));
        for idx in sorted_remove {
            self.chunks.remove(idx);
        }

        // Add merged chunks.
        self.chunks.extend(merged_chunks);

        DreamRunReport {
            mode: DreamMode::Merge,
            input_chunks,
            archived_count: 0,
            merged_count,
            pruned_count: 0,
            dry_run: false,
        }
    }

    /// Prune chunks with short or empty content.
    pub fn run_prune(&mut self) -> DreamRunReport {
        let input_chunks = self.chunks.len();
        let before = self.chunks.len();
        self.chunks.retain(|c| {
            !c.content.trim().is_empty() && c.content.len() >= self.config.prune_min_content_length
        });
        let pruned_count = before - self.chunks.len();

        DreamRunReport {
            mode: DreamMode::Prune,
            input_chunks,
            archived_count: 0,
            merged_count: 0,
            pruned_count,
            dry_run: false,
        }
    }

    /// Dry-run: compute what would happen without mutating.
    fn run_dry(&self, now: Timestamp) -> DreamRunReport {
        let input_chunks = self.chunks.len();

        // Archive count
        let cutoff = now
            .seconds_since_epoch()
            .saturating_sub(self.config.archive_after_days * 86400);
        let archived_count = self
            .chunks
            .iter()
            .filter(|c| c.timestamp.seconds_since_epoch() <= cutoff)
            .count();

        // Merge count
        let clusters = find_merge_clusters(
            &self.chunks,
            self.config.merge_similarity_threshold,
            self.config.max_merge_cluster_size,
        );
        let merged_count: usize = clusters.iter().map(|c| c.len()).sum();

        // Prune count
        let pruned_count = self
            .chunks
            .iter()
            .filter(|c| {
                c.content.trim().is_empty()
                    || c.content.len() < self.config.prune_min_content_length
            })
            .count();

        DreamRunReport {
            mode: DreamMode::DryRun,
            input_chunks,
            archived_count,
            merged_count,
            pruned_count,
            dry_run: true,
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Greedy clustering: assign each chunk to the first cluster where the average
/// similarity exceeds `threshold`. Only returns clusters with 2+ members.
fn find_merge_clusters(chunks: &[MemoryChunk], threshold: f64, max_size: usize) -> Vec<Vec<usize>> {
    let mut clusters: Vec<Vec<usize>> = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let embedding = match &chunk.embedding {
            Some(e) => e,
            None => continue,
        };

        let mut assigned = false;

        for cluster in clusters.iter_mut() {
            if cluster.len() >= max_size {
                continue;
            }

            // Compute average similarity to cluster members.
            let mut sim_sum = 0.0;
            let mut sim_count = 0usize;

            for &member_idx in cluster.iter() {
                if let Some(ref member_emb) = chunks[member_idx].embedding {
                    sim_sum += cosine_similarity(embedding, member_emb);
                    sim_count += 1;
                }
            }

            if sim_count > 0 && (sim_sum / sim_count as f64) > threshold {
                cluster.push(i);
                assigned = true;
                break;
            }
        }

        if !assigned {
            clusters.push(vec![i]);
        }
    }

    // Only return clusters with 2+ members.
    clusters.into_iter().filter(|c| c.len() >= 2).collect()
}

/// Merge a cluster of chunks into a single combined chunk.
fn merge_chunks(cluster: Vec<MemoryChunk>) -> MemoryChunk {
    assert!(!cluster.is_empty(), "cannot merge empty cluster");

    let id = format!("{}-merged", cluster[0].id);
    let summary = cluster[0].summary.clone();
    let source_segment_id = cluster[0].source_segment_id;
    let source_type = cluster[0].source_type.clone();
    let category = cluster[0].category;
    let dedup_verdict = DedupVerdict::New;

    // Concatenate content with separator.
    let content = cluster
        .iter()
        .map(|c| c.content.as_str())
        .collect::<Vec<_>>()
        .join("\n---\n");

    // Union of all tags.
    let mut tag_set: HashSet<String> = HashSet::new();
    for chunk in &cluster {
        for tag in &chunk.tags {
            tag_set.insert(tag.clone());
        }
    }
    let tags: Vec<String> = tag_set.into_iter().collect();

    // Keep highest confidence knowledge cards (take all, deduplicated by content).
    let mut knowledge_cards: Vec<KnowledgeCard> = Vec::new();
    let mut seen_content: HashSet<String> = HashSet::new();
    let mut all_cards: Vec<&KnowledgeCard> = cluster
        .iter()
        .flat_map(|c| c.knowledge_cards.iter())
        .collect();
    all_cards.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for card in all_cards {
        if seen_content.insert(card.content.clone()) {
            knowledge_cards.push(card.clone());
        }
    }

    // Most recent timestamp.
    let timestamp = cluster.iter().map(|c| c.timestamp).max().unwrap();

    // Average embedding if all have embeddings.
    let embedding = compute_merged_embedding(&cluster);

    MemoryChunk {
        id,
        content,
        summary,
        source_segment_id,
        source_type,
        category,
        tags,
        knowledge_cards,
        embedding,
        timestamp,
        dedup_verdict,
    }
}

/// Average the embeddings of a cluster (if all members have one).
fn compute_merged_embedding(cluster: &[MemoryChunk]) -> Option<crate::embedding::Embedding> {
    let embeddings: Vec<&crate::embedding::Embedding> = cluster
        .iter()
        .filter_map(|c| c.embedding.as_ref())
        .collect();

    if embeddings.len() != cluster.len() || embeddings.is_empty() {
        return None;
    }

    let dim = embeddings[0].dimensions;
    let mut avg = vec![0.0f32; dim];
    let count = embeddings.len() as f32;

    for emb in &embeddings {
        for (i, v) in emb.values.iter().enumerate() {
            avg[i] += v;
        }
    }
    for v in &mut avg {
        *v /= count;
    }

    Some(crate::embedding::Embedding::new(avg))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embedding::Embedding;
    use crate::triage::TriageCategory;

    fn make_chunk(id: &str, content: &str, timestamp_secs: u64) -> MemoryChunk {
        MemoryChunk {
            id: id.to_string(),
            content: content.to_string(),
            summary: format!("summary of {id}"),
            source_segment_id: 1,
            source_type: "test".to_string(),
            category: TriageCategory::Unknown,
            tags: vec![],
            knowledge_cards: vec![],
            embedding: None,
            timestamp: Timestamp::from_seconds(timestamp_secs),
            dedup_verdict: DedupVerdict::New,
        }
    }

    fn make_chunk_with_embedding(
        id: &str,
        content: &str,
        timestamp_secs: u64,
        values: Vec<f32>,
    ) -> MemoryChunk {
        let mut chunk = make_chunk(id, content, timestamp_secs);
        chunk.embedding = Some(Embedding::new(values));
        chunk
    }

    #[test]
    fn archive_removes_old_chunks() {
        let mut engine = DreamEngine::new(DreamConfig {
            archive_after_days: 7,
            ..Default::default()
        });

        let now = Timestamp::from_seconds(1_000_000);
        let old_time = 1_000_000 - (8 * 86400); // 8 days ago
        let recent_time = 1_000_000 - (3 * 86400); // 3 days ago

        engine.load_chunks(vec![
            make_chunk("old", "old content here!", old_time as u64),
            make_chunk("recent", "recent content here!", recent_time as u64),
        ]);

        let report = engine.run_archive(now);
        assert_eq!(report.archived_count, 1);
        assert_eq!(engine.chunk_count(), 1);
        assert_eq!(engine.chunks()[0].id, "recent");
    }

    #[test]
    fn archive_keeps_recent_chunks() {
        let mut engine = DreamEngine::new(DreamConfig {
            archive_after_days: 30,
            ..Default::default()
        });

        let now = Timestamp::from_seconds(1_000_000);
        let recent = 1_000_000 - (5 * 86400); // 5 days ago

        engine.load_chunks(vec![
            make_chunk("a", "content a is here!!", recent as u64),
            make_chunk("b", "content b is here!!", recent as u64),
        ]);

        let report = engine.run_archive(now);
        assert_eq!(report.archived_count, 0);
        assert_eq!(engine.chunk_count(), 2);
    }

    #[test]
    fn prune_removes_short_and_empty_content() {
        let mut engine = DreamEngine::new(DreamConfig {
            prune_min_content_length: 10,
            ..Default::default()
        });

        engine.load_chunks(vec![
            make_chunk("short", "hi", 1000),
            make_chunk("empty", "", 1000),
            make_chunk("spaces", "     ", 1000),
            make_chunk("ok", "this is long enough content", 1000),
        ]);

        let report = engine.run_prune();
        assert_eq!(report.pruned_count, 3);
        assert_eq!(engine.chunk_count(), 1);
        assert_eq!(engine.chunks()[0].id, "ok");
    }

    #[test]
    fn merge_clusters_similar_chunks() {
        let mut engine = DreamEngine::new(DreamConfig {
            merge_similarity_threshold: 0.9,
            max_merge_cluster_size: 5,
            ..Default::default()
        });

        // Two nearly identical embeddings (cosine similarity ≈ 1.0)
        let emb_a = vec![1.0, 0.0, 0.0];
        let emb_b = vec![0.99, 0.01, 0.0];
        // One different embedding
        let emb_c = vec![0.0, 0.0, 1.0];

        engine.load_chunks(vec![
            make_chunk_with_embedding("a", "content about rust programming", 1000, emb_a),
            make_chunk_with_embedding("b", "content about rust language", 2000, emb_b),
            make_chunk_with_embedding("c", "content about cooking food", 3000, emb_c),
        ]);

        let report = engine.run_merge();
        assert_eq!(report.merged_count, 2); // two chunks merged
        // Should have 2 chunks: one merged + one standalone
        assert_eq!(engine.chunk_count(), 2);

        let ids: Vec<&str> = engine.chunks().iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"c"));
        assert!(ids.iter().any(|id| id.contains("merged")));
    }

    #[test]
    fn dry_run_does_not_mutate() {
        let mut engine = DreamEngine::new(DreamConfig {
            archive_after_days: 7,
            prune_min_content_length: 10,
            ..Default::default()
        });

        let now = Timestamp::from_seconds(1_000_000);
        let old_time = 1_000_000 - (8 * 86400);

        engine.load_chunks(vec![
            make_chunk("old", "old content here!", old_time as u64),
            make_chunk("short", "hi", 1_000_000),
            make_chunk("ok", "this is perfectly fine content", 1_000_000),
        ]);

        let report = engine.run(DreamMode::DryRun, now);
        assert!(report.dry_run);
        assert_eq!(report.archived_count, 1);
        assert_eq!(report.pruned_count, 1);
        // Chunks unchanged
        assert_eq!(engine.chunk_count(), 3);
    }
}
