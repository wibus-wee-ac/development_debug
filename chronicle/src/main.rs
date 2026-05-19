//! CLI entry point for Cradle Chronicle.
//!
//! Input: smoke, daemon, storage-root, and inbox-root CLI flags.
//! Output: local Chronicle artifacts and memory files.
//! Position: binary wrapper around the library pipeline and desktop daemon bridge.

use std::fs;
use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use cradle_chronicle::config::{ChronicleConfig, usage};
use cradle_chronicle::memory_pipeline::recursive::RecursiveSummarizer;
use cradle_chronicle::memory_pipeline::summarizer::LocalSummaryWriter;
use cradle_chronicle::ocr::ObservedTextExtractor;
use cradle_chronicle::recorder::artifacts::ArtifactStore;
use cradle_chronicle::screen::inbox::InboxCaptureSource;
use cradle_chronicle::screen::macos::MacosCaptureSource;
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
        return run_daemon(config);
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
        config.display_id,
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

fn run_daemon(config: ChronicleConfig) -> Result<String, ChronicleError> {
    fs::create_dir_all(&config.storage_root)
        .map_err(|source| ChronicleError::io_at(&config.storage_root, source))?;
    if config.provider == "inbox" {
        fs::create_dir_all(&config.inbox_root)
            .map_err(|source| ChronicleError::io_at(&config.inbox_root, source))?;
    }

    if config.run_once {
        let report = process_provider_once(&config, 1)?;
        return Ok(format!(
            "cradle chronicle daemon processed once: observed={} persisted={} duplicates={} privacy_filtered={}",
            report.observed_frames,
            report.persisted_frames.len(),
            report.duplicate_frames,
            report.privacy_filtered_frames
        ));
    }

    println!(
        "cradle chronicle daemon started: provider={} storage_root={} inbox_root={}",
        config.provider,
        config.storage_root.display(),
        config.inbox_root.display()
    );
    let mut frame_index = 1;
    loop {
        let report = process_provider_once(&config, frame_index)?;
        frame_index += 1;
        if !report.persisted_frames.is_empty() {
            println!(
                "cradle chronicle daemon processed batch: observed={} persisted={} duplicates={} privacy_filtered={}",
                report.observed_frames,
                report.persisted_frames.len(),
                report.duplicate_frames,
                report.privacy_filtered_frames
            );
        }
        thread::sleep(Duration::from_millis(config.poll_interval_ms));
    }
}

fn process_provider_once(
    config: &ChronicleConfig,
    frame_index: u64,
) -> Result<cradle_chronicle::RecorderReport, ChronicleError> {
    match config.provider.as_str() {
        "macos" => process_macos_once(config, frame_index),
        "inbox" => process_inbox_once(config),
        other => Err(ChronicleError::InvalidArgument(format!(
            "unsupported Chronicle provider: {other}"
        ))),
    }
}

fn process_inbox_once(
    config: &ChronicleConfig,
) -> Result<cradle_chronicle::RecorderReport, ChronicleError> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let source = InboxCaptureSource::new(&config.inbox_root)?;
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    let report = manager.run_until_exhausted()?;

    if !report.persisted_frames.is_empty() {
        let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, memories_dir);
        let summary = summarizer.write_ten_minute_summary(
            "Cradle Chronicle desktop capture",
            report.persisted_frames.clone(),
        )?;
        println!(
            "cradle chronicle memory written: {}",
            summary.output_path.display()
        );
    }

    Ok(report)
}

fn process_macos_once(
    config: &ChronicleConfig,
    frame_index: u64,
) -> Result<cradle_chronicle::RecorderReport, ChronicleError> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let source = MacosCaptureSource::capture(config.display_id, frame_index)?;
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    let report = manager.run_until_exhausted()?;

    if !report.persisted_frames.is_empty() {
        let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, memories_dir);
        let summary = summarizer.write_ten_minute_summary(
            "Cradle Chronicle macOS screen capture",
            report.persisted_frames.clone(),
        )?;
        println!(
            "cradle chronicle memory written: {}",
            summary.output_path.display()
        );
    }

    Ok(report)
}
