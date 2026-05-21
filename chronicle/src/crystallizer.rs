//! Memory Crystallizer — transforms triaged activity segments into structured
//! memory chunks via LLM calls to Cradle Server.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::dedup::{DedupEngine, DedupVerdict};
use crate::embedding::{Embedding, EmbeddingProvider};
use crate::error::{ChronicleError, ChronicleResult};
use crate::segmenter::ActivitySegment;
use crate::time::Timestamp;
use crate::triage::{TriageCategory, TriageResult};

const CRYSTALLIZE_TIMEOUT: Duration = Duration::from_secs(60);

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrystallizeRequest {
    pub segment_id: u64,
    pub category: String,
    pub front_app: Option<String>,
    pub title: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: u64,
    pub ocr_content: String,
    pub accessibility_content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrystallizeResponse {
    pub summary: String,
    pub knowledge_cards: Vec<KnowledgeCard>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCard {
    pub card_type: KnowledgeCardType,
    pub content: String,
    pub dimension: String,
    pub confidence: f64,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeCardType {
    Fact,
    Insight,
    Decision,
    Task,
    Pattern,
}

/// A crystallized memory chunk ready for storage.
#[derive(Debug, Clone)]
pub struct MemoryChunk {
    pub id: String,
    pub content: String,
    pub summary: String,
    pub source_segment_id: u64,
    pub source_type: String,
    pub category: TriageCategory,
    pub tags: Vec<String>,
    pub knowledge_cards: Vec<KnowledgeCard>,
    pub embedding: Option<Embedding>,
    pub timestamp: Timestamp,
    pub dedup_verdict: DedupVerdict,
}

// ─── Config ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct CrystallizerConfig {
    pub max_ocr_chars: usize,
    pub max_accessibility_chars: usize,
}

impl Default for CrystallizerConfig {
    fn default() -> Self {
        Self {
            max_ocr_chars: 4000,
            max_accessibility_chars: 2000,
        }
    }
}

// ─── Crystallizer ────────────────────────────────────────────────────────────

pub struct Crystallizer {
    base_url: String,
    config: CrystallizerConfig,
}

impl Crystallizer {
    pub fn new(base_url: impl Into<String>, config: CrystallizerConfig) -> Self {
        Self {
            base_url: base_url.into(),
            config,
        }
    }

    pub fn from_env() -> Self {
        let base_url = crate::cradle_client::cradle_base_url();
        Self::new(base_url, CrystallizerConfig::default())
    }

    /// Crystallize a segment into structured knowledge via Cradle Server LLM.
    /// Falls back to local summary if the server is unreachable.
    pub fn crystallize(
        &self,
        segment: &ActivitySegment,
        triage: &TriageResult,
    ) -> ChronicleResult<CrystallizeResponse> {
        let request = self.build_request(segment, triage);
        let url = format!("{}/chronicle/crystallize", self.base_url);

        let json_body = serde_json::to_string(&request).map_err(|e| {
            ChronicleError::Process(format!("failed to serialize crystallize request: {e}"))
        })?;

        let response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(CRYSTALLIZE_TIMEOUT))
            .build()
            .send(json_body.as_bytes());

        match response {
            Ok(mut resp) => {
                let body = resp.body_mut().read_to_string().map_err(|e| {
                    ChronicleError::Process(format!("failed to read crystallize response: {e}"))
                })?;
                serde_json::from_str(&body).map_err(|e| {
                    ChronicleError::Process(format!("failed to parse crystallize response: {e}"))
                })
            }
            Err(_) => Ok(build_local_summary(segment, triage)),
        }
    }

    /// Full pipeline: crystallize → embed → dedup → produce MemoryChunk.
    /// Returns `None` if dedup determines the content is a duplicate.
    pub fn crystallize_to_chunk(
        &self,
        segment: &ActivitySegment,
        triage: &TriageResult,
        embedding_provider: &dyn EmbeddingProvider,
        dedup: &mut DedupEngine,
    ) -> ChronicleResult<Option<MemoryChunk>> {
        let response = self.crystallize(segment, triage)?;
        let content = &response.summary;

        let embedding = embedding_provider.embed(content)?;
        let verdict = dedup.check(content, Some(&embedding), segment.start_time);

        match verdict {
            DedupVerdict::New => {}
            _ => return Ok(None),
        }

        let chunk_id = generate_chunk_id(segment);
        dedup.insert(
            chunk_id.clone(),
            content,
            Some(embedding.clone()),
            segment.start_time,
        );

        Ok(Some(MemoryChunk {
            id: chunk_id,
            content: content.clone(),
            summary: response.summary,
            source_segment_id: segment.id,
            source_type: format!("{:?}", segment.segment_type),
            category: triage.category,
            tags: response.tags,
            knowledge_cards: response.knowledge_cards,
            embedding: Some(embedding),
            timestamp: segment.start_time,
            dedup_verdict: verdict,
        }))
    }

    fn build_request(
        &self,
        segment: &ActivitySegment,
        triage: &TriageResult,
    ) -> CrystallizeRequest {
        let ocr_content = truncate_join(&segment.ocr_texts, self.config.max_ocr_chars);
        let accessibility_content =
            truncate_join(&segment.accessibility_texts, self.config.max_accessibility_chars);

        let duration_seconds =
            segment.end_time.seconds_since_epoch() - segment.start_time.seconds_since_epoch();

        CrystallizeRequest {
            segment_id: segment.id,
            category: format!("{:?}", triage.category),
            front_app: segment.front_app.clone(),
            title: segment.title.clone(),
            start_time: segment.start_time.compact(),
            end_time: segment.end_time.compact(),
            duration_seconds,
            ocr_content,
            accessibility_content,
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Fallback summary when Cradle Server is offline.
pub fn build_local_summary(segment: &ActivitySegment, triage: &TriageResult) -> CrystallizeResponse {
    let mut parts = Vec::new();

    if let Some(app) = &segment.front_app {
        parts.push(format!("[{app}]"));
    }
    if let Some(title) = &segment.title {
        parts.push(title.clone());
    }

    let ocr_summary = truncate_join(&segment.ocr_texts, 500);
    if !ocr_summary.is_empty() {
        parts.push(ocr_summary);
    }

    let acc_summary = truncate_join(&segment.accessibility_texts, 300);
    if !acc_summary.is_empty() {
        parts.push(acc_summary);
    }

    let summary = if parts.is_empty() {
        format!("Activity segment {} (no text captured)", segment.id)
    } else {
        parts.join(" — ")
    };

    let tag = format!("{:?}", triage.category).to_lowercase();

    CrystallizeResponse {
        summary,
        knowledge_cards: Vec::new(),
        tags: vec![tag],
    }
}

/// Generate a deterministic chunk ID from segment id + start timestamp.
pub fn generate_chunk_id(segment: &ActivitySegment) -> String {
    format!(
        "chunk-{}-{}",
        segment.id,
        segment.start_time.compact()
    )
}

/// Join strings with newlines, truncating to max total chars.
fn truncate_join(texts: &[String], max_chars: usize) -> String {
    let mut result = String::new();
    for text in texts {
        if result.len() + text.len() + 1 > max_chars {
            let remaining = max_chars.saturating_sub(result.len() + 1);
            if remaining > 0 {
                if !result.is_empty() {
                    result.push('\n');
                }
                result.push_str(&text[..text.floor_char_boundary(remaining)]);
            }
            break;
        }
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(text);
    }
    result
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segmenter::SegmentType;

    fn make_segment() -> ActivitySegment {
        ActivitySegment {
            id: 42,
            start_frame_index: 0,
            end_frame_index: 10,
            start_time: Timestamp::from_seconds(1700000000),
            end_time: Timestamp::from_seconds(1700000300),
            segment_type: SegmentType::Work,
            front_app: Some("VS Code".to_string()),
            title: Some("main.rs — chronicle".to_string()),
            frame_count: 10,
            ocr_texts: vec![
                "fn main() { println!(\"hello\"); }".to_string(),
                "// some comment".to_string(),
            ],
            accessibility_texts: vec!["Editor: main.rs".to_string()],
        }
    }

    fn make_triage() -> TriageResult {
        TriageResult {
            segment_id: 42,
            worth_keeping: true,
            confidence: 0.85,
            category: TriageCategory::Coding,
            reason: "active coding session".to_string(),
        }
    }

    #[test]
    fn test_build_local_summary_produces_valid_output() {
        let segment = make_segment();
        let triage = make_triage();
        let result = build_local_summary(&segment, &triage);

        assert!(!result.summary.is_empty());
        assert!(result.summary.contains("VS Code"));
        assert!(result.summary.contains("main.rs"));
        assert!(result.knowledge_cards.is_empty());
        assert_eq!(result.tags, vec!["coding"]);
    }

    #[test]
    fn test_build_local_summary_no_text() {
        let mut segment = make_segment();
        segment.front_app = None;
        segment.title = None;
        segment.ocr_texts.clear();
        segment.accessibility_texts.clear();

        let triage = make_triage();
        let result = build_local_summary(&segment, &triage);

        assert!(result.summary.contains("no text captured"));
    }

    #[test]
    fn test_generate_chunk_id_is_deterministic() {
        let segment = make_segment();
        let id1 = generate_chunk_id(&segment);
        let id2 = generate_chunk_id(&segment);
        assert_eq!(id1, id2);
        assert!(id1.starts_with("chunk-42-"));
    }

    #[test]
    fn test_crystallize_request_truncates_content() {
        let mut segment = make_segment();
        // Fill with long text exceeding default limits
        segment.ocr_texts = vec!["x".repeat(5000)];
        segment.accessibility_texts = vec!["y".repeat(3000)];

        let triage = make_triage();
        let config = CrystallizerConfig {
            max_ocr_chars: 100,
            max_accessibility_chars: 50,
        };
        let crystallizer = Crystallizer::new("http://localhost:0", config);
        let request = crystallizer.build_request(&segment, &triage);

        assert!(request.ocr_content.len() <= 100);
        assert!(request.accessibility_content.len() <= 50);
    }

    #[test]
    fn test_truncate_join_within_limit() {
        let texts = vec!["hello".to_string(), "world".to_string()];
        let result = truncate_join(&texts, 100);
        assert_eq!(result, "hello\nworld");
    }

    #[test]
    fn test_truncate_join_truncates() {
        let texts = vec!["abcdefghij".to_string(), "klmnopqrst".to_string()];
        let result = truncate_join(&texts, 15);
        // "abcdefghij\nklmn" = 15 chars
        assert!(result.len() <= 15);
        assert!(result.starts_with("abcdefghij"));
    }
}
