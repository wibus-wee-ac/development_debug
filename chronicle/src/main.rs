//! CLI entry point for Cradle Chronicle.

use std::io::Read;
use std::process::{Command, ExitCode, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use cradle_chronicle::audio::record_microphone_diagnostics;
use cradle_chronicle::capabilities::{LocalSummaryCapability, NoopIntegrationSink};
use cradle_chronicle::config::{ChronicleConfig, usage};
use cradle_chronicle::core::ChronicleCore;
use cradle_chronicle::daemon;
use cradle_chronicle::memory_pipeline::recursive::RecursiveSummarizer;
use cradle_chronicle::memory_pipeline::summarizer::LocalSummaryWriter;
use cradle_chronicle::ocr::ObservedTextExtractor;
use cradle_chronicle::recorder::artifacts::ArtifactStore;
use cradle_chronicle::screen::privacy_filter::{PrivacyFilter, PrivacyFilterRules};
use cradle_chronicle::screen::synthetic::SyntheticCaptureSource;
use cradle_chronicle::store::{ChronicleMemoryManifest, ChronicleStore, ChronicleStoreEvent};
use cradle_chronicle::time::Timestamp;
use cradle_chronicle::{ChronicleError, RecorderManager};

fn main() -> ExitCode {
    match run() {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            if matches!(error, ChronicleError::InvalidArgument(_)) {
                eprintln!("{}", usage());
            }
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<String, ChronicleError> {
    if std::env::args().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(usage());
    }
    if let Some(wav_path) = internal_speaker_wav_path() {
        return run_speaker_wav_embedding_unbounded(&wav_path);
    }
    if let Some(wav_path) = internal_transcribe_wav_path() {
        return run_wav_transcription_unbounded(&wav_path);
    }
    if let Some(model_path) = internal_onnx_inspect_path() {
        return cradle_chronicle::onnx::inspect_model(&model_path);
    }
    if internal_embed_texts_requested() {
        return run_embedding_batch();
    }
    if internal_redact_pii_requested() {
        return run_pii_redaction();
    }
    if embed_texts_requested() {
        return run_bounded_stdin_local_model_diagnostic("--internal-embed-texts");
    }
    if redact_pii_requested() {
        return run_bounded_stdin_local_model_diagnostic("--internal-redact-pii");
    }
    if let Some(wav_path) = speaker_wav_path() {
        return run_bounded_local_model_diagnostic("--internal-embed-speaker-wav", &wav_path);
    }
    if let Some(wav_path) = transcribe_wav_path() {
        return run_bounded_local_model_diagnostic("--internal-transcribe-wav", &wav_path);
    }
    if let Some(model_path) = onnx_inspect_path() {
        return run_bounded_local_model_diagnostic("--internal-inspect-onnx", &model_path);
    }

    let config = ChronicleConfig::from_env_args()?;
    if config.smoke {
        return run_smoke(config);
    }
    if config.audio_diagnostics {
        return run_audio_diagnostics(config);
    }
    if config.daemon {
        return daemon::run(config);
    }
    Err(ChronicleError::InvalidArgument(
        "Cradle Chronicle requires --smoke, --daemon, --audio-diagnostics, --embed-texts, --redact-pii, --transcribe-wav, --embed-speaker-wav, or --inspect-onnx".to_string(),
    ))
}

fn onnx_inspect_path() -> Option<std::path::PathBuf> {
    flag_value("--inspect-onnx")
}

fn internal_onnx_inspect_path() -> Option<std::path::PathBuf> {
    flag_value("--internal-inspect-onnx")
}

fn speaker_wav_path() -> Option<std::path::PathBuf> {
    flag_value("--embed-speaker-wav")
}

fn internal_speaker_wav_path() -> Option<std::path::PathBuf> {
    flag_value("--internal-embed-speaker-wav")
}

fn transcribe_wav_path() -> Option<std::path::PathBuf> {
    flag_value("--transcribe-wav")
}

fn internal_transcribe_wav_path() -> Option<std::path::PathBuf> {
    flag_value("--internal-transcribe-wav")
}

fn embed_texts_requested() -> bool {
    std::env::args().any(|arg| arg == "--embed-texts")
}

fn internal_embed_texts_requested() -> bool {
    std::env::args().any(|arg| arg == "--internal-embed-texts")
}

fn redact_pii_requested() -> bool {
    std::env::args().any(|arg| arg == "--redact-pii")
}

fn internal_redact_pii_requested() -> bool {
    std::env::args().any(|arg| arg == "--internal-redact-pii")
}

fn flag_value(flag: &str) -> Option<std::path::PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == flag {
            return args.next().map(std::path::PathBuf::from);
        }
    }
    None
}

fn local_diagnostic_timeout() -> Duration {
    let millis = std::env::var("CRADLE_CHRONICLE_LOCAL_DIAGNOSTIC_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(30_000);
    Duration::from_millis(millis)
}

fn run_bounded_stdin_local_model_diagnostic(internal_flag: &str) -> Result<String, ChronicleError> {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).map_err(|error| {
        ChronicleError::Process(format!("failed to read diagnostic input: {error}"))
    })?;

    let executable = std::env::current_exe().map_err(|error| {
        ChronicleError::Process(format!("failed to resolve current executable: {error}"))
    })?;
    let timeout = local_diagnostic_timeout();
    let mut child = Command::new(executable)
        .arg(internal_flag)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ChronicleError::Process(format!("failed to start local model diagnostic: {error}"))
        })?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        ChronicleError::Process("failed to open local model diagnostic stdin".to_string())
    })?;
    thread::spawn(move || {
        use std::io::Write;
        let _ = stdin.write_all(&input);
    });

    wait_for_bounded_child(child, timeout)
}

fn run_bounded_local_model_diagnostic(
    internal_flag: &str,
    path: &std::path::Path,
) -> Result<String, ChronicleError> {
    let executable = std::env::current_exe().map_err(|error| {
        ChronicleError::Process(format!("failed to resolve current executable: {error}"))
    })?;
    let timeout = local_diagnostic_timeout();
    let child = Command::new(executable)
        .arg(internal_flag)
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ChronicleError::Process(format!("failed to start local model diagnostic: {error}"))
        })?;

    wait_for_bounded_child(child, timeout)
}

fn wait_for_bounded_child(
    mut child: std::process::Child,
    timeout: Duration,
) -> Result<String, ChronicleError> {
    let started_at = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| {
                ChronicleError::Process(format!("failed to poll local model diagnostic: {error}"))
            })?
            .is_some()
        {
            let output = child.wait_with_output().map_err(|error| {
                ChronicleError::Process(format!(
                    "failed to read local model diagnostic output: {error}"
                ))
            })?;
            return child_output_to_result(output);
        }
        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let output = child.wait_with_output().map_err(|error| {
                ChronicleError::Process(format!(
                    "failed to read timed out local model diagnostic output: {error}"
                ))
            })?;
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(ChronicleError::Process(format!(
                "local model diagnostic timed out after {} ms{}",
                timeout.as_millis(),
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!("; stderr: {stderr}")
                }
            )));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn child_output_to_result(output: std::process::Output) -> Result<String, ChronicleError> {
    if output.status.success() {
        String::from_utf8(output.stdout)
            .map(|text| text.trim_end().to_string())
            .map_err(ChronicleError::Utf8)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(ChronicleError::Process(if stderr.is_empty() {
            format!(
                "local model diagnostic exited with status {}",
                output.status
            )
        } else {
            stderr
        }))
    }
}

fn run_wav_transcription_unbounded(path: &std::path::Path) -> Result<String, ChronicleError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TranscriptionResponse {
        runtime: cradle_chronicle::audio::TranscriptionRuntime,
        result: cradle_chronicle::audio::TranscriptionResult,
    }

    let (raw_samples, source_sample_rate) = read_mono_wav(path)?;
    let samples = if source_sample_rate == 16_000 {
        raw_samples
    } else {
        resample_linear(&raw_samples, source_sample_rate, 16_000)
    };
    let runtime = cradle_chronicle::onnx::OnnxRuntime::new_local_only();
    let pipeline = cradle_chronicle::audio::LocalTranscriptionPipeline::new(&runtime);
    let output = pipeline.process_wav_with_fallback(&samples, 16_000, path)?;
    let response = TranscriptionResponse {
        runtime: output.runtime,
        result: output.result,
    };
    serde_json::to_string(&response).map_err(|error| {
        ChronicleError::Process(format!(
            "failed to serialize transcription response: {error}"
        ))
    })
}

fn run_speaker_wav_embedding_unbounded(path: &std::path::Path) -> Result<String, ChronicleError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SpeakerEmbeddingResponse {
        model_id: &'static str,
        model_version: &'static str,
        sample_rate: u32,
        sample_count: usize,
        dimensions: usize,
        norm: f64,
        first_values: Vec<f32>,
    }

    let (raw_samples, source_sample_rate) = read_mono_wav(path)?;
    let samples = if source_sample_rate == 16_000 {
        raw_samples
    } else {
        resample_linear(&raw_samples, source_sample_rate, 16_000)
    };
    let runtime = cradle_chronicle::onnx::OnnxRuntime::new_local_only();
    let speaker = runtime.speaker()?;
    let embedding = speaker.borrow_mut().embed(&samples, 16_000)?;
    let norm = embedding
        .vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    let response = SpeakerEmbeddingResponse {
        model_id: embedding.model_id,
        model_version: embedding.model_version,
        sample_rate: 16_000,
        sample_count: samples.len(),
        dimensions: embedding.dimensions,
        norm,
        first_values: embedding.vector.iter().take(5).copied().collect(),
    };
    serde_json::to_string(&response).map_err(|error| {
        ChronicleError::Process(format!(
            "failed to serialize speaker embedding response: {error}"
        ))
    })
}

fn read_mono_wav(path: &std::path::Path) -> Result<(Vec<f32>, u32), ChronicleError> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|error| ChronicleError::Process(format!("failed to open WAV: {error}")))?;
    let spec = reader.spec();
    if spec.channels == 0 {
        return Err(ChronicleError::InvalidArgument(
            "WAV must have at least one channel".to_string(),
        ));
    }

    let channels = spec.channels as usize;
    let samples = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 16) => {
            let values = reader
                .samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| ChronicleError::Process(format!("failed to read WAV: {error}")))?;
            downmix_i16_to_mono(&values, channels)
        }
        (hound::SampleFormat::Float, 32) => {
            let values = reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| ChronicleError::Process(format!("failed to read WAV: {error}")))?;
            downmix_f32_to_mono(&values, channels)
        }
        _ => {
            return Err(ChronicleError::InvalidArgument(format!(
                "unsupported WAV format: {:?} {} bits",
                spec.sample_format, spec.bits_per_sample
            )));
        }
    };
    Ok((samples, spec.sample_rate))
}

fn downmix_i16_to_mono(values: &[i16], channels: usize) -> Vec<f32> {
    values
        .chunks(channels)
        .map(|frame| {
            frame
                .iter()
                .map(|sample| *sample as f32 / i16::MAX as f32)
                .sum::<f32>()
                / frame.len().max(1) as f32
        })
        .collect()
}

fn downmix_f32_to_mono(values: &[f32], channels: usize) -> Vec<f32> {
    values
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len().max(1) as f32)
        .collect()
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

fn run_embedding_batch() -> Result<String, ChronicleError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EmbeddingRequest {
        texts: Vec<String>,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct EmbeddingResponse {
        model_id: &'static str,
        model_version: &'static str,
        dimensions: usize,
        embeddings: Vec<Vec<f32>>,
    }

    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| {
            ChronicleError::Process(format!("failed to read embedding request: {error}"))
        })?;
    let request: EmbeddingRequest = serde_json::from_str(&input).map_err(|error| {
        ChronicleError::InvalidArgument(format!("invalid embedding request: {error}"))
    })?;
    if request.texts.is_empty() {
        return Err(ChronicleError::InvalidArgument(
            "embedding request requires at least one text".to_string(),
        ));
    }

    let runtime = cradle_chronicle::onnx::OnnxRuntime::new_local_only();
    let model = runtime.embedding()?;
    let embeddings = model
        .borrow_mut()
        .embed_batch(&request.texts.iter().map(String::as_str).collect::<Vec<_>>())?;
    let response = EmbeddingResponse {
        model_id: "all-MiniLM-L6-v2",
        model_version: "onnx-minilm-l6-v2",
        dimensions: model.borrow().dim(),
        embeddings,
    };
    serde_json::to_string(&response).map_err(|error| {
        ChronicleError::Process(format!("failed to serialize embedding response: {error}"))
    })
}

fn run_pii_redaction() -> Result<String, ChronicleError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PiiRequest {
        text: String,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PiiSpanResponse {
        entity_type: String,
        text: String,
        start: usize,
        end: usize,
        confidence: f32,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PiiResponse {
        model_id: &'static str,
        model_version: &'static str,
        redacted_text: String,
        spans: Vec<PiiSpanResponse>,
    }

    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| ChronicleError::Process(format!("failed to read PII request: {error}")))?;
    let request: PiiRequest = serde_json::from_str(&input).map_err(|error| {
        ChronicleError::InvalidArgument(format!("invalid PII request: {error}"))
    })?;
    if request.text.trim().is_empty() {
        return Err(ChronicleError::InvalidArgument(
            "PII request requires non-empty text".to_string(),
        ));
    }

    let runtime = cradle_chronicle::onnx::OnnxRuntime::new_local_only();
    let detector = runtime.pii()?;
    let spans = detector.borrow_mut().detect(&request.text)?;
    let redacted_text = cradle_chronicle::onnx::pii::redact_with_spans(&request.text, &spans);
    let response = PiiResponse {
        model_id: "gliner-pii-base",
        model_version: "gliner-pii-base-v1.0",
        redacted_text,
        spans: spans
            .into_iter()
            .map(|span| PiiSpanResponse {
                entity_type: span.entity_type.to_string(),
                text: span.text,
                start: span.start,
                end: span.end,
                confidence: span.confidence,
            })
            .collect(),
    };
    serde_json::to_string(&response).map_err(|error| {
        ChronicleError::Process(format!("failed to serialize PII response: {error}"))
    })
}

fn run_audio_diagnostics(config: ChronicleConfig) -> Result<String, ChronicleError> {
    let report = record_microphone_diagnostics(
        &config.storage_root,
        config.audio_duration_ms,
        config.audio_rms_threshold,
    )?;
    Ok(format!(
        "cradle chronicle audio diagnostics completed: device={} sample_rate={} channels={} samples={} dropped={} rms={:.6} peak={:.6} active={} wav={} metadata={}",
        report.device_name,
        report.sample_rate,
        report.channels,
        report.sample_count,
        report.dropped_samples,
        report.activity.rms,
        report.activity.peak,
        report.activity.active,
        report.artifact.wav_path.display(),
        report.artifact.metadata_path.display()
    ))
}

fn run_smoke(config: ChronicleConfig) -> Result<String, ChronicleError> {
    let segment_started_at = Timestamp::now()?;
    let core = ChronicleCore::new(
        ChronicleStore::new(&config.storage_root),
        LocalSummaryCapability,
        NoopIntegrationSink,
    );
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let source = SyntheticCaptureSource::cradle_smoke_from(
        config.display_id.unwrap_or(1),
        config.capture_limit,
        segment_started_at,
    );
    let mut manager = RecorderManager::with_privacy_filter(
        source,
        ObservedTextExtractor,
        store,
        PrivacyFilter::new(PrivacyFilterRules {
            app_bundle_ids: config.privacy_sensitive_app_bundle_ids,
            title_patterns: config.privacy_sensitive_title_patterns,
            url_patterns: config.privacy_sensitive_url_patterns,
        }),
    );
    let report = manager.run_until_exhausted()?;

    let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, memories_dir);
    let summary = summarizer
        .write_ten_minute_summary("Cradle Chronicle smoke", report.persisted_frames.clone())?;
    let source_paths = report
        .persisted_frames
        .iter()
        .flat_map(|frame| [frame.snapshot_path.clone(), frame.frame_path.clone()])
        .collect::<Vec<_>>();
    core.append_event(ChronicleStoreEvent {
        id: format!("smoke-capture-{}", segment_started_at.compact()),
        kind: "smoke-capture".to_string(),
        created_at: segment_started_at.filesystem(),
        payload: serde_json::json!({
            "observed": report.observed_frames,
            "persisted": report.persisted_frames.len(),
            "duplicates": report.duplicate_frames,
            "privacyFiltered": report.privacy_filtered_frames
        }),
    })?;
    core.record_memory(ChronicleMemoryManifest {
        id: format!("memory:{}", summary.output_path.display()),
        window: "10min".to_string(),
        created_at: segment_started_at.filesystem(),
        memory_path: summary.output_path.clone(),
        source_paths,
        summary_kind: "local".to_string(),
    })?;

    Ok(format!(
        "cradle chronicle smoke completed: observed={} persisted={} duplicates={} privacy_filtered={} memory={}",
        report.observed_frames,
        report.persisted_frames.len(),
        report.duplicate_frames,
        report.privacy_filtered_frames,
        summary.output_path.display()
    ))
}
