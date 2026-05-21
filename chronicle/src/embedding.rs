//! Text embedding generation and cosine similarity computation.
//!
//! Provides a trait-based abstraction for embedding backends:
//! - `HashEmbeddingProvider`: deterministic hash-based fallback for testing/offline
//! - `RemoteEmbeddingProvider`: delegates to Cradle Server via HTTP

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::error::{ChronicleError, ChronicleResult};

/// A fixed-size embedding vector.
#[derive(Debug, Clone, PartialEq)]
pub struct Embedding {
    pub dimensions: usize,
    pub values: Vec<f32>,
}

impl Embedding {
    /// Create a new embedding, verifying dimensions match.
    pub fn new(values: Vec<f32>) -> Self {
        let dimensions = values.len();
        Self { dimensions, values }
    }

    /// L2 norm of the vector.
    pub fn norm(&self) -> f64 {
        self.values
            .iter()
            .map(|v| (*v as f64) * (*v as f64))
            .sum::<f64>()
            .sqrt()
    }

    /// Normalize to unit vector in-place.
    pub fn normalize(&mut self) {
        let n = self.norm();
        if n > 0.0 {
            for v in &mut self.values {
                *v = (*v as f64 / n) as f32;
            }
        }
    }
}

/// Trait for pluggable embedding backends.
pub trait EmbeddingProvider {
    fn embed(&self, text: &str) -> ChronicleResult<Embedding>;
    fn embed_batch(&self, texts: &[&str]) -> ChronicleResult<Vec<Embedding>>;
    fn dimensions(&self) -> usize;
}

/// Cosine similarity between two embeddings.
///
/// Returns a value in [-1.0, 1.0]. Returns 0.0 if either vector has zero norm.
pub fn cosine_similarity(a: &Embedding, b: &Embedding) -> f64 {
    assert_eq!(
        a.dimensions, b.dimensions,
        "embeddings must have same dimensions"
    );

    let dot: f64 = a
        .values
        .iter()
        .zip(b.values.iter())
        .map(|(x, y)| (*x as f64) * (*y as f64))
        .sum();

    let norm_a = a.norm();
    let norm_b = b.norm();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

/// Hash-based embedding provider for offline/testing use.
///
/// Uses character trigram hashing to produce deterministic embeddings.
/// NOT suitable for production semantic search — only for dev/testing fallback.
pub struct HashEmbeddingProvider {
    dimensions: usize,
}

impl Default for HashEmbeddingProvider {
    fn default() -> Self {
        Self { dimensions: 128 }
    }
}

impl HashEmbeddingProvider {
    pub fn new(dimensions: usize) -> Self {
        Self { dimensions }
    }

    fn hash_text(&self, text: &str) -> Embedding {
        let mut buckets = vec![0.0f32; self.dimensions];
        let chars: Vec<char> = text.to_lowercase().chars().collect();

        if chars.len() < 3 {
            // For very short text, hash the whole thing
            let mut hasher = DefaultHasher::new();
            text.hash(&mut hasher);
            let h = hasher.finish();
            buckets[(h as usize) % self.dimensions] = 1.0;
        } else {
            // Character trigram hashing
            for window in chars.windows(3) {
                let trigram: String = window.iter().collect();
                let mut hasher = DefaultHasher::new();
                trigram.hash(&mut hasher);
                let h = hasher.finish();
                let idx = (h as usize) % self.dimensions;
                // Use upper bits for sign
                let sign = if (h >> 32) & 1 == 0 { 1.0 } else { -1.0 };
                buckets[idx] += sign;
            }
        }

        // Normalize to unit vector
        let norm: f64 = buckets
            .iter()
            .map(|v| (*v as f64).powi(2))
            .sum::<f64>()
            .sqrt();
        if norm > 0.0 {
            for v in &mut buckets {
                *v = (*v as f64 / norm) as f32;
            }
        }

        Embedding {
            dimensions: self.dimensions,
            values: buckets,
        }
    }
}

impl EmbeddingProvider for HashEmbeddingProvider {
    fn embed(&self, text: &str) -> ChronicleResult<Embedding> {
        Ok(self.hash_text(text))
    }

    fn embed_batch(&self, texts: &[&str]) -> ChronicleResult<Vec<Embedding>> {
        Ok(texts.iter().map(|t| self.hash_text(t)).collect())
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }
}

/// HTTP-based embedding provider that delegates to Cradle Server.
///
/// Calls `POST {base_url}/chronicle/embeddings` with a JSON body.
pub struct RemoteEmbeddingProvider {
    base_url: String,
    dimensions: usize,
}

impl RemoteEmbeddingProvider {
    const DEFAULT_DIMENSIONS: usize = 768;

    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            dimensions: Self::DEFAULT_DIMENSIONS,
        }
    }

    pub fn with_dimensions(mut self, dimensions: usize) -> Self {
        self.dimensions = dimensions;
        self
    }
}

impl EmbeddingProvider for RemoteEmbeddingProvider {
    fn embed(&self, text: &str) -> ChronicleResult<Embedding> {
        let mut results = self.embed_batch(&[text])?;
        results
            .pop()
            .ok_or_else(|| ChronicleError::Process("empty embedding response".into()))
    }

    fn embed_batch(&self, texts: &[&str]) -> ChronicleResult<Vec<Embedding>> {
        let url = format!("{}/chronicle/embeddings", self.base_url);
        let body = serde_json::json!({ "texts": texts });
        let json_body = serde_json::to_string(&body)
            .map_err(|e| ChronicleError::Process(format!("failed to serialize request: {e}")))?;

        let mut response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .send(json_body.as_bytes())
            .map_err(|e| ChronicleError::Process(format!("embedding request failed: {e}")))?;

        let response_body = response.body_mut().read_to_string().map_err(|e| {
            ChronicleError::Process(format!("failed to read embedding response: {e}"))
        })?;

        let resp: EmbeddingResponse = serde_json::from_str(&response_body).map_err(|e| {
            ChronicleError::Process(format!("failed to parse embedding response: {e}"))
        })?;

        let embeddings = resp
            .embeddings
            .into_iter()
            .map(|values| {
                let dimensions = values.len();
                Embedding { dimensions, values }
            })
            .collect();

        Ok(embeddings)
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }
}

#[derive(serde::Deserialize)]
struct EmbeddingResponse {
    embeddings: Vec<Vec<f32>>,
}

/// ONNX-based embedding provider using local all-MiniLM-L6-v2 model.
///
/// Wraps [`crate::onnx::embedding::OnnxEmbeddingModel`] with the `EmbeddingProvider` trait.
/// Uses `RefCell` for interior mutability since the ONNX session requires `&mut self`.
pub struct OnnxEmbeddingProvider {
    model: std::cell::RefCell<crate::onnx::embedding::OnnxEmbeddingModel>,
}

impl OnnxEmbeddingProvider {
    pub fn new(model: crate::onnx::embedding::OnnxEmbeddingModel) -> Self {
        Self {
            model: std::cell::RefCell::new(model),
        }
    }
}

impl EmbeddingProvider for OnnxEmbeddingProvider {
    fn embed(&self, text: &str) -> ChronicleResult<Embedding> {
        let values = self.model.borrow_mut().embed(text)?;
        Ok(Embedding::new(values))
    }

    fn embed_batch(&self, texts: &[&str]) -> ChronicleResult<Vec<Embedding>> {
        let batch = self.model.borrow_mut().embed_batch(texts)?;
        Ok(batch.into_iter().map(Embedding::new).collect())
    }

    fn dimensions(&self) -> usize {
        self.model.borrow().dim()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_identical_vectors() {
        let e = Embedding::new(vec![1.0, 2.0, 3.0]);
        let sim = cosine_similarity(&e, &e);
        assert!((sim - 1.0).abs() < 1e-6, "expected ~1.0, got {sim}");
    }

    #[test]
    fn cosine_similarity_orthogonal_vectors() {
        let a = Embedding::new(vec![1.0, 0.0, 0.0]);
        let b = Embedding::new(vec![0.0, 1.0, 0.0]);
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6, "expected ~0.0, got {sim}");
    }

    #[test]
    fn cosine_similarity_opposite_vectors() {
        let a = Embedding::new(vec![1.0, 0.0]);
        let b = Embedding::new(vec![-1.0, 0.0]);
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-6, "expected ~-1.0, got {sim}");
    }

    #[test]
    fn hash_provider_deterministic() {
        let provider = HashEmbeddingProvider::default();
        let e1 = provider.embed("hello world").unwrap();
        let e2 = provider.embed("hello world").unwrap();
        assert_eq!(e1, e2);
    }

    #[test]
    fn hash_provider_different_texts_differ() {
        let provider = HashEmbeddingProvider::default();
        let e1 = provider.embed("hello world").unwrap();
        let e2 = provider.embed("goodbye world").unwrap();
        assert_ne!(e1, e2);
    }

    #[test]
    fn hash_provider_produces_unit_vectors() {
        let provider = HashEmbeddingProvider::default();
        let e = provider
            .embed("some longer text for testing normalization")
            .unwrap();
        let norm = e.norm();
        assert!(
            (norm - 1.0).abs() < 1e-5,
            "expected unit vector (norm=1.0), got {norm}"
        );
    }

    #[test]
    fn hash_provider_correct_dimensions() {
        let provider = HashEmbeddingProvider::new(256);
        let e = provider.embed("test").unwrap();
        assert_eq!(e.dimensions, 256);
        assert_eq!(e.values.len(), 256);
    }

    #[test]
    fn embedding_normalize() {
        let mut e = Embedding::new(vec![3.0, 4.0]);
        e.normalize();
        assert!((e.norm() - 1.0).abs() < 1e-6);
        assert!((e.values[0] - 0.6).abs() < 1e-5);
        assert!((e.values[1] - 0.8).abs() < 1e-5);
    }

    #[test]
    fn embed_batch_consistency() {
        let provider = HashEmbeddingProvider::default();
        let texts = &["alpha", "beta", "gamma"];
        let batch = provider.embed_batch(texts).unwrap();
        for (i, text) in texts.iter().enumerate() {
            let single = provider.embed(text).unwrap();
            assert_eq!(batch[i], single);
        }
    }
}
