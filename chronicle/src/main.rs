//! CLI entry point for Cradle Chronicle.
//!
//! Input: smoke and storage-root CLI flags.
//! Output: local Chronicle artifacts and a memory file.
//! Position: thin binary wrapper around the library pipeline.

use std::process::ExitCode;

use cradle_chronicle::config::{ChronicleConfig, usage};
use cradle_chronicle::memory_pipeline::naming::MemoryWindow;
use cradle_chronicle::memory_pipeline::summarizer::{
    LocalSummaryWriter, SummaryRequest, SummaryWriter,
};
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
    if !config.smoke {
        return Err(ChronicleError::InvalidArgument(
            "this first Cradle Chronicle binary currently requires --smoke".to_string(),
        ));
    }

    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let source = SyntheticCaptureSource::cradle_smoke(config.display_id, config.capture_limit);
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    let report = manager.run_until_exhausted()?;

    let summary = LocalSummaryWriter.write_summary(SummaryRequest {
        memories_dir,
        window: MemoryWindow::TenMinutes,
        description: "Cradle Chronicle smoke".to_string(),
        frames: report.persisted_frames.clone(),
        child_summaries: Vec::new(),
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
