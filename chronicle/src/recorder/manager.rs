//! Recorder orchestration for Cradle Chronicle.
//!
//! Input: capture source, OCR extractor, privacy filter, and artifact store.
//! Output: persisted frames and a recorder report.
//! Position: main capture pipeline used by the CLI and future host integrations.

use crate::error::ChronicleResult;
use crate::ocr::TextExtractor;
use crate::recorder::artifacts::{ArtifactStore, PersistedFrame};
use crate::recorder::fingerprint::FrameFingerprint;
use crate::screen::CaptureSource;
use crate::screen::privacy_filter::PrivacyFilter;

pub struct RecorderManager<S, O> {
    source: S,
    extractor: O,
    privacy_filter: PrivacyFilter,
    artifact_store: ArtifactStore,
    previous_fingerprint: Option<FrameFingerprint>,
}

impl<S, O> RecorderManager<S, O>
where
    S: CaptureSource,
    O: TextExtractor,
{
    pub fn new(source: S, extractor: O, artifact_store: ArtifactStore) -> Self {
        Self {
            source,
            extractor,
            privacy_filter: PrivacyFilter,
            artifact_store,
            previous_fingerprint: None,
        }
    }

    pub fn run_until_exhausted(&mut self) -> ChronicleResult<RecorderReport> {
        let mut report = RecorderReport::default();

        while let Some(frame) = self.source.next_frame()? {
            report.observed_frames += 1;

            if self.privacy_filter.should_exclude_frame(&frame) {
                report.privacy_filtered_frames += 1;
                continue;
            }

            let ocr = self.extractor.extract_text(&frame)?;
            let fingerprint = FrameFingerprint::from_parts(&frame.bytes, &ocr.normalized_text);
            if self
                .previous_fingerprint
                .is_some_and(|previous| fingerprint.is_duplicate_of(previous))
            {
                report.duplicate_frames += 1;
                continue;
            }

            self.previous_fingerprint = Some(fingerprint);
            let persisted = self.artifact_store.persist_frame(&frame, &ocr)?;
            report.persisted_frames.push(persisted);
        }

        Ok(report)
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RecorderReport {
    pub observed_frames: usize,
    pub privacy_filtered_frames: usize,
    pub duplicate_frames: usize,
    pub persisted_frames: Vec<PersistedFrame>,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::ocr::ObservedTextExtractor;
    use crate::recorder::artifacts::ArtifactStore;
    use crate::screen::synthetic::SyntheticCaptureSource;
    use crate::screen::{BrowserWindowObservation, CapturedFrame};
    use crate::time::Timestamp;

    use super::RecorderManager;

    #[test]
    fn filters_duplicates_and_private_frames() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-manager-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let frames = vec![
            frame(
                1,
                "same",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
            frame(
                2,
                "same",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
            frame(
                3,
                "private",
                BrowserWindowObservation::new(2, "Search Incognito", "com.google.Chrome"),
            ),
            frame(
                4,
                "different",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
        ];
        let source = SyntheticCaptureSource::from_frames(frames);
        let store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);

        let report = manager.run_until_exhausted().expect("run should succeed");

        assert_eq!(report.observed_frames, 4);
        assert_eq!(report.duplicate_frames, 1);
        assert_eq!(report.privacy_filtered_frames, 1);
        assert_eq!(report.persisted_frames.len(), 2);

        let _ = fs::remove_dir_all(&root);
    }

    fn frame(index: u64, text: &str, window: BrowserWindowObservation) -> CapturedFrame {
        CapturedFrame {
            display_id: 1,
            frame_index: index,
            captured_at: Timestamp::from_seconds(1_779_125_791 + index),
            bytes: text.as_bytes().to_vec(),
            frame_extension: "jpg".to_string(),
            observed_text: text.to_string(),
            windows: vec![window],
        }
    }
}
