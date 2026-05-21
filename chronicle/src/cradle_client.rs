//! HTTP client for Cradle Server integration.

use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::recorder::artifacts::PersistedFrame;

const DEFAULT_CRADLE_URL: &str = "http://127.0.0.1:21423";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONFIG_TIMEOUT: Duration = Duration::from_secs(5);

/// Dynamic configuration fetched from Cradle Server before each summarization.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleRemoteConfig {
    pub profile_id: String,
    pub model_id: String,
    pub workspace_id: String,
    pub enabled: bool,
}

/// Request body for the summarize endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeRequest {
    prompt: String,
    window_type: String,
}

/// Response from the summarize endpoint.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeResponse {
    summary: String,
}

/// Snapshot report sent after the daemon has already persisted local evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleSnapshotReport {
    pub source_id: String,
    pub display_id: u32,
    pub frame_index: u64,
    pub captured_at: String,
    pub segment_dir: String,
    pub frame_path: String,
    pub capture_path: String,
    pub ocr_path: String,
    pub snapshot_path: String,
    pub ocr_text: String,
}

impl ChronicleSnapshotReport {
    pub fn from_persisted_frame(frame: &PersistedFrame) -> Self {
        Self {
            source_id: snapshot_source_id(frame),
            display_id: frame.display_id,
            frame_index: frame.frame_index,
            captured_at: frame.captured_at.filesystem(),
            segment_dir: path_string(&frame.segment_dir),
            frame_path: path_string(&frame.frame_path),
            capture_path: path_string(&frame.capture_path),
            ocr_path: path_string(&frame.ocr_path),
            snapshot_path: path_string(&frame.snapshot_path),
            ocr_text: frame.normalized_text.clone(),
        }
    }
}

/// Memory report sent after the summary markdown has been written locally.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleMemoryReport {
    pub source_id: String,
    pub window_type: String,
    pub created_at: String,
    pub memory_path: String,
    pub content: String,
    pub summary_kind: String,
    pub source_snapshot_paths: Vec<String>,
    pub source_frame_paths: Vec<String>,
}

impl ChronicleMemoryReport {
    pub fn from_summary(
        window_type: impl Into<String>,
        created_at: impl Into<String>,
        memory_path: impl Into<PathBuf>,
        content: impl Into<String>,
        summary_kind: impl Into<String>,
        source_frames: &[PersistedFrame],
    ) -> Self {
        let memory_path = memory_path.into();
        Self {
            source_id: memory_source_id(&memory_path),
            window_type: window_type.into(),
            created_at: created_at.into(),
            memory_path: path_string(&memory_path),
            content: content.into(),
            summary_kind: summary_kind.into(),
            source_snapshot_paths: source_frames
                .iter()
                .map(|frame| path_string(&frame.snapshot_path))
                .collect(),
            source_frame_paths: source_frames
                .iter()
                .map(|frame| path_string(&frame.frame_path))
                .collect(),
        }
    }
}

/// HTTP client for communicating with Cradle Server.
#[derive(Debug, Clone)]
pub struct CradleClient {
    base_url: String,
}

impl CradleClient {
    /// Create a new client. Reads `CRADLE_URL` env var, falls back to default.
    pub fn from_env() -> Self {
        let base_url = env::var("CRADLE_URL").unwrap_or_else(|_| DEFAULT_CRADLE_URL.to_string());
        Self { base_url }
    }

    /// Create a client with an explicit URL.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }

    /// Fetch current Chronicle configuration from Cradle Server.
    /// Returns None if the server is unreachable (graceful degradation).
    pub fn fetch_config(&self) -> Option<ChronicleRemoteConfig> {
        let url = format!("{}/chronicle/config", self.base_url);
        match ureq::get(&url)
            .config()
            .timeout_global(Some(CONFIG_TIMEOUT))
            .build()
            .call()
        {
            Ok(mut response) => match response.body_mut().read_to_string() {
                Ok(body) => serde_json::from_str(&body).ok(),
                Err(_) => None,
            },
            Err(_) => None,
        }
    }

    /// Call Cradle Server to generate an LLM summary.
    /// Returns the generated markdown summary.
    pub fn summarize(&self, prompt: &str, window_type: &str) -> ChronicleResult<String> {
        let url = format!("{}/chronicle/summarize", self.base_url);
        let body = SummarizeRequest {
            prompt: prompt.to_string(),
            window_type: window_type.to_string(),
        };

        let json_body = serde_json::to_string(&body)
            .map_err(|e| ChronicleError::Process(format!("failed to serialize request: {e}")))?;

        let mut response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send(json_body.as_bytes())
            .map_err(|e| {
                ChronicleError::Process(format!("Cradle Server summarize request failed: {e}"))
            })?;

        let response_body = response.body_mut().read_to_string().map_err(|e| {
            ChronicleError::Process(format!("failed to read summarize response: {e}"))
        })?;

        let parsed: SummarizeResponse = serde_json::from_str(&response_body).map_err(|e| {
            ChronicleError::Process(format!("failed to parse summarize response: {e}"))
        })?;

        Ok(parsed.summary)
    }

    /// Report a persisted snapshot to Cradle Server.
    ///
    /// The caller must treat errors as non-fatal because the local artifacts are
    /// the recovery source if the server is down or the route has not landed yet.
    pub fn record_snapshot(&self, snapshot: &ChronicleSnapshotReport) -> ChronicleResult<()> {
        self.post_json("/chronicle/snapshots", snapshot)
    }

    /// Report a persisted memory to Cradle Server.
    ///
    /// The caller must treat errors as non-fatal because the markdown file is
    /// kept locally even when Cradle Server cannot ingest the report.
    pub fn record_memory(&self, memory: &ChronicleMemoryReport) -> ChronicleResult<()> {
        self.post_json("/chronicle/memories", memory)
    }

    /// Check if Cradle Server is reachable.
    pub fn is_available(&self) -> bool {
        self.fetch_config().is_some()
    }

    fn post_json<T>(&self, path: &str, body: &T) -> ChronicleResult<()>
    where
        T: Serialize,
    {
        let url = format!("{}{}", self.base_url, path);
        let json_body = serde_json::to_string(body)
            .map_err(|e| ChronicleError::Process(format!("failed to serialize request: {e}")))?;

        ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(CONFIG_TIMEOUT))
            .build()
            .send(json_body.as_bytes())
            .map_err(|e| {
                ChronicleError::Process(format!("Cradle Server report request failed: {e}"))
            })?;

        Ok(())
    }
}

fn snapshot_source_id(frame: &PersistedFrame) -> String {
    format!(
        "display:{}:frame:{}:captured:{}",
        frame.display_id,
        frame.frame_index,
        frame.captured_at.compact()
    )
}

fn memory_source_id(memory_path: &Path) -> String {
    memory_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("chronicle-memory")
        .to_string()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::recorder::artifacts::PersistedFrame;
    use crate::time::Timestamp;

    use super::{ChronicleMemoryReport, ChronicleSnapshotReport, CradleClient};

    #[test]
    fn client_from_env_uses_default() {
        let client = CradleClient::from_env();
        // Default URL when CRADLE_URL not set
        assert!(client.base_url.contains("127.0.0.1"));
    }

    #[test]
    fn fetch_config_returns_none_when_unavailable() {
        let client = CradleClient::new("http://127.0.0.1:1"); // port 1 = unreachable
        assert!(client.fetch_config().is_none());
    }

    #[test]
    fn is_available_returns_false_when_unreachable() {
        let client = CradleClient::new("http://127.0.0.1:1");
        assert!(!client.is_available());
    }

    #[test]
    fn snapshot_report_serializes_server_contract() {
        let report = ChronicleSnapshotReport::from_persisted_frame(&persisted_frame());
        let json = serde_json::to_value(&report).expect("snapshot report should serialize");

        assert_eq!(
            json["sourceId"],
            "display:7:frame:3:captured:20260518173631"
        );
        assert_eq!(json["displayId"], 7);
        assert_eq!(json["frameIndex"], 3);
        assert_eq!(json["capturedAt"], "2026-05-18T17-36-31Z");
        assert_eq!(json["ocrText"], "Cradle Chronicle visible text");
        assert_eq!(json["snapshotPath"], "/tmp/segment/snapshot.json");
    }

    #[test]
    fn memory_report_serializes_server_contract() {
        let frame = persisted_frame();
        let report = ChronicleMemoryReport::from_summary(
            "10min",
            "2026-05-18T17-40-00Z",
            "/tmp/memories/20260518174000-ccxi-10min-cradle_llm_summary.md",
            "Memory markdown",
            "llm",
            &[frame],
        );
        let json = serde_json::to_value(&report).expect("memory report should serialize");

        assert_eq!(
            json["sourceId"],
            "20260518174000-ccxi-10min-cradle_llm_summary.md"
        );
        assert_eq!(json["windowType"], "10min");
        assert_eq!(json["summaryKind"], "llm");
        assert_eq!(json["sourceSnapshotPaths"][0], "/tmp/segment/snapshot.json");
        assert_eq!(json["sourceFramePaths"][0], "/tmp/segment/frame-00003.jpg");
    }

    fn persisted_frame() -> PersistedFrame {
        PersistedFrame {
            display_id: 7,
            frame_index: 3,
            segment_dir: PathBuf::from("/tmp/segment"),
            frame_path: PathBuf::from("/tmp/segment/frame-00003.jpg"),
            capture_path: PathBuf::from("/tmp/segment/capture-00003.json"),
            ocr_path: PathBuf::from("/tmp/segment/ocr-00003.json"),
            snapshot_path: PathBuf::from("/tmp/segment/snapshot.json"),
            normalized_text: "Cradle Chronicle visible text".to_string(),
            captured_at: Timestamp::from_seconds(1_779_125_791),
        }
    }
}
