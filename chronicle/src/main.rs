//! CLI entry point for Cradle Chronicle.

use std::io::Read;
use std::process::ExitCode;

use cradle_chronicle::audio::record_microphone_diagnostics;
use cradle_chronicle::config::{ChronicleConfig, usage};
use cradle_chronicle::daemon;
use cradle_chronicle::memory_pipeline::recursive::RecursiveSummarizer;
use cradle_chronicle::memory_pipeline::summarizer::LocalSummaryWriter;
use cradle_chronicle::ocr::ObservedTextExtractor;
use cradle_chronicle::recorder::artifacts::ArtifactStore;
use cradle_chronicle::screen::synthetic::SyntheticCaptureSource;
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
    if std::env::args().any(|arg| arg == "--embed-texts") {
        return run_embedding_batch();
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
        "Cradle Chronicle requires --smoke, --daemon, --audio-diagnostics, or --embed-texts"
            .to_string(),
    ))
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

    let runtime = cradle_chronicle::onnx::OnnxRuntime::new();
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
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let source = SyntheticCaptureSource::cradle_smoke_from(
        config.display_id.unwrap_or(1),
        config.capture_limit,
        segment_started_at,
    );
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    let report = manager.run_until_exhausted()?;

    let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, memories_dir);
    let summary = summarizer
        .write_ten_minute_summary("Cradle Chronicle smoke", report.persisted_frames.clone())?;

    Ok(format!(
        "cradle chronicle smoke completed: observed={} persisted={} duplicates={} privacy_filtered={} memory={}",
        report.observed_frames,
        report.persisted_frames.len(),
        report.duplicate_frames,
        report.privacy_filtered_frames,
        summary.output_path.display()
    ))
}
