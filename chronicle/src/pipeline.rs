//! Pipeline Engine — orchestrates the full processing flow:
//! Segmentation → Triage → Crystallization → Dedup → Storage.

use crate::cradle_client::{DEFAULT_CRADLE_URL, cradle_base_url};
use crate::crystallizer::{Crystallizer, CrystallizerConfig, MemoryChunk};
use crate::dedup::{DedupConfig, DedupEngine, DedupVerdict};
use crate::embedding::{EmbeddingProvider, HashEmbeddingProvider, RemoteEmbeddingProvider};
use crate::error::ChronicleResult;
use crate::pii::{PiiConfig, PiiRedactor};
use crate::recorder::artifacts::PersistedFrame;
use crate::segmenter::{ActivitySegment, Segmenter, SegmenterConfig};
use crate::triage::{TriageAgent, TriageResult, triage_locally};

// ─── Pipeline Stage ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineStage {
    Segmentation,
    Triage,
    Crystallization,
    Dedup,
    Complete,
    Failed,
}

// ─── Report ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PipelineRunReport {
    pub run_id: String,
    pub stage: PipelineStage,
    pub frames_input: usize,
    pub segments_produced: usize,
    pub segments_kept: usize,
    pub segments_discarded: usize,
    pub chunks_produced: usize,
    pub chunks_deduplicated: usize,
    pub error: Option<String>,
}

// ─── Config ──────────────────────────────────────────────────────────────────

pub struct PipelineConfig {
    pub segmenter: SegmenterConfig,
    pub dedup: DedupConfig,
    pub crystallizer: CrystallizerConfig,
    pub use_remote_triage: bool,
    pub use_remote_embedding: bool,
    pub cradle_url: String,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            segmenter: SegmenterConfig::default(),
            dedup: DedupConfig::default(),
            crystallizer: CrystallizerConfig::default(),
            use_remote_triage: false,
            use_remote_embedding: false,
            cradle_url: DEFAULT_CRADLE_URL.to_string(),
        }
    }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/// The full activity processing pipeline.
pub struct Pipeline {
    config: PipelineConfig,
    segmenter: Segmenter,
    dedup: DedupEngine,
    crystallizer: Crystallizer,
    triage_agent: TriageAgent,
    pii_redactor: PiiRedactor,
    embedding: Box<dyn EmbeddingProvider>,
    produced_chunks: Vec<MemoryChunk>,
    run_counter: u64,
}

impl Pipeline {
    pub fn new(config: PipelineConfig) -> Self {
        let segmenter = Segmenter::new(config.segmenter.clone());
        let dedup = DedupEngine::new(config.dedup.clone());
        let crystallizer =
            Crystallizer::new(config.cradle_url.clone(), config.crystallizer.clone());
        let triage_agent = TriageAgent::new(config.cradle_url.clone());

        let embedding: Box<dyn EmbeddingProvider> = if config.use_remote_embedding {
            Box::new(RemoteEmbeddingProvider::new(config.cradle_url.clone()))
        } else {
            Box::new(HashEmbeddingProvider::default())
        };

        let pii_redactor = PiiRedactor::new(PiiConfig::default());

        Self {
            config,
            segmenter,
            dedup,
            crystallizer,
            triage_agent,
            pii_redactor,
            embedding,
            produced_chunks: Vec::new(),
            run_counter: 0,
        }
    }

    pub fn from_env() -> Self {
        let cradle_url = cradle_base_url();
        let config = PipelineConfig {
            cradle_url,
            ..Default::default()
        };
        Self::new(config)
    }

    /// Main entry point: process a batch of frames through the full pipeline.
    pub fn process_frames(
        &mut self,
        frames: &[PersistedFrame],
    ) -> ChronicleResult<PipelineRunReport> {
        self.run_counter += 1;
        let run_id = format!("run-{}", self.run_counter);
        let frames_input = frames.len();

        // Step 1: Segmentation
        for frame in frames {
            self.segmenter.push_frame(frame);
        }
        let segments = self.segmenter.flush();
        let segments_produced = segments.len();

        // Step 2–5: Triage → Crystallize → Dedup for each segment
        let mut segments_kept = 0;
        let mut segments_discarded = 0;
        let mut chunks_produced = 0;
        let mut chunks_deduplicated = 0;

        for segment in &segments {
            let triage_result = self.triage_segment(segment)?;

            if !triage_result.worth_keeping {
                segments_discarded += 1;
                continue;
            }
            segments_kept += 1;

            // PII Redaction — redact before crystallization
            let mut redacted_segment = segment.clone();
            self.redact_segment_texts(&mut redacted_segment);

            // Crystallize
            let response = self
                .crystallizer
                .crystallize(&redacted_segment, &triage_result)?;
            let content = &response.summary;

            // Embed
            let embedding = self.embedding.embed(content)?;

            // Dedup
            let verdict = self
                .dedup
                .check(content, Some(&embedding), segment.start_time);

            match verdict {
                DedupVerdict::New => {
                    let chunk_id = format!("{}-seg-{}", run_id, segment.id);
                    self.dedup.insert(
                        chunk_id.clone(),
                        content,
                        Some(embedding.clone()),
                        segment.start_time,
                    );

                    self.produced_chunks.push(MemoryChunk {
                        id: chunk_id,
                        content: content.clone(),
                        summary: response.summary,
                        source_segment_id: segment.id,
                        source_type: format!("{:?}", segment.segment_type),
                        category: triage_result.category,
                        tags: response.tags,
                        knowledge_cards: response.knowledge_cards,
                        embedding: Some(embedding),
                        timestamp: segment.start_time,
                        dedup_verdict: verdict,
                    });
                    chunks_produced += 1;
                }
                _ => {
                    chunks_deduplicated += 1;
                }
            }
        }

        Ok(PipelineRunReport {
            run_id,
            stage: PipelineStage::Complete,
            frames_input,
            segments_produced,
            segments_kept,
            segments_discarded,
            chunks_produced,
            chunks_deduplicated,
            error: None,
        })
    }

    /// Process a single segment through triage → PII redaction → crystallize → dedup.
    /// Returns the produced chunk if the segment passes all stages.
    pub fn process_single_segment(
        &mut self,
        segment: &ActivitySegment,
    ) -> ChronicleResult<Option<MemoryChunk>> {
        let triage_result = self.triage_segment(segment)?;
        if !triage_result.worth_keeping {
            return Ok(None);
        }

        // PII Redaction — redact before crystallization
        let mut redacted_segment = segment.clone();
        self.redact_segment_texts(&mut redacted_segment);

        self.crystallizer.crystallize_to_chunk(
            &redacted_segment,
            &triage_result,
            self.embedding.as_ref(),
            &mut self.dedup,
        )
    }

    /// Take all produced chunks, leaving the internal buffer empty.
    pub fn drain_chunks(&mut self) -> Vec<MemoryChunk> {
        std::mem::take(&mut self.produced_chunks)
    }

    /// Replace the buffered chunks after a maintenance pass.
    pub fn replace_chunks(&mut self, chunks: Vec<MemoryChunk>) {
        self.produced_chunks = chunks;
    }

    /// Number of chunks currently buffered.
    pub fn chunk_count(&self) -> usize {
        self.produced_chunks.len()
    }

    /// Reset segmenter state for a new session.
    pub fn reset_segmenter(&mut self) {
        self.segmenter = Segmenter::new(self.config.segmenter.clone());
    }

    fn triage_segment(&self, segment: &ActivitySegment) -> ChronicleResult<TriageResult> {
        if self.config.use_remote_triage {
            self.triage_agent.triage(segment)
        } else {
            Ok(triage_locally(segment))
        }
    }

    /// Redact PII from a segment's text fields in place.
    fn redact_segment_texts(&self, segment: &mut ActivitySegment) {
        for text in &mut segment.ocr_texts {
            let result = self.pii_redactor.redact(text);
            if result.entity_count > 0 {
                *text = result.text;
            }
        }
        for text in &mut segment.accessibility_texts {
            let result = self.pii_redactor.redact(text);
            if result.entity_count > 0 {
                *text = result.text;
            }
        }
    }
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/// Run the full pipeline on a batch of frames with default configuration.
pub fn run_pipeline(frames: &[PersistedFrame]) -> ChronicleResult<PipelineRunReport> {
    let mut pipeline = Pipeline::from_env();
    pipeline.process_frames(frames)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::screen::{AccessibilityCapture, AccessibilityCaptureStatus};
    use crate::time::Timestamp;

    fn mock_frame(index: u64, text: &str, app: &str, seconds: u64) -> PersistedFrame {
        let accessibility = AccessibilityCapture::from_elements(
            "test",
            AccessibilityCaptureStatus::Ready,
            vec![crate::screen::AccessibilityElementObservation {
                role: "window".to_string(),
                label: text.to_string(),
                value: None,
                app_bundle_identifier: app.to_string(),
                window_id: Some(1),
                depth: 0,
                path: "window:0".to_string(),
            }],
        );

        PersistedFrame {
            display_id: 1,
            frame_index: index,
            segment_dir: PathBuf::from("/tmp/test"),
            frame_path: PathBuf::from("/tmp/test/frame.png"),
            capture_path: PathBuf::from("/tmp/test/capture.json"),
            ocr_path: PathBuf::from("/tmp/test/ocr.json"),
            snapshot_path: PathBuf::from("/tmp/test/snapshot.json"),
            accessibility_path: PathBuf::from("/tmp/test/accessibility.json"),
            accessibility,
            normalized_text: text.to_string(),
            captured_at: Timestamp::from_seconds(seconds),
        }
    }

    #[test]
    fn empty_frames_produces_no_error() {
        let mut pipeline = Pipeline::new(PipelineConfig::default());
        let report = pipeline.process_frames(&[]).unwrap();
        assert_eq!(report.stage, PipelineStage::Complete);
        assert_eq!(report.frames_input, 0);
        assert_eq!(report.segments_produced, 0);
        assert_eq!(report.chunks_produced, 0);
    }

    #[test]
    fn segments_frames_correctly() {
        let config = PipelineConfig {
            segmenter: SegmenterConfig {
                text_change_threshold: 1.0, // disable text-change splitting
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pipeline = Pipeline::new(config);
        let frames = vec![
            mock_frame(0, "code editor open", "com.apple.dt.Xcode", 1000),
            mock_frame(1, "code editor typing", "com.apple.dt.Xcode", 1005),
            mock_frame(2, "code editor save", "com.apple.dt.Xcode", 1010),
        ];

        let report = pipeline.process_frames(&frames).unwrap();
        assert_eq!(report.frames_input, 3);
        assert_eq!(report.segments_produced, 1);
    }

    #[test]
    fn discards_idle_noise_segments() {
        let config = PipelineConfig {
            segmenter: SegmenterConfig {
                idle_threshold_seconds: 10,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pipeline = Pipeline::new(config);

        // Create frames that will produce an idle segment (short, no useful text)
        let frames = vec![mock_frame(0, "", "", 1000), mock_frame(1, "", "", 1005)];

        let report = pipeline.process_frames(&frames).unwrap();
        // Segment has no text → triage_locally marks as noise
        assert_eq!(report.segments_discarded, 1);
        assert_eq!(report.segments_kept, 0);
    }

    #[test]
    fn report_has_correct_counts() {
        let config = PipelineConfig {
            segmenter: SegmenterConfig {
                text_change_threshold: 1.0, // disable text-change splitting
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pipeline = Pipeline::new(config);

        // Two groups of frames from different apps (will create 2 segments via app switch)
        let frames = vec![
            mock_frame(0, "writing code in editor", "com.microsoft.VSCode", 1000),
            mock_frame(1, "writing more code", "com.microsoft.VSCode", 1005),
            // App switch → new segment
            mock_frame(2, "browsing docs", "com.apple.Safari", 1010),
            mock_frame(3, "reading documentation page", "com.apple.Safari", 1015),
        ];

        let report = pipeline.process_frames(&frames).unwrap();
        assert_eq!(report.frames_input, 4);
        assert_eq!(report.segments_produced, 2);
        // Both segments have text content and are from known apps, so both kept
        assert_eq!(report.segments_kept + report.segments_discarded, 2);
        assert_eq!(
            report.chunks_produced + report.chunks_deduplicated,
            report.segments_kept
        );
    }

    #[test]
    fn replace_chunks_restores_buffer_after_maintenance() {
        let mut pipeline = Pipeline::new(PipelineConfig::default());
        let chunk = MemoryChunk {
            id: "maintained".to_string(),
            content: "maintained content".to_string(),
            summary: "maintained summary".to_string(),
            source_segment_id: 1,
            source_type: "test".to_string(),
            category: crate::triage::TriageCategory::Unknown,
            tags: vec![],
            knowledge_cards: vec![],
            embedding: None,
            timestamp: Timestamp::from_seconds(1000),
            dedup_verdict: DedupVerdict::New,
        };

        pipeline.replace_chunks(vec![chunk.clone()]);
        assert_eq!(pipeline.chunk_count(), 1);
        let restored = pipeline.drain_chunks();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, chunk.id);
        assert_eq!(restored[0].content, chunk.content);
    }
}
