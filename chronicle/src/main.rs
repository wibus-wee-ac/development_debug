//! CLI entry point for Cradle Chronicle.
//!
//! Input: smoke, daemon, storage-root, and inbox-root CLI flags.
//! Output: local Chronicle artifacts and memory files.
//! Position: binary wrapper around the library pipeline and desktop daemon bridge.

use std::process::ExitCode;

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
    let config = ChronicleConfig::from_env_args()?;
    if config.smoke {
        return run_smoke(config);
    }
    if config.daemon {
        return daemon::run(config);
    }
    Err(ChronicleError::InvalidArgument(
        "Cradle Chronicle requires --smoke or --daemon".to_string(),
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
