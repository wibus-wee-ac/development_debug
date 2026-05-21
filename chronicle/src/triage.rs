//! Triage agent that classifies activity segments via LLM or local heuristics.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::segmenter::{ActivitySegment, SegmentType};

const TRIAGE_TIMEOUT: Duration = Duration::from_secs(30);
const OCR_SAMPLE_LIMIT: usize = 2000;
const ACCESSIBILITY_SAMPLE_LIMIT: usize = 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageRequest {
    pub segment_id: u64,
    pub front_app: Option<String>,
    pub title: Option<String>,
    pub duration_seconds: u64,
    pub frame_count: usize,
    pub ocr_sample: String,
    pub accessibility_sample: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageResult {
    pub segment_id: u64,
    pub worth_keeping: bool,
    pub confidence: f64,
    pub category: TriageCategory,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum TriageCategory {
    Meeting,
    Coding,
    Research,
    Communication,
    Browsing,
    Entertainment,
    Noise,
    #[default]
    Unknown,
}


// ─── Agent ───────────────────────────────────────────────────────────────────

pub struct TriageAgent {
    base_url: String,
}

impl TriageAgent {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }

    pub fn from_env() -> Self {
        let base_url = crate::cradle_client::cradle_base_url();
        Self { base_url }
    }

    /// Classify a single segment via Cradle Server LLM.
    /// Falls back to a permissive default if the server is unreachable.
    pub fn triage(&self, segment: &ActivitySegment) -> ChronicleResult<TriageResult> {
        let request = build_request(segment);
        let url = format!("{}/chronicle/triage", self.base_url);

        let json_body = serde_json::to_string(&request)
            .map_err(|e| ChronicleError::Process(format!("failed to serialize triage request: {e}")))?;

        let response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(TRIAGE_TIMEOUT))
            .build()
            .send(json_body.as_bytes());

        match response {
            Ok(mut resp) => {
                let body = resp.body_mut().read_to_string().map_err(|e| {
                    ChronicleError::Process(format!("failed to read triage response: {e}"))
                })?;
                serde_json::from_str(&body).map_err(|e| {
                    ChronicleError::Process(format!("failed to parse triage response: {e}"))
                })
            }
            Err(_) => Ok(graceful_default(segment.id)),
        }
    }

    /// Batch triage multiple segments.
    pub fn triage_batch(&self, segments: &[&ActivitySegment]) -> ChronicleResult<Vec<TriageResult>> {
        segments.iter().map(|s| self.triage(s)).collect()
    }
}

// ─── Local heuristic triage ──────────────────────────────────────────────────

/// Simple rule-based triage without LLM. Useful as a fast pre-filter.
pub fn triage_locally(segment: &ActivitySegment) -> TriageResult {
    let duration = segment.end_time.seconds_since_epoch() - segment.start_time.seconds_since_epoch();

    // Idle segments < 60s → noise
    if segment.segment_type == SegmentType::Idle && duration < 60 {
        return TriageResult {
            segment_id: segment.id,
            worth_keeping: false,
            confidence: 0.9,
            category: TriageCategory::Noise,
            reason: "short idle segment".to_string(),
        };
    }

    // No text at all → noise
    if segment.ocr_texts.is_empty() && segment.accessibility_texts.is_empty() {
        return TriageResult {
            segment_id: segment.id,
            worth_keeping: false,
            confidence: 0.8,
            category: TriageCategory::Noise,
            reason: "no text content captured".to_string(),
        };
    }

    let app_lower = segment
        .front_app
        .as_deref()
        .unwrap_or("")
        .to_lowercase();

    // Meeting apps
    if is_meeting_app(&app_lower) {
        return TriageResult {
            segment_id: segment.id,
            worth_keeping: true,
            confidence: 0.85,
            category: TriageCategory::Meeting,
            reason: "meeting application detected".to_string(),
        };
    }

    // Code editors
    if is_coding_app(&app_lower) {
        return TriageResult {
            segment_id: segment.id,
            worth_keeping: true,
            confidence: 0.85,
            category: TriageCategory::Coding,
            reason: "code editor detected".to_string(),
        };
    }

    // Browsers
    if is_browser_app(&app_lower) {
        return TriageResult {
            segment_id: segment.id,
            worth_keeping: true,
            confidence: 0.7,
            category: TriageCategory::Browsing,
            reason: "browser detected".to_string(),
        };
    }

    // Default: keep with unknown category
    TriageResult {
        segment_id: segment.id,
        worth_keeping: true,
        confidence: 0.5,
        category: TriageCategory::Unknown,
        reason: "unclassified activity".to_string(),
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn build_request(segment: &ActivitySegment) -> TriageRequest {
    let ocr_combined: String = segment.ocr_texts.join(" ");
    let ocr_sample = truncate_str(&ocr_combined, OCR_SAMPLE_LIMIT);

    let acc_combined: String = segment.accessibility_texts.join(" ");
    let accessibility_sample = truncate_str(&acc_combined, ACCESSIBILITY_SAMPLE_LIMIT);

    let duration_seconds =
        segment.end_time.seconds_since_epoch() - segment.start_time.seconds_since_epoch();

    TriageRequest {
        segment_id: segment.id,
        front_app: segment.front_app.clone(),
        title: segment.title.clone(),
        duration_seconds,
        frame_count: segment.frame_count,
        ocr_sample,
        accessibility_sample,
    }
}

fn truncate_str(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Find a valid char boundary at or before max_bytes
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

fn graceful_default(segment_id: u64) -> TriageResult {
    TriageResult {
        segment_id,
        worth_keeping: true,
        confidence: 0.0,
        category: TriageCategory::Unknown,
        reason: "server unreachable, defaulting to keep".to_string(),
    }
}

fn is_meeting_app(app: &str) -> bool {
    app.contains("zoom")
        || app.contains("teams")
        || app.contains("meet")
        || app.contains("webex")
        || app.contains("facetime")
}

fn is_coding_app(app: &str) -> bool {
    app.contains("vscode")
        || app.contains("visual studio code")
        || app.contains("xcode")
        || app.contains("intellij")
        || app.contains("neovim")
        || app.contains("vim")
        || app.contains("emacs")
        || app.contains("cursor")
        || app.contains("zed")
}

fn is_browser_app(app: &str) -> bool {
    app.contains("safari")
        || app.contains("chrome")
        || app.contains("firefox")
        || app.contains("brave")
        || app.contains("arc")
        || app.contains("edge")
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::Timestamp;

    fn make_segment(
        id: u64,
        segment_type: SegmentType,
        front_app: Option<&str>,
        duration_seconds: u64,
        ocr_texts: Vec<&str>,
        accessibility_texts: Vec<&str>,
    ) -> ActivitySegment {
        ActivitySegment {
            id,
            start_frame_index: 0,
            end_frame_index: 10,
            start_time: Timestamp::from_seconds(1000),
            end_time: Timestamp::from_seconds(1000 + duration_seconds),
            segment_type,
            front_app: front_app.map(|s| s.to_string()),
            title: None,
            frame_count: 10,
            ocr_texts: ocr_texts.into_iter().map(|s| s.to_string()).collect(),
            accessibility_texts: accessibility_texts.into_iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn local_triage_short_idle_is_noise() {
        let seg = make_segment(1, SegmentType::Idle, None, 30, vec!["x"], vec![]);
        let result = triage_locally(&seg);
        assert!(!result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Noise);
    }

    #[test]
    fn local_triage_long_idle_is_kept() {
        let seg = make_segment(2, SegmentType::Idle, None, 120, vec!["screen text"], vec![]);
        let result = triage_locally(&seg);
        // Long idle with text → unknown but kept
        assert!(result.worth_keeping);
    }

    #[test]
    fn local_triage_no_text_is_noise() {
        let seg = make_segment(3, SegmentType::Work, Some("SomeApp"), 60, vec![], vec![]);
        let result = triage_locally(&seg);
        assert!(!result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Noise);
    }

    #[test]
    fn local_triage_meeting_app() {
        let seg = make_segment(4, SegmentType::Meeting, Some("zoom.us"), 300, vec!["hi"], vec![]);
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Meeting);
    }

    #[test]
    fn local_triage_teams_meeting() {
        let seg = make_segment(5, SegmentType::Work, Some("Microsoft Teams"), 600, vec!["chat"], vec![]);
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Meeting);
    }

    #[test]
    fn local_triage_coding_app() {
        let seg = make_segment(6, SegmentType::Work, Some("Code - VSCode"), 1800, vec!["fn main"], vec![]);
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Coding);
    }

    #[test]
    fn local_triage_xcode() {
        let seg = make_segment(7, SegmentType::Work, Some("Xcode"), 900, vec!["import"], vec![]);
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Coding);
    }

    #[test]
    fn local_triage_browser() {
        let seg = make_segment(8, SegmentType::Browsing, Some("Google Chrome"), 600, vec!["page"], vec![]);
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Browsing);
    }

    #[test]
    fn triage_request_truncates_long_text() {
        let long_ocr = "a".repeat(5000);
        let long_acc = "b".repeat(3000);
        let seg = ActivitySegment {
            id: 9,
            start_frame_index: 0,
            end_frame_index: 5,
            start_time: Timestamp::from_seconds(0),
            end_time: Timestamp::from_seconds(100),
            segment_type: SegmentType::Work,
            front_app: Some("app".to_string()),
            title: None,
            frame_count: 5,
            ocr_texts: vec![long_ocr],
            accessibility_texts: vec![long_acc],
        };

        let req = build_request(&seg);
        assert!(req.ocr_sample.len() <= OCR_SAMPLE_LIMIT);
        assert!(req.accessibility_sample.len() <= ACCESSIBILITY_SAMPLE_LIMIT);
    }

    #[test]
    fn truncate_str_handles_multibyte() {
        let s = "héllo wörld"; // contains multi-byte chars
        let truncated = truncate_str(s, 5);
        assert!(truncated.len() <= 5);
        // Must be valid UTF-8
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }
}
