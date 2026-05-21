//! Partitions captured frames into logical activity segments.
//!
//! Boundaries are determined by app switches, idle timeouts, and
//! significant OCR text changes (Jaccard similarity).

use std::collections::HashSet;

use crate::recorder::artifacts::PersistedFrame;
use crate::time::Timestamp;

// ─── Config ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SegmenterConfig {
    pub idle_threshold_seconds: u64,
    pub min_segment_duration_seconds: u64,
    pub app_switch_creates_boundary: bool,
    pub text_change_threshold: f64,
}

impl Default for SegmenterConfig {
    fn default() -> Self {
        Self {
            idle_threshold_seconds: 300,
            min_segment_duration_seconds: 30,
            app_switch_creates_boundary: true,
            text_change_threshold: 0.7,
        }
    }
}

// ─── Segment types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegmentType {
    Work,
    Meeting,
    Browsing,
    Chat,
    Idle,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct ActivitySegment {
    pub id: u64,
    pub start_frame_index: u64,
    pub end_frame_index: u64,
    pub start_time: Timestamp,
    pub end_time: Timestamp,
    pub segment_type: SegmentType,
    pub front_app: Option<String>,
    pub title: Option<String>,
    pub frame_count: usize,
    pub ocr_texts: Vec<String>,
    pub accessibility_texts: Vec<String>,
}

// ─── Internal builder ────────────────────────────────────────────────────────

struct SegmentBuilder {
    id: u64,
    start_frame_index: u64,
    end_frame_index: u64,
    start_time: Timestamp,
    end_time: Timestamp,
    front_app: Option<String>,
    frame_count: usize,
    ocr_texts: Vec<String>,
    accessibility_texts: Vec<String>,
    last_text_tokens: HashSet<String>,
}

impl SegmentBuilder {
    fn new(id: u64, frame: &PersistedFrame) -> Self {
        let front_app = extract_front_app(frame);
        let tokens = tokenize(&frame.normalized_text);
        let mut builder = Self {
            id,
            start_frame_index: frame.frame_index,
            end_frame_index: frame.frame_index,
            start_time: frame.captured_at,
            end_time: frame.captured_at,
            front_app,
            frame_count: 1,
            ocr_texts: Vec::new(),
            accessibility_texts: Vec::new(),
            last_text_tokens: tokens,
        };
        if !frame.normalized_text.is_empty() {
            builder.ocr_texts.push(frame.normalized_text.clone());
        }
        if !frame.accessibility.text.is_empty() {
            builder
                .accessibility_texts
                .push(frame.accessibility.text.clone());
        }
        builder
    }

    fn push(&mut self, frame: &PersistedFrame) {
        self.end_frame_index = frame.frame_index;
        self.end_time = frame.captured_at;
        self.frame_count += 1;
        self.last_text_tokens = tokenize(&frame.normalized_text);
        if !frame.normalized_text.is_empty() {
            self.ocr_texts.push(frame.normalized_text.clone());
        }
        if !frame.accessibility.text.is_empty() {
            self.accessibility_texts
                .push(frame.accessibility.text.clone());
        }
    }

    fn build(self) -> ActivitySegment {
        let segment_type = infer_segment_type(&self.front_app);
        ActivitySegment {
            id: self.id,
            start_frame_index: self.start_frame_index,
            end_frame_index: self.end_frame_index,
            start_time: self.start_time,
            end_time: self.end_time,
            segment_type,
            front_app: self.front_app,
            title: None,
            frame_count: self.frame_count,
            ocr_texts: self.ocr_texts,
            accessibility_texts: self.accessibility_texts,
        }
    }
}

// ─── Segmenter ───────────────────────────────────────────────────────────────

pub struct Segmenter {
    config: SegmenterConfig,
    current_segment: Option<SegmentBuilder>,
    completed_segments: Vec<ActivitySegment>,
    next_segment_id: u64,
}

impl Segmenter {
    pub fn new(config: SegmenterConfig) -> Self {
        Self {
            config,
            current_segment: None,
            completed_segments: Vec::new(),
            next_segment_id: 0,
        }
    }

    pub fn push_frame(&mut self, frame: &PersistedFrame) {
        let should_split = match &self.current_segment {
            None => false,
            Some(builder) => self.is_boundary(builder, frame),
        };

        if should_split {
            self.finalize_current();
        }

        match &mut self.current_segment {
            Some(builder) => builder.push(frame),
            None => {
                let id = self.next_segment_id;
                self.next_segment_id += 1;
                self.current_segment = Some(SegmentBuilder::new(id, frame));
            }
        }
    }

    pub fn flush(&mut self) -> Vec<ActivitySegment> {
        self.finalize_current();
        std::mem::take(&mut self.completed_segments)
    }

    pub fn drain_completed(&mut self) -> Vec<ActivitySegment> {
        std::mem::take(&mut self.completed_segments)
    }

    fn finalize_current(&mut self) {
        if let Some(builder) = self.current_segment.take() {
            self.completed_segments.push(builder.build());
        }
    }

    fn is_boundary(&self, builder: &SegmentBuilder, frame: &PersistedFrame) -> bool {
        // Idle timeout
        let gap = frame
            .captured_at
            .seconds_since_epoch()
            .saturating_sub(builder.end_time.seconds_since_epoch());
        if gap >= self.config.idle_threshold_seconds {
            return true;
        }

        // App switch
        if self.config.app_switch_creates_boundary {
            let new_app = extract_front_app(frame);
            if new_app != builder.front_app {
                return true;
            }
        }

        // Text change (Jaccard distance)
        if self.config.text_change_threshold < 1.0 {
            let new_tokens = tokenize(&frame.normalized_text);
            let similarity = jaccard_similarity(&builder.last_text_tokens, &new_tokens);
            if similarity < self.config.text_change_threshold {
                return true;
            }
        }

        false
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn extract_front_app(frame: &PersistedFrame) -> Option<String> {
    frame
        .accessibility
        .elements
        .first()
        .map(|e| e.app_bundle_identifier.clone())
}

fn tokenize(text: &str) -> HashSet<String> {
    text.split_whitespace().map(|w| w.to_lowercase()).collect()
}

fn jaccard_similarity(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        return 1.0;
    }
    intersection as f64 / union as f64
}

fn infer_segment_type(front_app: &Option<String>) -> SegmentType {
    match front_app.as_deref() {
        Some(app) if app.contains("zoom") || app.contains("meet") || app.contains("teams") => {
            SegmentType::Meeting
        }
        Some(app)
            if app.contains("safari") || app.contains("chrome") || app.contains("firefox") =>
        {
            SegmentType::Browsing
        }
        Some(app)
            if app.contains("slack") || app.contains("discord") || app.contains("messages") =>
        {
            SegmentType::Chat
        }
        Some(_) => SegmentType::Work,
        None => SegmentType::Unknown,
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::screen::{
        AccessibilityCapture, AccessibilityCaptureStatus, AccessibilityElementObservation,
    };
    use std::path::PathBuf;

    fn make_frame(index: u64, seconds: u64, app: &str, text: &str) -> PersistedFrame {
        let elements = if app.is_empty() {
            vec![]
        } else {
            vec![AccessibilityElementObservation {
                role: "window".to_string(),
                label: "Window".to_string(),
                value: None,
                app_bundle_identifier: app.to_string(),
                window_id: Some(1),
                depth: 0,
                path: "window:0".to_string(),
            }]
        };
        let accessibility = AccessibilityCapture::from_elements(
            "test",
            AccessibilityCaptureStatus::Ready,
            elements,
        );
        PersistedFrame {
            display_id: 1,
            frame_index: index,
            segment_dir: PathBuf::from("/tmp/seg"),
            frame_path: PathBuf::from("/tmp/frame.png"),
            capture_path: PathBuf::from("/tmp/capture.json"),
            ocr_path: PathBuf::from("/tmp/ocr.txt"),
            snapshot_path: PathBuf::from("/tmp/snapshot.png"),
            accessibility_path: PathBuf::from("/tmp/accessibility.json"),
            accessibility,
            normalized_text: text.to_string(),
            captured_at: Timestamp::from_seconds(seconds),
        }
    }

    #[test]
    fn segments_by_app_switch() {
        let mut seg = Segmenter::new(SegmenterConfig::default());

        seg.push_frame(&make_frame(0, 1000, "com.apple.safari", "hello world"));
        seg.push_frame(&make_frame(1, 1005, "com.apple.safari", "hello world"));
        seg.push_frame(&make_frame(2, 1010, "com.microsoft.vscode", "fn main"));
        seg.push_frame(&make_frame(3, 1015, "com.microsoft.vscode", "fn main"));

        let segments = seg.flush();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].front_app.as_deref(), Some("com.apple.safari"));
        assert_eq!(segments[0].frame_count, 2);
        assert_eq!(
            segments[1].front_app.as_deref(),
            Some("com.microsoft.vscode")
        );
        assert_eq!(segments[1].frame_count, 2);
    }

    #[test]
    fn segments_by_idle_timeout() {
        let mut seg = Segmenter::new(SegmenterConfig {
            idle_threshold_seconds: 60,
            ..Default::default()
        });

        seg.push_frame(&make_frame(0, 1000, "com.apple.safari", "page one"));
        seg.push_frame(&make_frame(1, 1010, "com.apple.safari", "page one"));
        // Gap of 120 seconds exceeds 60s threshold
        seg.push_frame(&make_frame(2, 1130, "com.apple.safari", "page one"));

        let segments = seg.flush();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].end_frame_index, 1);
        assert_eq!(segments[1].start_frame_index, 2);
    }

    #[test]
    fn flush_finalizes_current_segment() {
        let mut seg = Segmenter::new(SegmenterConfig::default());

        seg.push_frame(&make_frame(0, 1000, "com.app.test", "hello"));
        assert_eq!(seg.drain_completed().len(), 0);

        let segments = seg.flush();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].frame_count, 1);
    }

    #[test]
    fn drain_does_not_finalize_current() {
        let mut seg = Segmenter::new(SegmenterConfig::default());

        seg.push_frame(&make_frame(0, 1000, "com.app.a", "text a"));
        seg.push_frame(&make_frame(1, 1005, "com.app.b", "text b"));
        // Frame 0 created segment for app.a, frame 1 triggered boundary -> segment 0 completed

        let drained = seg.drain_completed();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].front_app.as_deref(), Some("com.app.a"));

        // Current segment (app.b) still in progress
        let final_segments = seg.flush();
        assert_eq!(final_segments.len(), 1);
        assert_eq!(final_segments[0].front_app.as_deref(), Some("com.app.b"));
    }

    #[test]
    fn text_change_creates_boundary() {
        let mut seg = Segmenter::new(SegmenterConfig {
            app_switch_creates_boundary: false,
            text_change_threshold: 0.5,
            ..Default::default()
        });

        seg.push_frame(&make_frame(0, 1000, "com.app.x", "alpha beta gamma delta"));
        // Completely different text -> Jaccard similarity ~0
        seg.push_frame(&make_frame(1, 1005, "com.app.x", "one two three four five"));

        let segments = seg.flush();
        assert_eq!(segments.len(), 2);
    }

    #[test]
    fn jaccard_similarity_identical() {
        let a: HashSet<String> = ["hello", "world"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard_similarity(&a, &a), 1.0);
    }

    #[test]
    fn jaccard_similarity_disjoint() {
        let a: HashSet<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["c", "d"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard_similarity(&a, &b), 0.0);
    }

    #[test]
    fn jaccard_similarity_empty_sets() {
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(jaccard_similarity(&empty, &empty), 1.0);
    }
}
