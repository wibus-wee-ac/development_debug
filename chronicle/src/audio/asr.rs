//! Automatic Speech Recognition integration for Chronicle.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};

/// Configuration for ASR.
#[derive(Debug, Clone)]
pub struct AsrConfig {
    pub base_url: String,
    pub language: Option<String>,
    pub model: String,
}

impl Default for AsrConfig {
    fn default() -> Self {
        Self {
            base_url: crate::cradle_client::DEFAULT_CRADLE_URL.to_string(),
            language: None,
            model: "sense-voice".to_string(),
        }
    }
}

/// A transcription result from ASR.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub language: Option<String>,
    pub confidence: f64,
    pub duration_ms: u64,
    pub segments: Vec<TranscriptionSegment>,
    #[serde(default)]
    pub speaker_profiles: Vec<SpeakerProfileCandidate>,
}

impl TranscriptionResult {
    fn empty() -> Self {
        Self {
            text: String::new(),
            language: None,
            confidence: 0.0,
            duration_ms: 0,
            segments: Vec::new(),
            speaker_profiles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptionRuntime {
    SenseVoiceOnnx,
    WhisperCpp,
}

impl TranscriptionRuntime {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SenseVoiceOnnx => "sense-voice-onnx",
            Self::WhisperCpp => "whisper-cpp",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerProfileCandidate {
    pub display_name: String,
    pub embedding: Vec<f32>,
    pub embedding_model_id: String,
    pub sample_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub confidence: f64,
    pub speaker_label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TranscriptionPipelineOutput {
    pub result: TranscriptionResult,
    pub runtime: TranscriptionRuntime,
}

/// whisper.cpp CLI fallback for ASR.
///
/// This adapter never fabricates transcripts. If the binary or model is not
/// configured, callers receive a normal error and can report the fallback as
/// unavailable.
pub struct WhisperCliAsr {
    binary_path: PathBuf,
    model_path: PathBuf,
    extra_args: Vec<String>,
}

impl WhisperCliAsr {
    pub fn from_env() -> ChronicleResult<Self> {
        let binary_path = whisper_binary_path()?;
        let model_path = whisper_model_path()?;
        let extra_args = std::env::var("CRADLE_CHRONICLE_WHISPER_ARGS")
            .ok()
            .map(|value| split_whisper_args(&value))
            .unwrap_or_default();
        Ok(Self {
            binary_path,
            model_path,
            extra_args,
        })
    }

    pub fn new(binary_path: impl Into<PathBuf>, model_path: impl Into<PathBuf>) -> Self {
        Self {
            binary_path: binary_path.into(),
            model_path: model_path.into(),
            extra_args: Vec::new(),
        }
    }

    pub fn with_extra_args(mut self, args: Vec<String>) -> Self {
        self.extra_args = args;
        self
    }

    pub fn transcribe_wav(
        &self,
        wav_path: &Path,
        duration_ms: u64,
    ) -> ChronicleResult<TranscriptionResult> {
        if !self.binary_path.exists() {
            return Err(ChronicleError::Process(format!(
                "whisper fallback binary is not installed at {}",
                self.binary_path.display()
            )));
        }
        if !self.model_path.exists() {
            return Err(ChronicleError::Process(format!(
                "whisper fallback model is not installed at {}",
                self.model_path.display()
            )));
        }
        if !wav_path.exists() {
            return Err(ChronicleError::Process(format!(
                "whisper fallback input WAV is not available at {}",
                wav_path.display()
            )));
        }

        let output = Command::new(&self.binary_path)
            .arg("-m")
            .arg(&self.model_path)
            .arg("-f")
            .arg(wav_path)
            .arg("-nt")
            .arg("-np")
            .args(&self.extra_args)
            .output()
            .map_err(|error| {
                ChronicleError::Process(format!(
                    "failed to start whisper fallback {}: {error}",
                    self.binary_path.display()
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(ChronicleError::Process(if stderr.is_empty() {
                format!("whisper fallback exited with status {}", output.status)
            } else {
                stderr
            }));
        }

        let stdout = String::from_utf8(output.stdout).map_err(ChronicleError::Utf8)?;
        let text = parse_whisper_stdout(&stdout);
        if text.is_empty() {
            return Ok(TranscriptionResult::empty());
        }
        Ok(TranscriptionResult {
            text: text.clone(),
            language: None,
            confidence: 0.5,
            duration_ms,
            segments: vec![TranscriptionSegment {
                start_ms: 0,
                end_ms: duration_ms,
                text,
                confidence: 0.5,
                speaker_label: None,
            }],
            speaker_profiles: Vec::new(),
        })
    }
}

/// Request payload sent to Cradle Server.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeRequest {
    samples_base64: String,
    sample_rate: u32,
    language: Option<String>,
    model: String,
}

/// Remote ASR client that delegates to Cradle Server.
pub struct RemoteAsr {
    config: AsrConfig,
}

impl RemoteAsr {
    pub fn new(config: AsrConfig) -> Self {
        Self { config }
    }

    pub fn from_env() -> Self {
        let base_url = crate::cradle_client::cradle_base_url();
        Self::new(AsrConfig {
            base_url,
            ..AsrConfig::default()
        })
    }

    /// Transcribe PCM audio samples (f32, 16kHz, mono).
    /// Sends to Cradle Server POST /chronicle/transcribe
    pub fn transcribe(
        &self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<TranscriptionResult> {
        let pcm_bytes = samples_to_le_bytes(samples);
        let samples_base64 = base64_encode(&pcm_bytes);

        let request_body = TranscribeRequest {
            samples_base64,
            sample_rate,
            language: self.config.language.clone(),
            model: self.config.model.clone(),
        };

        let url = format!("{}/chronicle/transcribe", self.config.base_url);
        let body = serde_json::to_vec(&request_body)
            .map_err(|e| ChronicleError::Process(format!("serialize request: {e}")))?;

        let response = ureq::post(&url)
            .header("content-type", "application/json")
            .send(&body[..]);

        match response {
            Ok(mut resp) => {
                let text = resp
                    .body_mut()
                    .read_to_string()
                    .map_err(|e| ChronicleError::Process(format!("read response: {e}")))?;
                let result: TranscriptionResult = serde_json::from_str(&text)
                    .map_err(|e| ChronicleError::Process(format!("parse response: {e}")))?;
                Ok(result)
            }
            Err(_) => {
                // Graceful degradation: server unreachable → empty transcription
                Ok(TranscriptionResult::empty())
            }
        }
    }
}

/// Combines VAD + ASR into a full audio processing pipeline.
pub struct AudioTranscriptionPipeline {
    vad: super::vad::EnergyVad,
    asr: RemoteAsr,
}

impl AudioTranscriptionPipeline {
    pub fn new(vad: super::vad::EnergyVad, asr: RemoteAsr) -> Self {
        Self { vad, asr }
    }

    pub fn from_env() -> Self {
        Self {
            vad: super::vad::EnergyVad::new(super::vad::VadConfig::default()),
            asr: RemoteAsr::from_env(),
        }
    }

    /// Process raw audio: VAD → extract speech segments → ASR each segment → combine.
    pub fn process(
        &self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<TranscriptionResult> {
        let segments = self.vad.detect(samples);

        if segments.is_empty() {
            return Ok(TranscriptionResult::empty());
        }

        let mut combined_text = String::new();
        let mut all_segments: Vec<TranscriptionSegment> = Vec::new();
        let mut total_confidence = 0.0;
        let mut successful_count = 0u32;

        for seg in &segments {
            let audio_slice = self.vad.extract_segment(samples, seg);
            match self.asr.transcribe(audio_slice, sample_rate) {
                Ok(result) if !result.text.is_empty() => {
                    if !combined_text.is_empty() {
                        combined_text.push(' ');
                    }
                    combined_text.push_str(&result.text);
                    total_confidence += result.confidence;
                    successful_count += 1;

                    // Offset segment timestamps relative to full audio
                    for mut tseg in result.segments {
                        tseg.start_ms += seg.start_ms;
                        tseg.end_ms += seg.start_ms;
                        all_segments.push(tseg);
                    }
                }
                Ok(_) => {}  // Empty result, skip
                Err(_) => {} // Graceful degradation
            }
        }

        let avg_confidence = if successful_count > 0 {
            total_confidence / successful_count as f64
        } else {
            0.0
        };

        let duration_ms = segments.last().map(|s| s.end_ms).unwrap_or(0);

        Ok(TranscriptionResult {
            text: combined_text,
            language: None,
            confidence: avg_confidence,
            duration_ms,
            segments: all_segments,
            speaker_profiles: Vec::new(),
        })
    }
}

/// Convert f32 samples to little-endian bytes (as f32 IEEE 754).
fn samples_to_le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Simple base64 encoding (standard alphabet, with padding).
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    let chunks = data.chunks(3);

    for chunk in chunks {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

/// Local ONNX-based audio transcription pipeline.
///
/// Uses Silero VAD (ONNX) + SenseVoice ASR (ONNX) for fully offline transcription.
pub struct LocalTranscriptionPipeline<'a> {
    runtime: &'a crate::onnx::OnnxRuntime,
}

impl<'a> LocalTranscriptionPipeline<'a> {
    pub fn new(runtime: &'a crate::onnx::OnnxRuntime) -> Self {
        Self { runtime }
    }

    /// Process raw audio: local VAD → extract speech → local ASR → combine.
    pub fn process(
        &self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<TranscriptionResult> {
        let processed_samples;
        let (samples, sample_rate) = if sample_rate == 16_000 {
            (samples, sample_rate)
        } else {
            processed_samples = resample_linear(samples, sample_rate, 16_000);
            (processed_samples.as_slice(), 16_000)
        };

        // VAD
        let vad_cell = self.runtime.vad()?;
        let mut segments = vad_cell.borrow_mut().detect_speech(samples, sample_rate)?;
        if segments.is_empty() {
            segments = super::vad::EnergyVad::new(super::vad::VadConfig {
                energy_threshold: 0.001,
                sample_rate,
                ..super::vad::VadConfig::default()
            })
            .detect(samples);
        }

        if segments.is_empty() {
            return Ok(TranscriptionResult::empty());
        }

        // ASR each speech segment
        let asr_cell = self.runtime.asr()?;
        let mut combined_text = String::new();
        let mut all_segments: Vec<TranscriptionSegment> = Vec::new();
        let mut speaker_clusters: Vec<SpeakerCluster> = Vec::new();
        let mut total_confidence = 0.0;
        let mut successful_count = 0u32;

        for seg in &segments {
            let start = seg.start_sample;
            let end = seg.end_sample.min(samples.len());
            if start >= end {
                continue;
            }
            let audio_slice = &samples[start..end];

            match asr_cell.borrow_mut().transcribe(audio_slice, sample_rate) {
                Ok(result) if !result.text.is_empty() => {
                    let speaker_label = assign_speaker_label(
                        &mut speaker_clusters,
                        self.runtime,
                        audio_slice,
                        sample_rate,
                    );
                    if !combined_text.is_empty() {
                        combined_text.push(' ');
                    }
                    combined_text.push_str(&result.text);
                    total_confidence += result
                        .tokens
                        .iter()
                        .map(|t| t.confidence as f64)
                        .sum::<f64>()
                        / result.tokens.len().max(1) as f64;
                    successful_count += 1;

                    all_segments.push(TranscriptionSegment {
                        start_ms: seg.start_ms,
                        end_ms: seg.end_ms,
                        text: result.text,
                        confidence: total_confidence / successful_count as f64,
                        speaker_label,
                    });
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }

        let avg_confidence = if successful_count > 0 {
            total_confidence / successful_count as f64
        } else {
            0.0
        };

        let duration_ms = segments.last().map(|s| s.end_ms).unwrap_or(0);

        Ok(TranscriptionResult {
            text: combined_text,
            language: None,
            confidence: avg_confidence,
            duration_ms,
            segments: all_segments,
            speaker_profiles: speaker_clusters
                .into_iter()
                .map(|cluster| SpeakerProfileCandidate {
                    display_name: cluster.label,
                    embedding: cluster.centroid,
                    embedding_model_id: cluster.embedding_model_id,
                    sample_count: cluster.sample_count,
                })
                .collect(),
        })
    }

    pub fn process_wav_with_fallback(
        &self,
        samples: &[f32],
        sample_rate: u32,
        wav_path: &Path,
    ) -> ChronicleResult<TranscriptionPipelineOutput> {
        let fallback_duration_ms = audio_duration_ms(samples.len(), sample_rate);
        match self.process(samples, sample_rate) {
            Ok(result) if !result.text.trim().is_empty() => Ok(TranscriptionPipelineOutput {
                result,
                runtime: TranscriptionRuntime::SenseVoiceOnnx,
            }),
            Ok(result) => match WhisperCliAsr::from_env()
                .and_then(|whisper| whisper.transcribe_wav(wav_path, fallback_duration_ms))
            {
                Ok(fallback) if !fallback.text.trim().is_empty() => {
                    Ok(TranscriptionPipelineOutput {
                        result: fallback,
                        runtime: TranscriptionRuntime::WhisperCpp,
                    })
                }
                Ok(_) | Err(_) => Ok(TranscriptionPipelineOutput {
                    result,
                    runtime: TranscriptionRuntime::SenseVoiceOnnx,
                }),
            },
            Err(local_error) => match WhisperCliAsr::from_env()
                .and_then(|whisper| whisper.transcribe_wav(wav_path, fallback_duration_ms))
            {
                Ok(fallback) if !fallback.text.trim().is_empty() => {
                    Ok(TranscriptionPipelineOutput {
                        result: fallback,
                        runtime: TranscriptionRuntime::WhisperCpp,
                    })
                }
                _ => Err(local_error),
            },
        }
    }
}

struct SpeakerCluster {
    label: String,
    centroid: Vec<f32>,
    embedding_model_id: String,
    sample_count: u32,
}

fn assign_speaker_label(
    clusters: &mut Vec<SpeakerCluster>,
    runtime: &crate::onnx::OnnxRuntime,
    samples: &[f32],
    sample_rate: u32,
) -> Option<String> {
    let speaker_cell = runtime.speaker().ok()?;
    let embedding = speaker_cell.borrow_mut().embed(samples, sample_rate).ok()?;
    let best = clusters
        .iter()
        .enumerate()
        .map(|(index, cluster)| {
            (
                index,
                cosine_similarity(&cluster.centroid, &embedding.vector),
            )
        })
        .max_by(|left, right| {
            left.1
                .partial_cmp(&right.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    if let Some((index, score)) = best
        && score >= 0.72
    {
        let cluster = &mut clusters[index];
        merge_centroid(
            &mut cluster.centroid,
            &embedding.vector,
            cluster.sample_count,
        );
        cluster.sample_count += 1;
        return Some(cluster.label.clone());
    }

    let label = format!("Speaker {}", clusters.len() + 1);
    clusters.push(SpeakerCluster {
        label: label.clone(),
        centroid: embedding.vector,
        embedding_model_id: embedding.model_id.to_string(),
        sample_count: 1,
    });
    Some(label)
}

fn merge_centroid(centroid: &mut [f32], vector: &[f32], sample_count: u32) {
    let previous_weight = sample_count as f32;
    let next_weight = previous_weight + 1.0;
    for (current, value) in centroid.iter_mut().zip(vector) {
        *current = ((*current * previous_weight) + *value) / next_weight;
    }
    normalize_centroid(centroid);
}

fn normalize_centroid(vector: &mut [f32]) {
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    if norm <= f64::EPSILON || !norm.is_finite() {
        return;
    }
    for value in vector {
        *value = (*value as f64 / norm) as f32;
    }
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }
    let ratio = source_rate as f64 / target_rate as f64;
    let output_len = ((samples.len() as f64) / ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source_position = index as f64 * ratio;
        let left = source_position.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let fraction = (source_position - left as f64) as f32;
        output.push(samples[left] * (1.0 - fraction) + samples[right] * fraction);
    }
    output
}

fn audio_duration_ms(sample_count: usize, sample_rate: u32) -> u64 {
    if sample_rate == 0 {
        return 0;
    }
    ((sample_count as f64 / sample_rate as f64) * 1_000.0).round() as u64
}

fn whisper_binary_path() -> ChronicleResult<PathBuf> {
    if let Some(path) = env_path("CRADLE_CHRONICLE_WHISPER_BIN") {
        return Ok(path);
    }

    let candidates = [
        "whisper-cli",
        "whisper",
        "main",
        "build/bin/whisper-cli",
        "build/bin/whisper",
        "build/bin/main",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(ChronicleError::Process(
        "whisper fallback requires CRADLE_CHRONICLE_WHISPER_BIN or a local whisper.cpp binary"
            .to_string(),
    ))
}

fn whisper_model_path() -> ChronicleResult<PathBuf> {
    if let Some(path) = env_path("CRADLE_CHRONICLE_WHISPER_MODEL") {
        return Ok(path);
    }

    let models_dir = std::env::var("CRADLE_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".cradle")
                .join("chronicle")
                .join("models")
        });
    let candidates = [
        "audio-asr/whisper/ggml-base.bin",
        "audio-asr/whisper/ggml-base.en.bin",
        "whisper/ggml-base.bin",
        "whisper/ggml-base.en.bin",
    ];
    for candidate in candidates {
        let path = models_dir.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(ChronicleError::Process(format!(
        "whisper fallback model is not installed under {}; set CRADLE_CHRONICLE_WHISPER_MODEL",
        models_dir.display()
    )))
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn split_whisper_args(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn parse_whisper_stdout(stdout: &str) -> String {
    stdout
        .lines()
        .filter_map(parse_whisper_line)
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_whisper_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("whisper_")
        || trimmed.starts_with("system_info:")
        || trimmed.starts_with("main:")
    {
        return None;
    }

    if let Some(close_index) = trimmed.find(']') {
        let prefix = &trimmed[..=close_index];
        if prefix.starts_with('[') && prefix.contains("-->") {
            let text = trimmed[close_index + 1..].trim();
            return (!text.is_empty()).then(|| text.to_string());
        }
    }

    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_whisper_timestamp_output() {
        let stdout = r#"
whisper_init_from_file_with_params_no_state: loading model
[00:00:00.000 --> 00:00:01.000] Hello
[00:00:01.000 --> 00:00:02.000] world.
main: processing completed
"#;

        assert_eq!(parse_whisper_stdout(stdout), "Hello world.");
    }

    #[test]
    fn splits_whisper_args_by_whitespace() {
        assert_eq!(
            split_whisper_args("--language en --threads 4"),
            vec!["--language", "en", "--threads", "4"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn whisper_cli_adapter_executes_real_binary() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("temp dir should be created");
        let binary = temp.path().join("whisper-cli");
        let model = temp.path().join("ggml-test.bin");
        let wav = temp.path().join("input.wav");
        fs::write(&model, b"model").expect("model should be written");
        fs::write(&wav, b"wav").expect("wav should be written");
        fs::write(
            &binary,
            "#!/bin/sh\nprintf '[00:00:00.000 --> 00:00:01.000] Real fallback text\\n'\n",
        )
        .expect("binary should be written");
        let mut permissions = fs::metadata(&binary)
            .expect("binary metadata should be read")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("binary should be executable");

        let result = WhisperCliAsr::new(&binary, &model)
            .transcribe_wav(&wav, 1_000)
            .expect("fake whisper binary should run");

        assert_eq!(result.text, "Real fallback text");
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.duration_ms, 1_000);
    }

    #[test]
    fn whisper_cli_adapter_reports_missing_paths() {
        let temp = tempfile::tempdir().expect("temp dir should be created");
        let result = WhisperCliAsr::new(
            temp.path().join("missing-bin"),
            temp.path().join("missing-model"),
        )
        .transcribe_wav(&temp.path().join("missing.wav"), 0);

        assert!(result.is_err());
    }
}
