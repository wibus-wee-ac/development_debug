//! Recursive memory summarization orchestration.

use std::path::PathBuf;

use crate::error::ChronicleResult;
use crate::memory_pipeline::naming::MemoryWindow;
use crate::memory_pipeline::summarizer::{MemorySummary, SummaryRequest, SummaryWriter};
use crate::recorder::artifacts::PersistedFrame;
use crate::time::Timestamp;

#[derive(Debug, Clone)]
pub struct RecursiveSummarizer<W> {
    writer: W,
    memories_dir: PathBuf,
}

impl<W> RecursiveSummarizer<W>
where
    W: SummaryWriter,
{
    pub fn new(writer: W, memories_dir: impl Into<PathBuf>) -> Self {
        Self {
            writer,
            memories_dir: memories_dir.into(),
        }
    }

    pub fn write_ten_minute_summary(
        &self,
        description: impl Into<String>,
        frames: Vec<PersistedFrame>,
    ) -> ChronicleResult<MemorySummary> {
        self.writer.write_summary(SummaryRequest {
            memories_dir: self.memories_dir.clone(),
            window: MemoryWindow::TenMinutes,
            description: description.into(),
            frames,
            child_summaries: Vec::new(),
            anchor_timestamp: None,
        })
    }

    pub fn write_six_hour_summary(
        &self,
        description: impl Into<String>,
        child_summaries: Vec<String>,
        anchor_timestamp: Timestamp,
    ) -> ChronicleResult<MemorySummary> {
        self.writer.write_summary(SummaryRequest {
            memories_dir: self.memories_dir.clone(),
            window: MemoryWindow::SixHours,
            description: description.into(),
            frames: Vec::new(),
            child_summaries,
            anchor_timestamp: Some(anchor_timestamp),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use crate::memory_pipeline::recursive::RecursiveSummarizer;
    use crate::memory_pipeline::summarizer::LocalSummaryWriter;
    use crate::recorder::artifacts::PersistedFrame;
    use crate::screen::AccessibilityCapture;
    use crate::time::Timestamp;

    #[test]
    fn writes_ten_minute_and_six_hour_summaries() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-recursive-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, root.join("memories"));
        let frame = PersistedFrame {
            display_id: 1,
            frame_index: 1,
            segment_dir: PathBuf::from("/tmp/segment"),
            frame_path: PathBuf::from("/tmp/segment/frame-00001.bin"),
            capture_path: PathBuf::from("/tmp/segment/capture.json"),
            ocr_path: PathBuf::from("/tmp/segment/ocr.json"),
            snapshot_path: PathBuf::from("/tmp/segment/snapshot.json"),
            accessibility_path: PathBuf::from("/tmp/segment/accessibility.json"),
            accessibility: AccessibilityCapture::unavailable("test"),
            normalized_text: "Cradle Chronicle phase one".to_string(),
            captured_at: Timestamp::from_seconds(1_779_125_791),
        };

        let phase_one = summarizer
            .write_ten_minute_summary("Cradle phase one", vec![frame])
            .expect("phase one should write");
        let phase_two = summarizer
            .write_six_hour_summary(
                "Cradle phase two",
                vec![phase_one.markdown.clone()],
                Timestamp::from_seconds(1_779_126_000),
            )
            .expect("phase two should write");

        assert!(phase_one.output_path.to_string_lossy().contains("-10min-"));
        assert!(phase_two.output_path.to_string_lossy().contains("-6h-"));
        assert!(phase_two.prompt.contains("CHILD SUMMARY 1"));

        let _ = fs::remove_dir_all(&root);
    }
}
