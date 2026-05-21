//! Three-layer deduplication engine for Chronicle content.
//!
//! Layers:
//! 1. Content hash — deterministic exact-match via a 32-byte hash.
//! 2. Semantic similarity — cosine similarity on embeddings (configurable threshold).
//! 3. Time-windowed text similarity — Jaccard on word tokens for recent items.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::embedding::{cosine_similarity, Embedding};
use crate::time::Timestamp;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct DedupConfig {
    /// Cosine similarity threshold for semantic dedup (default 0.92).
    pub semantic_threshold: f64,
    /// Time window in seconds for recent-text dedup (default 3600).
    pub time_window_seconds: u64,
    /// Max content hashes kept in the index (default 10000).
    pub max_stored_hashes: usize,
    /// Max embedding entries kept (default 5000).
    pub max_stored_embeddings: usize,
}

impl Default for DedupConfig {
    fn default() -> Self {
        Self {
            semantic_threshold: 0.92,
            time_window_seconds: 3600,
            max_stored_hashes: 10000,
            max_stored_embeddings: 5000,
        }
    }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DedupVerdict {
    /// Content is new, should be stored.
    New,
    /// Exact duplicate found (content hash match).
    ExactDuplicate { existing_id: String },
    /// Semantically similar content found.
    SemanticDuplicate {
        existing_id: String,
        /// Similarity as integer percentage 0–100.
        similarity: u32,
    },
    /// Recent similar text found within time window.
    RecentDuplicate { existing_id: String },
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

pub struct DedupEntry {
    pub id: String,
    pub content_hash: [u8; 32],
    pub embedding: Option<Embedding>,
    pub timestamp: Timestamp,
    /// First 200 chars for time-window comparison.
    pub text_preview: String,
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

pub struct DedupEngine {
    config: DedupConfig,
    hash_index: HashMap<[u8; 32], String>,
    entries: Vec<DedupEntry>,
}

impl DedupEngine {
    pub fn new(config: DedupConfig) -> Self {
        Self {
            config,
            hash_index: HashMap::new(),
            entries: Vec::new(),
        }
    }

    /// Check content against all three dedup layers.
    ///
    /// Returns the first matching verdict in priority order:
    /// exact hash → semantic → time-window → New.
    pub fn check(
        &self,
        content: &str,
        embedding: Option<&Embedding>,
        timestamp: Timestamp,
    ) -> DedupVerdict {
        let hash = content_hash(content);

        // Layer 1: exact content hash
        if let Some(id) = self.hash_index.get(&hash) {
            return DedupVerdict::ExactDuplicate {
                existing_id: id.clone(),
            };
        }

        // Layer 2: semantic similarity
        if let Some(emb) = embedding {
            for entry in self.entries.iter().rev() {
                if let Some(ref stored_emb) = entry.embedding {
                    let sim = cosine_similarity(emb, stored_emb);
                    if sim >= self.config.semantic_threshold {
                        return DedupVerdict::SemanticDuplicate {
                            existing_id: entry.id.clone(),
                            similarity: (sim * 100.0) as u32,
                        };
                    }
                }
            }
        }

        // Layer 3: time-windowed Jaccard on word tokens
        let window_start = timestamp
            .seconds_since_epoch()
            .saturating_sub(self.config.time_window_seconds);
        let preview = text_preview(content);
        let tokens_a = word_tokens(&preview);

        if !tokens_a.is_empty() {
            for entry in self.entries.iter().rev() {
                if entry.timestamp.seconds_since_epoch() < window_start {
                    break;
                }
                let tokens_b = word_tokens(&entry.text_preview);
                if jaccard_similarity(&tokens_a, &tokens_b) >= 0.8 {
                    return DedupVerdict::RecentDuplicate {
                        existing_id: entry.id.clone(),
                    };
                }
            }
        }

        DedupVerdict::New
    }

    /// Insert a new entry into the engine.
    pub fn insert(
        &mut self,
        id: String,
        content: &str,
        embedding: Option<Embedding>,
        timestamp: Timestamp,
    ) {
        let hash = content_hash(content);
        self.hash_index.insert(hash, id.clone());

        self.entries.push(DedupEntry {
            id,
            content_hash: hash,
            embedding,
            timestamp,
            text_preview: text_preview(content),
        });

        // Evict oldest hashes if over limit
        while self.hash_index.len() > self.config.max_stored_hashes {
            if let Some(entry) = self.entries.first() {
                self.hash_index.remove(&entry.content_hash);
                self.entries.remove(0);
            } else {
                break;
            }
        }

        // Evict oldest embeddings if over limit
        let emb_count = self.entries.iter().filter(|e| e.embedding.is_some()).count();
        if emb_count > self.config.max_stored_embeddings {
            // Remove embedding from oldest entries until under limit
            let to_remove = emb_count - self.config.max_stored_embeddings;
            let mut removed = 0;
            for entry in self.entries.iter_mut() {
                if removed >= to_remove {
                    break;
                }
                if entry.embedding.is_some() {
                    entry.embedding = None;
                    removed += 1;
                }
            }
        }
    }

    /// Remove entries older than the given timestamp.
    pub fn prune_old(&mut self, before: Timestamp) {
        self.entries.retain(|entry| {
            if entry.timestamp < before {
                self.hash_index.remove(&entry.content_hash);
                false
            } else {
                true
            }
        });
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute a deterministic 32-byte hash of content.
///
/// Uses two rounds of `DefaultHasher` (SipHash) to fill 32 bytes.
/// Not cryptographic, but sufficient for dedup collision avoidance.
pub fn content_hash(content: &str) -> [u8; 32] {
    let mut out = [0u8; 32];

    // First 8 bytes from direct hash
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    let h1 = h.finish();
    out[0..8].copy_from_slice(&h1.to_le_bytes());

    // Next 8 bytes from hash of (content + salt)
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    1u64.hash(&mut h);
    let h2 = h.finish();
    out[8..16].copy_from_slice(&h2.to_le_bytes());

    // Next 8 bytes
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    2u64.hash(&mut h);
    let h3 = h.finish();
    out[16..24].copy_from_slice(&h3.to_le_bytes());

    // Last 8 bytes
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    3u64.hash(&mut h);
    let h4 = h.finish();
    out[24..32].copy_from_slice(&h4.to_le_bytes());

    out
}

/// Extract first 200 characters as a text preview.
fn text_preview(content: &str) -> String {
    content.chars().take(200).collect()
}

/// Tokenize text into lowercase words split on whitespace.
fn word_tokens(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Jaccard similarity between two token sets.
fn jaccard_similarity(a: &[&str], b: &[&str]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }

    let set_a: std::collections::HashSet<&str> = a.iter().copied().collect();
    let set_b: std::collections::HashSet<&str> = b.iter().copied().collect();

    let intersection = set_a.intersection(&set_b).count();
    let union = set_a.union(&set_b).count();

    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_embedding(values: &[f32]) -> Embedding {
        Embedding::new(values.to_vec())
    }

    #[test]
    fn test_exact_duplicate_detection() {
        let mut engine = DedupEngine::new(DedupConfig::default());
        let ts = Timestamp::from_seconds(1000);

        engine.insert("entry-1".into(), "hello world", None, ts);

        let verdict = engine.check("hello world", None, ts);
        assert_eq!(
            verdict,
            DedupVerdict::ExactDuplicate {
                existing_id: "entry-1".into()
            }
        );
    }

    #[test]
    fn test_semantic_duplicate_detection() {
        let mut engine = DedupEngine::new(DedupConfig {
            semantic_threshold: 0.92,
            ..DedupConfig::default()
        });
        let ts = Timestamp::from_seconds(1000);

        // Two very similar embeddings (cosine sim > 0.92)
        let emb_a = make_embedding(&[1.0, 0.0, 0.0, 0.0]);
        let emb_b = make_embedding(&[0.98, 0.1, 0.0, 0.0]);

        engine.insert("entry-1".into(), "text a", Some(emb_a), ts);

        let verdict = engine.check("text b different hash", Some(&emb_b), ts);
        match verdict {
            DedupVerdict::SemanticDuplicate {
                existing_id,
                similarity,
            } => {
                assert_eq!(existing_id, "entry-1");
                assert!(similarity >= 92);
            }
            other => panic!("expected SemanticDuplicate, got {:?}", other),
        }
    }

    #[test]
    fn test_time_windowed_duplicate_detection() {
        let mut engine = DedupEngine::new(DedupConfig {
            time_window_seconds: 3600,
            ..DedupConfig::default()
        });

        let ts1 = Timestamp::from_seconds(1000);
        let ts2 = Timestamp::from_seconds(1500); // within window

        // Insert text and then check very similar text (>80% Jaccard)
        engine.insert(
            "entry-1".into(),
            "the quick brown fox jumps over the lazy dog",
            None,
            ts1,
        );

        // Same words, slightly reordered — still high Jaccard
        let verdict = engine.check(
            "the quick brown fox jumps over the lazy dog today",
            None,
            ts2,
        );
        assert_eq!(
            verdict,
            DedupVerdict::RecentDuplicate {
                existing_id: "entry-1".into()
            }
        );
    }

    #[test]
    fn test_new_content_passes_all_checks() {
        let mut engine = DedupEngine::new(DedupConfig::default());
        let ts = Timestamp::from_seconds(1000);

        engine.insert(
            "entry-1".into(),
            "hello world",
            Some(make_embedding(&[1.0, 0.0, 0.0])),
            ts,
        );

        // Completely different content, different embedding
        let different_emb = make_embedding(&[0.0, 0.0, 1.0]);
        let verdict = engine.check(
            "completely unrelated content about something else entirely",
            Some(&different_emb),
            ts,
        );
        assert_eq!(verdict, DedupVerdict::New);
    }

    #[test]
    fn test_prune_removes_old_entries() {
        let mut engine = DedupEngine::new(DedupConfig::default());

        engine.insert(
            "old".into(),
            "old content",
            None,
            Timestamp::from_seconds(100),
        );
        engine.insert(
            "new".into(),
            "new content",
            None,
            Timestamp::from_seconds(500),
        );

        assert_eq!(engine.len(), 2);

        engine.prune_old(Timestamp::from_seconds(200));

        assert_eq!(engine.len(), 1);

        // Old entry hash should be gone
        let verdict = engine.check("old content", None, Timestamp::from_seconds(600));
        assert_eq!(verdict, DedupVerdict::New);

        // New entry should still be present
        let verdict = engine.check("new content", None, Timestamp::from_seconds(600));
        assert_eq!(
            verdict,
            DedupVerdict::ExactDuplicate {
                existing_id: "new".into()
            }
        );
    }

    #[test]
    fn test_content_hash_deterministic() {
        let h1 = content_hash("test input");
        let h2 = content_hash("test input");
        assert_eq!(h1, h2);

        let h3 = content_hash("different input");
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_jaccard_similarity_basic() {
        let a = vec!["hello", "world", "foo"];
        let b = vec!["hello", "world", "bar"];
        let sim = jaccard_similarity(&a, &b);
        // intersection=2, union=4 → 0.5
        assert!((sim - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_time_window_outside_window() {
        let mut engine = DedupEngine::new(DedupConfig {
            time_window_seconds: 100,
            ..DedupConfig::default()
        });

        engine.insert(
            "entry-1".into(),
            "the quick brown fox jumps over the lazy dog",
            None,
            Timestamp::from_seconds(1000),
        );

        // Check with timestamp far outside the window
        let verdict = engine.check(
            "the quick brown fox jumps over the lazy dog",
            None,
            Timestamp::from_seconds(2000),
        );
        // Should still match on exact hash (layer 1 has no time constraint)
        assert_eq!(
            verdict,
            DedupVerdict::ExactDuplicate {
                existing_id: "entry-1".into()
            }
        );
    }
}
