//! Semantic and keyword search over Chronicle memory.

use crate::crystallizer::MemoryChunk;
use crate::embedding::{Embedding, EmbeddingProvider, cosine_similarity};
use crate::time::Timestamp;

/// A search result with relevance score.
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub chunk_id: String,
    pub content: String,
    pub summary: String,
    pub score: f64,
    pub match_type: MatchType,
    pub timestamp: Timestamp,
    pub tags: Vec<String>,
}

/// How the result was matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchType {
    /// Embedding similarity match.
    Semantic,
    /// Text keyword match.
    Keyword,
    /// Both semantic and keyword matched.
    Combined,
}

/// Search configuration.
#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub semantic_weight: f64,
    pub keyword_weight: f64,
    pub min_score: f64,
    pub max_results: usize,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            semantic_weight: 0.7,
            keyword_weight: 0.3,
            min_score: 0.1,
            max_results: 20,
        }
    }
}

/// In-memory search index over memory chunks.
pub struct SearchIndex {
    config: SearchConfig,
    chunks: Vec<IndexedChunk>,
}

/// Internal indexed representation.
struct IndexedChunk {
    id: String,
    content: String,
    summary: String,
    tokens: Vec<String>,
    embedding: Option<Embedding>,
    timestamp: Timestamp,
    tags: Vec<String>,
}

// ─── Stop words ──────────────────────────────────────────────────────────────

const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can", "to",
    "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither",
    "each", "every", "all", "any", "few", "more", "most", "other", "some", "such", "no", "only",
    "own", "same", "than", "too", "very", "just", "because", "if", "then", "else", "when", "up",
    "out", "about", "it", "its", "this", "that", "these", "those", "i", "me", "my", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "they", "them", "their", "what", "which",
    "who", "whom", "how", "where", "why",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Tokenize text into lowercase word tokens, filtering stop words.
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .filter(|s| s.len() > 1 && !STOP_WORDS.contains(&s.as_str()))
        .collect()
}

/// Compute keyword relevance score using Jaccard-like overlap.
fn keyword_score(query_tokens: &[String], doc_tokens: &[String]) -> f64 {
    if query_tokens.is_empty() || doc_tokens.is_empty() {
        return 0.0;
    }

    let matches = query_tokens
        .iter()
        .filter(|qt| doc_tokens.contains(qt))
        .count();

    if matches == 0 {
        return 0.0;
    }

    // Jaccard-like: matches / query_len, weighted by doc coverage
    let query_coverage = matches as f64 / query_tokens.len() as f64;
    let doc_coverage = matches as f64 / doc_tokens.len().min(query_tokens.len() * 5) as f64;

    // Blend query coverage (more important) with doc density
    0.7 * query_coverage + 0.3 * doc_coverage
}

// ─── SearchIndex ─────────────────────────────────────────────────────────────

impl SearchIndex {
    /// Create a new search index with the given config.
    pub fn new(config: SearchConfig) -> Self {
        Self {
            config,
            chunks: Vec::new(),
        }
    }

    /// Create a search index with default configuration.
    pub fn with_default_config() -> Self {
        Self::new(SearchConfig::default())
    }

    /// Add multiple chunks to the index.
    pub fn index_chunks(&mut self, chunks: &[MemoryChunk]) {
        for chunk in chunks {
            self.add_chunk(chunk);
        }
    }

    /// Add a single chunk to the index.
    pub fn add_chunk(&mut self, chunk: &MemoryChunk) {
        let combined_text = format!("{} {}", chunk.content, chunk.summary);
        let tokens = tokenize(&combined_text);
        self.chunks.push(IndexedChunk {
            id: chunk.id.clone(),
            content: chunk.content.clone(),
            summary: chunk.summary.clone(),
            tokens,
            embedding: chunk.embedding.clone(),
            timestamp: chunk.timestamp,
            tags: chunk.tags.clone(),
        });
    }

    /// Remove a chunk by id. Returns true if found and removed.
    pub fn remove_chunk(&mut self, id: &str) -> bool {
        let before = self.chunks.len();
        self.chunks.retain(|c| c.id != id);
        self.chunks.len() < before
    }

    /// Number of indexed chunks.
    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Combined semantic + keyword search.
    pub fn search(&self, query: &str, query_embedding: Option<&Embedding>) -> Vec<SearchResult> {
        let query_tokens = tokenize(query);

        if query_tokens.is_empty() && query_embedding.is_none() {
            return Vec::new();
        }

        let mut results: Vec<SearchResult> = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                let kw_score = if !query_tokens.is_empty() {
                    keyword_score(&query_tokens, &chunk.tokens)
                } else {
                    0.0
                };

                let sem_score = match (query_embedding, &chunk.embedding) {
                    (Some(qe), Some(ce)) => {
                        let sim = cosine_similarity(qe, ce);
                        // Normalize from [-1,1] to [0,1]
                        (sim + 1.0) / 2.0
                    }
                    _ => 0.0,
                };

                let has_keyword = kw_score > 0.0;
                let has_semantic = sem_score > 0.5; // above neutral

                let score = if query_embedding.is_some() && !query_tokens.is_empty() {
                    self.config.semantic_weight * sem_score + self.config.keyword_weight * kw_score
                } else if query_embedding.is_some() {
                    sem_score
                } else {
                    kw_score
                };

                if score < self.config.min_score {
                    return None;
                }

                let match_type = match (has_keyword, has_semantic) {
                    (true, true) => MatchType::Combined,
                    (false, true) => MatchType::Semantic,
                    (true, false) => MatchType::Keyword,
                    (false, false) => MatchType::Keyword, // score passed min, treat as keyword
                };

                Some(SearchResult {
                    chunk_id: chunk.id.clone(),
                    content: chunk.content.clone(),
                    summary: chunk.summary.clone(),
                    score,
                    match_type,
                    timestamp: chunk.timestamp,
                    tags: chunk.tags.clone(),
                })
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(self.config.max_results);
        results
    }

    /// Pure keyword search using token overlap.
    pub fn keyword_search(&self, query: &str) -> Vec<SearchResult> {
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() {
            return Vec::new();
        }

        let mut results: Vec<SearchResult> = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                let score = keyword_score(&query_tokens, &chunk.tokens);
                if score < self.config.min_score {
                    return None;
                }
                Some(SearchResult {
                    chunk_id: chunk.id.clone(),
                    content: chunk.content.clone(),
                    summary: chunk.summary.clone(),
                    score,
                    match_type: MatchType::Keyword,
                    timestamp: chunk.timestamp,
                    tags: chunk.tags.clone(),
                })
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(self.config.max_results);
        results
    }

    /// Pure embedding similarity search.
    pub fn semantic_search(&self, query_embedding: &Embedding) -> Vec<SearchResult> {
        let mut results: Vec<SearchResult> = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                let embedding = chunk.embedding.as_ref()?;
                let sim = cosine_similarity(query_embedding, embedding);
                let score = (sim + 1.0) / 2.0; // normalize to [0,1]

                if score < self.config.min_score {
                    return None;
                }
                Some(SearchResult {
                    chunk_id: chunk.id.clone(),
                    content: chunk.content.clone(),
                    summary: chunk.summary.clone(),
                    score,
                    match_type: MatchType::Semantic,
                    timestamp: chunk.timestamp,
                    tags: chunk.tags.clone(),
                })
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(self.config.max_results);
        results
    }

    /// Find chunks that have any of the given tags.
    pub fn search_by_tags(&self, tags: &[&str]) -> Vec<SearchResult> {
        let mut results: Vec<SearchResult> = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                let matching = chunk
                    .tags
                    .iter()
                    .filter(|t| tags.contains(&t.as_str()))
                    .count();
                if matching == 0 {
                    return None;
                }
                let score = matching as f64 / tags.len().max(1) as f64;
                Some(SearchResult {
                    chunk_id: chunk.id.clone(),
                    content: chunk.content.clone(),
                    summary: chunk.summary.clone(),
                    score,
                    match_type: MatchType::Keyword,
                    timestamp: chunk.timestamp,
                    tags: chunk.tags.clone(),
                })
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(self.config.max_results);
        results
    }

    /// Find chunks within a time range (inclusive).
    pub fn search_by_time_range(&self, start: Timestamp, end: Timestamp) -> Vec<SearchResult> {
        let mut results: Vec<SearchResult> = self
            .chunks
            .iter()
            .filter(|chunk| chunk.timestamp >= start && chunk.timestamp <= end)
            .map(|chunk| {
                // Score by recency within the range
                let range = end.seconds_since_epoch() - start.seconds_since_epoch();
                let offset = chunk.timestamp.seconds_since_epoch() - start.seconds_since_epoch();
                let score = if range > 0 {
                    offset as f64 / range as f64
                } else {
                    1.0
                };
                SearchResult {
                    chunk_id: chunk.id.clone(),
                    content: chunk.content.clone(),
                    summary: chunk.summary.clone(),
                    score,
                    match_type: MatchType::Keyword,
                    timestamp: chunk.timestamp,
                    tags: chunk.tags.clone(),
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(self.config.max_results);
        results
    }
}

/// Quick search with default config and a provided embedding provider.
pub fn quick_search(
    chunks: &[MemoryChunk],
    query: &str,
    embedding_provider: &dyn EmbeddingProvider,
) -> Vec<SearchResult> {
    let mut index = SearchIndex::with_default_config();
    index.index_chunks(chunks);
    let query_embedding = embedding_provider.embed(query).ok();
    index.search(query, query_embedding.as_ref())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dedup::DedupVerdict;
    use crate::embedding::HashEmbeddingProvider;
    use crate::triage::TriageCategory;

    fn make_chunk(id: &str, content: &str, tags: &[&str], ts: u64) -> MemoryChunk {
        let provider = HashEmbeddingProvider::default();
        let embedding = provider.embed(content).ok();
        MemoryChunk {
            id: id.to_string(),
            content: content.to_string(),
            summary: format!("Summary of {}", id),
            source_segment_id: 1,
            source_type: "test".to_string(),
            category: TriageCategory::Coding,
            tags: tags.iter().map(|s| s.to_string()).collect(),
            knowledge_cards: vec![],
            embedding,
            timestamp: Timestamp::from_seconds(ts),
            dedup_verdict: DedupVerdict::New,
        }
    }

    #[test]
    fn keyword_search_finds_matching_content() {
        let chunks = vec![
            make_chunk("1", "rust programming language", &["rust"], 100),
            make_chunk("2", "python data science", &["python"], 200),
            make_chunk("3", "rust web framework actix", &["rust", "web"], 300),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let results = index.keyword_search("rust programming");
        assert!(!results.is_empty());
        assert_eq!(results[0].chunk_id, "1");
    }

    #[test]
    fn semantic_search_finds_similar_embeddings() {
        let provider = HashEmbeddingProvider::default();
        let chunks = vec![
            make_chunk("1", "machine learning neural networks", &[], 100),
            make_chunk("2", "cooking recipes pasta", &[], 200),
            make_chunk("3", "deep learning artificial intelligence", &[], 300),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let query_emb = provider.embed("machine learning AI").unwrap();
        let results = index.semantic_search(&query_emb);
        assert!(!results.is_empty());
        // The ML-related chunks should score higher than cooking
        let ml_scores: Vec<f64> = results
            .iter()
            .filter(|r| r.chunk_id == "1" || r.chunk_id == "3")
            .map(|r| r.score)
            .collect();
        let cooking_score = results
            .iter()
            .find(|r| r.chunk_id == "2")
            .map(|r| r.score)
            .unwrap_or(0.0);
        assert!(ml_scores.iter().any(|s| *s > cooking_score));
    }

    #[test]
    fn combined_search_ranks_results_correctly() {
        let provider = HashEmbeddingProvider::default();
        let chunks = vec![
            make_chunk("1", "rust systems programming", &["rust"], 100),
            make_chunk("2", "javascript web development", &["js"], 200),
            make_chunk("3", "rust async runtime tokio", &["rust", "async"], 300),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let query_emb = provider.embed("rust programming").unwrap();
        let results = index.search("rust programming", Some(&query_emb));
        assert!(!results.is_empty());
        // Rust-related chunks should be at the top
        assert!(results[0].chunk_id == "1" || results[0].chunk_id == "3");
    }

    #[test]
    fn search_by_tags_works() {
        let chunks = vec![
            make_chunk("1", "first chunk", &["rust", "web"], 100),
            make_chunk("2", "second chunk", &["python"], 200),
            make_chunk("3", "third chunk", &["rust", "cli"], 300),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let results = index.search_by_tags(&["rust"]);
        assert_eq!(results.len(), 2);
        let ids: Vec<&str> = results.iter().map(|r| r.chunk_id.as_str()).collect();
        assert!(ids.contains(&"1"));
        assert!(ids.contains(&"3"));
    }

    #[test]
    fn search_by_time_range_works() {
        let chunks = vec![
            make_chunk("1", "old chunk", &[], 100),
            make_chunk("2", "middle chunk", &[], 500),
            make_chunk("3", "recent chunk", &[], 900),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let results =
            index.search_by_time_range(Timestamp::from_seconds(400), Timestamp::from_seconds(600));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].chunk_id, "2");
    }

    #[test]
    fn empty_query_returns_empty_results() {
        let chunks = vec![make_chunk("1", "some content", &[], 100)];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);

        let results = index.search("", None);
        assert!(results.is_empty());

        let results = index.keyword_search("");
        assert!(results.is_empty());
    }

    #[test]
    fn tokenize_produces_lowercase_tokens() {
        let tokens = tokenize("Hello World Rust Programming");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"rust".to_string()));
        assert!(tokens.contains(&"programming".to_string()));
        // All lowercase
        for token in &tokens {
            assert_eq!(token, &token.to_lowercase());
        }
    }

    #[test]
    fn remove_chunk_works() {
        let chunks = vec![
            make_chunk("1", "first", &[], 100),
            make_chunk("2", "second", &[], 200),
        ];

        let mut index = SearchIndex::with_default_config();
        index.index_chunks(&chunks);
        assert_eq!(index.chunk_count(), 2);

        assert!(index.remove_chunk("1"));
        assert_eq!(index.chunk_count(), 1);

        assert!(!index.remove_chunk("nonexistent"));
        assert_eq!(index.chunk_count(), 1);
    }

    #[test]
    fn quick_search_works() {
        let provider = HashEmbeddingProvider::default();
        let chunks = vec![
            make_chunk("1", "rust programming language", &["rust"], 100),
            make_chunk("2", "cooking italian food", &["food"], 200),
        ];

        let results = quick_search(&chunks, "rust programming", &provider);
        assert!(!results.is_empty());
        assert_eq!(results[0].chunk_id, "1");
    }
}
