//! Automatic Speech Recognition integration for Chronicle.

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
}

impl TranscriptionResult {
    fn empty() -> Self {
        Self {
            text: String::new(),
            language: None,
            confidence: 0.0,
            duration_ms: 0,
            segments: Vec::new(),
        }
    }
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
        // VAD
        let vad_cell = self.runtime.vad()?;
        let segments = vad_cell.borrow_mut().detect_speech(samples, sample_rate)?;

        if segments.is_empty() {
            return Ok(TranscriptionResult::empty());
        }

        // ASR each speech segment
        let asr_cell = self.runtime.asr()?;
        let mut combined_text = String::new();
        let mut all_segments: Vec<TranscriptionSegment> = Vec::new();
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
                        speaker_label: None,
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
        })
    }
}
