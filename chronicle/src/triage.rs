//! Local triage heuristics for activity segments.

use serde::{Deserialize, Serialize};

use crate::segmenter::{ActivitySegment, SegmentType};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Simple rule-based triage without LLM. Useful as a fast pre-filter.
pub fn triage_locally(segment: &ActivitySegment) -> TriageResult {
    let duration =
        segment.end_time.seconds_since_epoch() - segment.start_time.seconds_since_epoch();

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

    let app_lower = segment.front_app.as_deref().unwrap_or("").to_lowercase();

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
            accessibility_texts: accessibility_texts
                .into_iter()
                .map(|s| s.to_string())
                .collect(),
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
        let seg = make_segment(
            4,
            SegmentType::Meeting,
            Some("zoom.us"),
            300,
            vec!["hi"],
            vec![],
        );
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Meeting);
    }

    #[test]
    fn local_triage_teams_meeting() {
        let seg = make_segment(
            5,
            SegmentType::Work,
            Some("Microsoft Teams"),
            600,
            vec!["chat"],
            vec![],
        );
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Meeting);
    }

    #[test]
    fn local_triage_coding_app() {
        let seg = make_segment(
            6,
            SegmentType::Work,
            Some("Code - VSCode"),
            1800,
            vec!["fn main"],
            vec![],
        );
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Coding);
    }

    #[test]
    fn local_triage_xcode() {
        let seg = make_segment(
            7,
            SegmentType::Work,
            Some("Xcode"),
            900,
            vec!["import"],
            vec![],
        );
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Coding);
    }

    #[test]
    fn local_triage_browser() {
        let seg = make_segment(
            8,
            SegmentType::Browsing,
            Some("Google Chrome"),
            600,
            vec!["page"],
            vec![],
        );
        let result = triage_locally(&seg);
        assert!(result.worth_keeping);
        assert_eq!(result.category, TriageCategory::Browsing);
    }
}
