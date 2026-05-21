//! HTTP client for Cradle Server integration.

use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::recorder::artifacts::PersistedFrame;

/// Default Cradle Server URL.
pub const DEFAULT_CRADLE_URL: &str = "http://127.0.0.1:21423";

/// Read the Cradle Server base URL from `CRADLE_URL` env var or use default.
pub fn cradle_base_url() -> String {
    env::var("CRADLE_URL").unwrap_or_else(|_| DEFAULT_CRADLE_URL.to_string())
}

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
    pub accessibility: ChronicleAccessibilitySnapshotReport,
}

/// Accessibility/window-tree evidence captured alongside a screen snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleAccessibilitySnapshotReport {
    pub source_id: String,
    pub status: String,
    pub provider: String,
    pub accessibility_path: String,
    pub text: String,
    pub element_count: usize,
    pub tree: serde_json::Value,
    pub metadata: serde_json::Value,
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
            accessibility: ChronicleAccessibilitySnapshotReport {
                source_id: format!("accessibility:{}", snapshot_source_id(frame)),
                status: frame.accessibility.status.as_str().to_string(),
                provider: frame.accessibility.provider.clone(),
                accessibility_path: path_string(&frame.accessibility_path),
                text: frame.accessibility.text.clone(),
                element_count: frame.accessibility.elements.len(),
                tree: serde_json::json!(
                    frame
                        .accessibility
                        .elements
                        .iter()
                        .map(|element| {
                            serde_json::json!({
                                "role": element.role,
                                "label": element.label,
                                "value": element.value,
                                "appBundleId": element.app_bundle_identifier,
                                "windowId": element.window_id,
                                "depth": element.depth,
                                "path": element.path
                            })
                        })
                        .collect::<Vec<_>>()
                ),
                metadata: serde_json::json!({
                    "artifactPath": path_string(&frame.accessibility_path)
                }),
            },
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

/// Source of a transcript report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChronicleAudioTranscriptSource {
    Asr,
    Manual,
    #[default]
    Imported,
}

/// Lifecycle status of a transcript report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChronicleAudioTranscriptStatus {
    Recording,
    Completed,
    Imported,
    Error,
}

impl ChronicleAudioTranscriptStatus {
    fn default_for_source(source: ChronicleAudioTranscriptSource) -> Self {
        match source {
            ChronicleAudioTranscriptSource::Asr => Self::Completed,
            ChronicleAudioTranscriptSource::Manual | ChronicleAudioTranscriptSource::Imported => {
                Self::Imported
            }
        }
    }
}

/// Segment confidence bounded to the Server contract range.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ChronicleTranscriptConfidence(f32);

impl ChronicleTranscriptConfidence {
    pub fn new(value: f32) -> ChronicleResult<Self> {
        if value.is_finite() && (0.0..=1.0).contains(&value) {
            Ok(Self(value))
        } else {
            Err(ChronicleError::InvalidArgument(format!(
                "transcript confidence must be between 0 and 1, got {value}"
            )))
        }
    }

    pub fn get(self) -> f32 {
        self.0
    }
}

impl<'de> Deserialize<'de> for ChronicleTranscriptConfidence {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = f32::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// One speech/text segment in an externally produced audio transcript.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleAudioTranscriptSegmentReport {
    pub start_ms: u64,
    #[serde(default)]
    pub end_ms: Option<u64>,
    #[serde(default)]
    pub speaker_label: Option<String>,
    pub text: String,
    #[serde(default)]
    pub confidence: Option<ChronicleTranscriptConfidence>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default = "empty_json_object")]
    pub metadata: serde_json::Value,
}

/// Transcript report sent after transcript evidence has been produced locally.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleAudioTranscriptReport {
    pub source_id: String,
    pub title: Option<String>,
    pub source: ChronicleAudioTranscriptSource,
    pub status: ChronicleAudioTranscriptStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub language: Option<String>,
    pub app_bundle_id: Option<String>,
    pub window_title: Option<String>,
    pub audio_path: Option<String>,
    pub transcript_path: Option<String>,
    pub segments: Vec<ChronicleAudioTranscriptSegmentReport>,
    pub metadata: serde_json::Value,
}

/// Speaker profile evidence learned by the local speaker embedding runtime.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleSpeakerProfileReport {
    pub display_name: String,
    pub aliases: Vec<String>,
    pub embedding: Option<Vec<f32>>,
    pub embedding_model_id: Option<String>,
    pub sample_count: u32,
    pub last_seen_at: Option<String>,
    pub metadata: serde_json::Value,
}

/// Raw audio segment evidence written before VAD/ASR/speaker processing.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleAudioRawSegmentReport {
    pub source_id: String,
    pub recorded_at: String,
    pub source: ChronicleAudioRawSegmentSource,
    pub status: ChronicleAudioRawSegmentStatus,
    pub audio_path: String,
    pub metadata_path: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_count: usize,
    pub dropped_samples: usize,
    pub duration_ms: u64,
    pub rms: f32,
    pub peak: f32,
    pub active: bool,
    pub vad_implemented: bool,
    pub asr_implemented: bool,
    pub speaker_labeling_implemented: bool,
    pub metadata: serde_json::Value,
}

/// Processing result for a previously reported raw audio segment.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleAudioRawSegmentProcessingResultReport {
    pub status: Option<ChronicleAudioRawSegmentStatus>,
    pub vad_status: Option<ChronicleAudioProcessingStatus>,
    pub asr_status: Option<ChronicleAudioProcessingStatus>,
    pub speaker_status: Option<ChronicleAudioProcessingStatus>,
    pub transcript_source_id: Option<String>,
    pub speaker_profile_ids: Vec<String>,
    pub error_message: Option<String>,
    pub metadata: serde_json::Value,
}

/// Origin of a raw audio segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChronicleAudioRawSegmentSource {
    Microphone,
    System,
    Mixed,
}

/// Server-side lifecycle state for raw audio segment evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChronicleAudioRawSegmentStatus {
    Captured,
    Queued,
    Processed,
    Ignored,
    Error,
}

/// Server-side lifecycle state for audio processors attached to a raw segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChronicleAudioProcessingStatus {
    NotImplemented,
    Pending,
    Ready,
    Error,
}

impl ChronicleAudioRawSegmentReport {
    pub fn validate(&self) -> ChronicleResult<()> {
        if self.source_id.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment source_id must not be empty".to_string(),
            ));
        }
        if self.recorded_at.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment recorded_at must not be empty".to_string(),
            ));
        }
        if self.audio_path.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment audio_path must not be empty".to_string(),
            ));
        }
        if self.metadata_path.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment metadata_path must not be empty".to_string(),
            ));
        }
        if self.sample_rate == 0 {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment sample_rate must be positive".to_string(),
            ));
        }
        if self.channels == 0 {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment channels must be positive".to_string(),
            ));
        }
        if !self.rms.is_finite() || !(0.0..=1.0).contains(&self.rms) {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment rms must be between 0 and 1".to_string(),
            ));
        }
        if !self.peak.is_finite() || !(0.0..=1.0).contains(&self.peak) {
            return Err(ChronicleError::InvalidArgument(
                "raw audio segment peak must be between 0 and 1".to_string(),
            ));
        }
        Ok(())
    }
}

impl ChronicleAudioRawSegmentProcessingResultReport {
    pub fn validate(&self) -> ChronicleResult<()> {
        if self
            .transcript_source_id
            .as_ref()
            .is_some_and(|source_id| source_id.trim().is_empty())
        {
            return Err(ChronicleError::InvalidArgument(
                "raw audio processing transcript_source_id must not be empty when provided"
                    .to_string(),
            ));
        }
        if self
            .speaker_profile_ids
            .iter()
            .any(|speaker_profile_id| speaker_profile_id.trim().is_empty())
        {
            return Err(ChronicleError::InvalidArgument(
                "raw audio processing speaker_profile_ids must not contain empty values"
                    .to_string(),
            ));
        }
        Ok(())
    }
}

impl ChronicleSpeakerProfileReport {
    pub fn validate(&self) -> ChronicleResult<()> {
        if self.display_name.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "speaker profile display_name must not be empty".to_string(),
            ));
        }
        if self
            .embedding
            .as_ref()
            .is_some_and(|embedding| embedding.is_empty())
        {
            return Err(ChronicleError::InvalidArgument(
                "speaker profile embedding must not be empty when provided".to_string(),
            ));
        }
        if self
            .embedding
            .as_ref()
            .is_some_and(|embedding| embedding.iter().any(|value| !value.is_finite()))
        {
            return Err(ChronicleError::InvalidArgument(
                "speaker profile embedding must contain only finite values".to_string(),
            ));
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for ChronicleAudioTranscriptReport {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawReport {
            source_id: String,
            #[serde(default)]
            title: Option<String>,
            #[serde(default)]
            source: Option<ChronicleAudioTranscriptSource>,
            #[serde(default)]
            status: Option<ChronicleAudioTranscriptStatus>,
            started_at: String,
            #[serde(default)]
            ended_at: Option<String>,
            #[serde(default)]
            language: Option<String>,
            #[serde(default)]
            app_bundle_id: Option<String>,
            #[serde(default)]
            window_title: Option<String>,
            #[serde(default)]
            audio_path: Option<String>,
            #[serde(default)]
            transcript_path: Option<String>,
            segments: Vec<ChronicleAudioTranscriptSegmentReport>,
            #[serde(default = "empty_json_object")]
            metadata: serde_json::Value,
        }

        let raw = RawReport::deserialize(deserializer)?;
        let source = raw.source.unwrap_or_default();
        let status = raw
            .status
            .unwrap_or_else(|| ChronicleAudioTranscriptStatus::default_for_source(source));
        Ok(Self {
            source_id: raw.source_id,
            title: raw.title,
            source,
            status,
            started_at: raw.started_at,
            ended_at: raw.ended_at,
            language: raw.language,
            app_bundle_id: raw.app_bundle_id,
            window_title: raw.window_title,
            audio_path: raw.audio_path,
            transcript_path: raw.transcript_path,
            segments: raw.segments,
            metadata: raw.metadata,
        })
    }
}

impl ChronicleAudioTranscriptReport {
    pub fn validate(&self) -> ChronicleResult<()> {
        if self.source_id.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "transcript source_id must not be empty".to_string(),
            ));
        }
        if self.started_at.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "transcript started_at must not be empty".to_string(),
            ));
        }
        for (index, segment) in self.segments.iter().enumerate() {
            if segment.text.trim().is_empty() {
                return Err(ChronicleError::InvalidArgument(format!(
                    "transcript segment {index} text must not be empty"
                )));
            }
            if segment
                .confidence
                .is_some_and(|confidence| !confidence.get().is_finite())
            {
                return Err(ChronicleError::InvalidArgument(format!(
                    "transcript segment {index} confidence must be finite"
                )));
            }
            if segment
                .end_ms
                .is_some_and(|end_ms| end_ms < segment.start_ms)
            {
                return Err(ChronicleError::InvalidArgument(format!(
                    "transcript segment {index} end_ms must be greater than or equal to start_ms"
                )));
            }
        }
        Ok(())
    }
}

fn empty_json_object() -> serde_json::Value {
    serde_json::json!({})
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
        let base_url = cradle_base_url();
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

    /// Report a persisted audio transcript to Cradle Server.
    ///
    /// This is only the transport contract. Real audio capture, VAD, ASR, and
    /// speaker labeling are separate runtime capabilities.
    pub fn record_audio_transcript(
        &self,
        transcript: &ChronicleAudioTranscriptReport,
    ) -> ChronicleResult<()> {
        transcript.validate()?;
        self.post_json("/chronicle/audio-transcripts", transcript)
    }

    /// Report a speaker profile learned by the local speaker embedding runtime.
    pub fn record_speaker_profile(
        &self,
        profile: &ChronicleSpeakerProfileReport,
    ) -> ChronicleResult<()> {
        profile.validate()?;
        self.post_json("/chronicle/speaker-profiles", profile)
    }

    /// Report raw audio segment evidence to Cradle Server.
    pub fn record_audio_raw_segment(
        &self,
        segment: &ChronicleAudioRawSegmentReport,
    ) -> ChronicleResult<()> {
        segment.validate()?;
        self.post_json("/chronicle/audio-raw-segments", segment)
    }

    /// Report processing status for a previously persisted raw audio segment.
    pub fn record_audio_raw_segment_processing_result(
        &self,
        source_id: &str,
        result: &ChronicleAudioRawSegmentProcessingResultReport,
    ) -> ChronicleResult<()> {
        if source_id.trim().is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "raw audio processing source_id must not be empty".to_string(),
            ));
        }
        result.validate()?;
        self.post_json(
            &format!(
                "/chronicle/audio-raw-segments/{}/processing-result",
                encode_path_segment(source_id)
            ),
            result,
        )
    }

    /// Report a chat message (e.g. from Slack) to Cradle Server.
    pub fn record_chat_message(&self, payload: &serde_json::Value) -> ChronicleResult<()> {
        let url = format!("{}/chronicle/chat-message", self.base_url);
        let json_body = serde_json::to_string(payload).map_err(|e| {
            ChronicleError::Process(format!("failed to serialize chat message: {e}"))
        })?;
        ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send(json_body.as_bytes())
            .map_err(|e| ChronicleError::Process(format!("failed to report chat message: {e}")))?;
        Ok(())
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

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::recorder::artifacts::PersistedFrame;
    use crate::screen::{
        AccessibilityCapture, AccessibilityCaptureStatus, BrowserWindowObservation,
    };
    use crate::time::Timestamp;

    use super::{
        ChronicleAudioProcessingStatus, ChronicleAudioRawSegmentProcessingResultReport,
        ChronicleAudioRawSegmentReport, ChronicleAudioRawSegmentSource,
        ChronicleAudioRawSegmentStatus, ChronicleAudioTranscriptReport,
        ChronicleAudioTranscriptSegmentReport, ChronicleAudioTranscriptSource,
        ChronicleAudioTranscriptStatus, ChronicleMemoryReport, ChronicleSnapshotReport,
        ChronicleSpeakerProfileReport, ChronicleTranscriptConfidence, CradleClient,
    };

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
        assert_eq!(json["accessibility"]["status"], "ready");
        assert_eq!(
            json["accessibility"]["accessibilityPath"],
            "/tmp/segment/accessibility.json"
        );
        assert_eq!(json["accessibility"]["elementCount"], 1);
        assert_eq!(json["accessibility"]["tree"][0]["label"], "Cradle");
        assert_eq!(json["accessibility"]["tree"][0]["depth"], 0);
        assert_eq!(json["accessibility"]["tree"][0]["path"], "window:0");
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

    #[test]
    fn audio_transcript_report_serializes_server_contract() {
        let report = ChronicleAudioTranscriptReport {
            source_id: "meeting-source-1".to_string(),
            title: Some("Chronicle planning".to_string()),
            source: ChronicleAudioTranscriptSource::Imported,
            status: ChronicleAudioTranscriptStatus::Completed,
            started_at: "2026-05-21T10:30:00Z".to_string(),
            ended_at: Some("2026-05-21T10:45:00Z".to_string()),
            language: Some("en".to_string()),
            app_bundle_id: Some("us.zoom.xos".to_string()),
            window_title: Some("Chronicle planning".to_string()),
            audio_path: None,
            transcript_path: Some("/tmp/audio-transcripts/meeting-source-1.json".to_string()),
            segments: vec![ChronicleAudioTranscriptSegmentReport {
                start_ms: 0,
                end_ms: Some(2500),
                speaker_label: Some("Ada".to_string()),
                text: "AudioTargetAlpha should become searchable.".to_string(),
                confidence: Some(ChronicleTranscriptConfidence::new(0.94).unwrap()),
                language: Some("en".to_string()),
                metadata: serde_json::json!({
                    "runtime": "external",
                    "vadImplemented": false,
                    "asrImplemented": false
                }),
            }],
            metadata: serde_json::json!({
                "kind": "audio-transcript",
                "audioRuntime": "external",
                "vadImplemented": false,
                "asrImplemented": false,
                "speakerLabelingImplemented": false
            }),
        };

        let json = serde_json::to_value(&report).expect("audio transcript report should serialize");

        assert_eq!(json["sourceId"], "meeting-source-1");
        assert_eq!(json["startedAt"], "2026-05-21T10:30:00Z");
        assert_eq!(
            json["transcriptPath"],
            "/tmp/audio-transcripts/meeting-source-1.json"
        );
        assert_eq!(json["segments"][0]["startMs"], 0);
        assert_eq!(json["segments"][0]["speakerLabel"], "Ada");
        assert_eq!(json["metadata"]["asrImplemented"], false);
    }

    #[test]
    fn audio_transcript_source_and_status_variants_match_server_contract() {
        let source_json = serde_json::to_value(ChronicleAudioTranscriptSource::Asr)
            .expect("source should serialize");
        let status_json = serde_json::to_value(ChronicleAudioTranscriptStatus::Recording)
            .expect("status should serialize");

        assert_eq!(source_json, "asr");
        assert_eq!(status_json, "recording");
        assert!(ChronicleTranscriptConfidence::new(1.01).is_err());
        assert!(ChronicleTranscriptConfidence::new(f32::NAN).is_err());
    }

    #[test]
    fn speaker_profile_report_serializes_server_contract() {
        let report = ChronicleSpeakerProfileReport {
            display_name: "Ada".to_string(),
            aliases: vec!["Ada Lovelace".to_string()],
            embedding: Some(vec![0.1, -0.2, 0.3]),
            embedding_model_id: Some("3dspeaker-campplus-zh-en-16k".to_string()),
            sample_count: 2,
            last_seen_at: Some("2026-05-21T10:40:00Z".to_string()),
            metadata: serde_json::json!({
                "source": "speaker-embedding-runtime",
                "threshold": 0.6
            }),
        };

        let json = serde_json::to_value(&report).expect("speaker profile should serialize");

        assert_eq!(json["displayName"], "Ada");
        assert_eq!(json["aliases"][0], "Ada Lovelace");
        assert!((json["embedding"][1].as_f64().unwrap() + 0.2).abs() < 0.000_001);
        assert_eq!(json["embeddingModelId"], "3dspeaker-campplus-zh-en-16k");
        assert_eq!(json["sampleCount"], 2);
        assert_eq!(json["lastSeenAt"], "2026-05-21T10:40:00Z");
        assert_eq!(json["metadata"]["threshold"], 0.6);
    }

    #[test]
    fn speaker_profile_report_rejects_invalid_embedding() {
        let empty_name = ChronicleSpeakerProfileReport {
            display_name: " ".to_string(),
            aliases: vec![],
            embedding: None,
            embedding_model_id: None,
            sample_count: 0,
            last_seen_at: None,
            metadata: serde_json::json!({}),
        };
        assert!(empty_name.validate().is_err());

        let invalid_embedding = ChronicleSpeakerProfileReport {
            display_name: "Ada".to_string(),
            aliases: vec![],
            embedding: Some(vec![f32::NAN]),
            embedding_model_id: None,
            sample_count: 0,
            last_seen_at: None,
            metadata: serde_json::json!({}),
        };
        assert!(invalid_embedding.validate().is_err());
    }

    #[test]
    fn audio_transcript_report_rejects_reversed_segment_range() {
        let report = ChronicleAudioTranscriptReport {
            source_id: "meeting-source-1".to_string(),
            title: None,
            source: ChronicleAudioTranscriptSource::Imported,
            status: ChronicleAudioTranscriptStatus::Completed,
            started_at: "2026-05-21T10:30:00Z".to_string(),
            ended_at: None,
            language: None,
            app_bundle_id: None,
            window_title: None,
            audio_path: None,
            transcript_path: None,
            segments: vec![ChronicleAudioTranscriptSegmentReport {
                start_ms: 5000,
                end_ms: Some(1000),
                speaker_label: None,
                text: "Invalid range".to_string(),
                confidence: None,
                language: None,
                metadata: serde_json::json!({}),
            }],
            metadata: serde_json::json!({}),
        };

        assert!(report.validate().is_err());
    }

    #[test]
    fn audio_raw_segment_report_serializes_server_contract() {
        let report = audio_raw_segment_report();
        let json = serde_json::to_value(&report).expect("raw audio segment should serialize");

        assert_eq!(
            json["sourceId"],
            "audio:microphone:20260521T103000Z-microphone-segment"
        );
        assert_eq!(json["recordedAt"], "2026-05-21T10:30:00Z");
        assert_eq!(json["source"], "microphone");
        assert_eq!(json["status"], "captured");
        assert_eq!(json["audioPath"], "/tmp/audio/segments/segment.wav");
        assert_eq!(json["metadataPath"], "/tmp/audio/segments/segment.json");
        assert_eq!(json["sampleRate"], 16_000);
        assert_eq!(json["vadImplemented"], false);
        assert_eq!(json["metadata"]["runtime"], "microphone-segment");
    }

    #[test]
    fn audio_raw_segment_processing_result_serializes_server_contract() {
        let report = ChronicleAudioRawSegmentProcessingResultReport {
            status: Some(ChronicleAudioRawSegmentStatus::Processed),
            vad_status: Some(ChronicleAudioProcessingStatus::Ready),
            asr_status: Some(ChronicleAudioProcessingStatus::Ready),
            speaker_status: Some(ChronicleAudioProcessingStatus::Ready),
            transcript_source_id: Some("meeting-source-1".to_string()),
            speaker_profile_ids: vec!["speaker-profile-1".to_string()],
            error_message: None,
            metadata: serde_json::json!({
                "runtime": "local-audio-pipeline"
            }),
        };

        let json =
            serde_json::to_value(&report).expect("raw audio processing result should serialize");

        assert_eq!(json["status"], "processed");
        assert_eq!(json["vadStatus"], "ready");
        assert_eq!(json["asrStatus"], "ready");
        assert_eq!(json["speakerStatus"], "ready");
        assert_eq!(json["transcriptSourceId"], "meeting-source-1");
        assert_eq!(json["speakerProfileIds"][0], "speaker-profile-1");
        assert_eq!(json["metadata"]["runtime"], "local-audio-pipeline");
    }

    #[test]
    fn audio_raw_segment_variants_match_server_contract() {
        let source_json = serde_json::to_value(ChronicleAudioRawSegmentSource::Microphone)
            .expect("source should serialize");
        let status_json = serde_json::to_value(ChronicleAudioRawSegmentStatus::Captured)
            .expect("status should serialize");

        assert_eq!(source_json, "microphone");
        assert_eq!(status_json, "captured");
    }

    #[test]
    fn audio_raw_segment_processing_result_rejects_invalid_refs() {
        let report = ChronicleAudioRawSegmentProcessingResultReport {
            status: None,
            vad_status: None,
            asr_status: None,
            speaker_status: None,
            transcript_source_id: Some(" ".to_string()),
            speaker_profile_ids: vec![],
            error_message: None,
            metadata: serde_json::json!({}),
        };
        assert!(report.validate().is_err());

        let report = ChronicleAudioRawSegmentProcessingResultReport {
            status: None,
            vad_status: None,
            asr_status: None,
            speaker_status: None,
            transcript_source_id: None,
            speaker_profile_ids: vec!["".to_string()],
            error_message: None,
            metadata: serde_json::json!({}),
        };
        assert!(report.validate().is_err());
    }

    #[test]
    fn audio_raw_segment_report_rejects_invalid_fields() {
        let mut report = audio_raw_segment_report();
        report.audio_path = String::new();
        assert!(report.validate().is_err());

        let mut report = audio_raw_segment_report();
        report.metadata_path = String::new();
        assert!(report.validate().is_err());

        let mut report = audio_raw_segment_report();
        report.sample_rate = 0;
        assert!(report.validate().is_err());

        let mut report = audio_raw_segment_report();
        report.rms = 1.1;
        assert!(report.validate().is_err());

        let mut report = audio_raw_segment_report();
        report.peak = f32::NAN;
        assert!(report.validate().is_err());
    }

    fn audio_raw_segment_report() -> ChronicleAudioRawSegmentReport {
        ChronicleAudioRawSegmentReport {
            source_id: "audio:microphone:20260521T103000Z-microphone-segment".to_string(),
            recorded_at: "2026-05-21T10:30:00Z".to_string(),
            source: ChronicleAudioRawSegmentSource::Microphone,
            status: ChronicleAudioRawSegmentStatus::Captured,
            audio_path: "/tmp/audio/segments/segment.wav".to_string(),
            metadata_path: "/tmp/audio/segments/segment.json".to_string(),
            sample_rate: 16_000,
            channels: 1,
            sample_count: 8_000,
            dropped_samples: 2,
            duration_ms: 500,
            rms: 0.25,
            peak: 0.75,
            active: true,
            vad_implemented: false,
            asr_implemented: false,
            speaker_labeling_implemented: false,
            metadata: serde_json::json!({
                "runtime": "microphone-segment",
                "sourceSampleFormat": "f32"
            }),
        }
    }

    fn persisted_frame() -> PersistedFrame {
        let windows = vec![BrowserWindowObservation::new(
            1,
            "Cradle",
            "app.cradle.desktop",
        )];
        PersistedFrame {
            display_id: 7,
            frame_index: 3,
            segment_dir: PathBuf::from("/tmp/segment"),
            frame_path: PathBuf::from("/tmp/segment/frame-00003.jpg"),
            capture_path: PathBuf::from("/tmp/segment/capture-00003.json"),
            ocr_path: PathBuf::from("/tmp/segment/ocr-00003.json"),
            snapshot_path: PathBuf::from("/tmp/segment/snapshot.json"),
            accessibility_path: PathBuf::from("/tmp/segment/accessibility.json"),
            accessibility: AccessibilityCapture::from_windows(
                &windows,
                AccessibilityCaptureStatus::Ready,
            ),
            normalized_text: "Cradle Chronicle visible text".to_string(),
            captured_at: Timestamp::from_seconds(1_779_125_791),
        }
    }
}
