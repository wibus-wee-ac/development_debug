//! Artifact storage for Cradle Chronicle recordings.
//!
//! Input: accepted frames and OCR text.
//! Output: frame bytes, OCR JSON, capture JSON, and latest snapshot JSON.
//! Position: durable storage contract consumed by memory generation and future UI.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ChronicleError, ChronicleResult};
use crate::json::quote;
use crate::ocr::OcrText;
use crate::screen::CapturedFrame;
use crate::time::Timestamp;

#[derive(Debug, Clone)]
pub struct ArtifactStore {
    storage_root: PathBuf,
    segment_started_at: Timestamp,
}

impl ArtifactStore {
    pub fn new(storage_root: impl Into<PathBuf>, segment_started_at: Timestamp) -> Self {
        Self {
            storage_root: storage_root.into(),
            segment_started_at,
        }
    }

    pub fn storage_root(&self) -> &Path {
        &self.storage_root
    }

    pub fn segment_dir(&self, display_id: u32) -> PathBuf {
        self.storage_root
            .join(display_id.to_string())
            .join(self.segment_started_at.filesystem())
    }

    pub fn memories_dir(&self) -> PathBuf {
        self.storage_root.join("memories")
    }

    pub fn persist_frame(
        &self,
        frame: &CapturedFrame,
        ocr: &OcrText,
    ) -> ChronicleResult<PersistedFrame> {
        let segment_dir = self.segment_dir(frame.display_id);
        fs::create_dir_all(&segment_dir)
            .map_err(|source| ChronicleError::io_at(&segment_dir, source))?;

        let frame_name = format!("frame-{:05}.bin", frame.frame_index);
        let frame_path = segment_dir.join(&frame_name);
        fs::write(&frame_path, &frame.bytes)
            .map_err(|source| ChronicleError::io_at(&frame_path, source))?;

        let capture_path = segment_dir.join("capture.json");
        fs::write(
            &capture_path,
            capture_json(frame, ocr, &frame_name, self.segment_started_at),
        )
        .map_err(|source| ChronicleError::io_at(&capture_path, source))?;

        let ocr_path = segment_dir.join("ocr.json");
        fs::write(&ocr_path, ocr_json(ocr, &frame_name))
            .map_err(|source| ChronicleError::io_at(&ocr_path, source))?;

        let snapshot_path = segment_dir.join("snapshot.json");
        fs::write(&snapshot_path, snapshot_json(frame, ocr, &frame_name))
            .map_err(|source| ChronicleError::io_at(&snapshot_path, source))?;

        Ok(PersistedFrame {
            display_id: frame.display_id,
            frame_index: frame.frame_index,
            segment_dir,
            frame_path,
            capture_path,
            ocr_path,
            snapshot_path,
            normalized_text: ocr.normalized_text.clone(),
            captured_at: frame.captured_at,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedFrame {
    pub display_id: u32,
    pub frame_index: u64,
    pub segment_dir: PathBuf,
    pub frame_path: PathBuf,
    pub capture_path: PathBuf,
    pub ocr_path: PathBuf,
    pub snapshot_path: PathBuf,
    pub normalized_text: String,
    pub captured_at: Timestamp,
}

fn capture_json(
    frame: &CapturedFrame,
    ocr: &OcrText,
    frame_name: &str,
    segment_started_at: Timestamp,
) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"version\": 1,\n",
            "  \"display_id\": {},\n",
            "  \"segment_started_at\": {},\n",
            "  \"captured_at\": {},\n",
            "  \"frame_index\": {},\n",
            "  \"persisted_frame_path\": {},\n",
            "  \"normalized_text\": {}\n",
            "}}\n"
        ),
        frame.display_id,
        quote(&segment_started_at.filesystem()),
        quote(&frame.captured_at.filesystem()),
        frame.frame_index,
        quote(frame_name),
        quote(&ocr.normalized_text)
    )
}

fn ocr_json(ocr: &OcrText, frame_name: &str) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"normalized_text\": {},\n",
            "  \"frame_path\": {}\n",
            "}}\n"
        ),
        quote(&ocr.normalized_text),
        quote(frame_name)
    )
}

fn snapshot_json(frame: &CapturedFrame, ocr: &OcrText, frame_name: &str) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"version\": 1,\n",
            "  \"latest_frame_index\": {},\n",
            "  \"latest_frame_path\": {},\n",
            "  \"latest_captured_at\": {},\n",
            "  \"latest_normalized_text\": {}\n",
            "}}\n"
        ),
        frame.frame_index,
        quote(frame_name),
        quote(&frame.captured_at.filesystem()),
        quote(&ocr.normalized_text)
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::ocr::OcrText;
    use crate::screen::{BrowserWindowObservation, CapturedFrame};
    use crate::time::Timestamp;

    use super::ArtifactStore;

    #[test]
    fn persists_frame_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-artifacts-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let frame = CapturedFrame {
            display_id: 5,
            frame_index: 42,
            captured_at: Timestamp::from_seconds(1_779_125_792),
            bytes: b"image bytes".to_vec(),
            observed_text: "visible text".to_string(),
            windows: vec![BrowserWindowObservation::new(1, "Cradle", "app.cradle")],
        };
        let ocr = OcrText {
            normalized_text: "visible text".to_string(),
        };

        let persisted = store
            .persist_frame(&frame, &ocr)
            .expect("frame should persist");

        assert!(persisted.frame_path.exists());
        assert!(persisted.capture_path.exists());
        assert!(persisted.ocr_path.exists());
        assert!(persisted.snapshot_path.exists());
        let capture = fs::read_to_string(persisted.capture_path).expect("capture should read");
        assert!(capture.contains("\"display_id\": 5"));
        assert!(capture.contains("\"frame_index\": 42"));

        let _ = fs::remove_dir_all(&root);
    }
}
