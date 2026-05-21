//! Daemon mode for Cradle Chronicle.

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::audio::{
    AudioArtifactMetadata, AudioTranscriptionPipeline, RmsActivityGate,
    capture_microphone_samples, write_audio_segment_artifact,
};
use crate::config::{CaptureProvider, ChronicleConfig};
use crate::cradle_client::{
    ChronicleAudioRawSegmentReport, ChronicleAudioRawSegmentSource, ChronicleAudioRawSegmentStatus,
    ChronicleMemoryReport, ChronicleSnapshotReport, CradleClient,
};
use crate::cron::{CronScheduler, CronTickResult, TaskKind, default_jobs};
use crate::dream::{DreamConfig, DreamEngine, DreamMode};
use crate::error::{ChronicleError, ChronicleResult};
use crate::meeting::detect_meeting;
use crate::memory_pipeline::recursive::RecursiveSummarizer;
use crate::memory_pipeline::summarizer::LocalSummaryWriter;
use crate::ocr::ObservedTextExtractor;
use crate::pipeline::Pipeline;
use crate::recorder::artifacts::{ArtifactStore, PersistedFrame};
use crate::recorder::fingerprint::FrameFingerprint;
use crate::recorder::sampler::AdaptiveSampler;
use crate::screen::inbox::InboxCaptureSource;
use crate::screen::BrowserWindowObservation;
use crate::slack::SlackScanner;
use crate::time::Timestamp;
use crate::transcript_inbox::process_transcript_inbox_tick;

#[cfg(target_os = "macos")]
use crate::screen::macos::{
    AxObserverRuntime, MacosCaptureSource, read_ax_observer_accessibility_capture,
};

use crate::RecorderManager;

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Run Chronicle in daemon mode.
pub fn run(config: ChronicleConfig) -> ChronicleResult<String> {
    fs::create_dir_all(&config.storage_root)
        .map_err(|e| ChronicleError::io_at(&config.storage_root, e))?;
    if config.provider == CaptureProvider::Inbox {
        fs::create_dir_all(&config.inbox_root)
            .map_err(|e| ChronicleError::io_at(&config.inbox_root, e))?;
    }

    // Single instance lock
    let lock = InstanceLock::acquire(&config.storage_root)?;

    // Signal handling
    install_signal_handlers();

    // Write PID file
    write_pid_file(&config.storage_root)?;

    eprintln!("screen recording starting");
    eprintln!(
        "cradle chronicle daemon started: provider={:?} storage_root={} inbox_root={}",
        config.provider,
        config.storage_root.display(),
        config.inbox_root.display()
    );

    if config.run_once {
        let report = capture_once(&config, 1)?;
        let client = CradleClient::from_env();
        process_transcripts(&config.inbox_root, &client);
        if config.audio_capture {
            process_audio_segment(&config, &client);
        }
        report_snapshots(&client, &report.persisted_frames);
        drop(lock);
        cleanup_pid_file(&config.storage_root);
        return Ok(format!(
            "cradle chronicle daemon processed once: observed={} persisted={} duplicates={} privacy_filtered={}",
            report.observed_frames,
            report.persisted_frames.len(),
            report.duplicate_frames,
            report.privacy_filtered_frames
        ));
    }

    let result = daemon_loop(&config);

    // Cleanup
    drop(lock);
    cleanup_pid_file(&config.storage_root);
    eprintln!("screen recording stopped by user");

    result
}

fn daemon_loop(config: &ChronicleConfig) -> ChronicleResult<String> {
    let client = CradleClient::from_env();
    let mut sampler = AdaptiveSampler::new(
        config.poll_interval_ms,
        config.min_interval_ms,
        config.max_interval_ms,
    );
    let mut frame_index: u64 = 1;
    let mut all_persisted: Vec<PersistedFrame> = Vec::new();
    let mut last_summary_time = Instant::now();
    let summary_interval = Duration::from_secs(600); // 10 minutes
    let mut last_audio_segment_time: Option<Instant> = None;
    let mut is_idle = false;
    #[cfg(target_os = "macos")]
    let mut ax_observer = start_ax_observer(config);

    // Pipeline, Cron, and Slack integration
    let mut pipeline = Pipeline::from_env();

    let cron_state_path = config.storage_root.join("cron-state.json");
    let mut cron = CronScheduler::new(&cron_state_path);
    if let Err(e) = cron.load_state() {
        eprintln!("cradle chronicle cron load state error: {e}");
    }
    if cron.jobs().is_empty()
        && let Ok(now) = Timestamp::now() {
            for job in default_jobs(now) {
                cron.add_job(job);
            }
        }

    let mut slack_scanner: Option<SlackScanner> = if env::var("SLACK_BOT_TOKEN").is_ok() {
        match SlackScanner::from_env() {
            Ok(scanner) => {
                eprintln!("cradle chronicle slack scanner initialized");
                Some(scanner)
            }
            Err(e) => {
                eprintln!("cradle chronicle slack scanner init error: {e}");
                None
            }
        }
    } else {
        None
    };

    let mut last_cron_check = Instant::now();
    let cron_interval = Duration::from_secs(30);
    let mut last_slack_poll = Instant::now();
    let slack_interval = Duration::from_secs(60);

    // Meeting detection state
    let mut is_in_meeting = false;

    // ONNX Runtime — local model inference (VAD, ASR, Embedding, PII)
    // Models are loaded lazily on first use via OnnxRuntime.
    let onnx_runtime = crate::onnx::OnnxRuntime::new();
    eprintln!("cradle chronicle onnx runtime initialized (models load on demand)");

    // Audio transcription pipeline: local ONNX (Silero VAD + SenseVoice ASR)
    let _local_transcription = crate::audio::asr::LocalTranscriptionPipeline::new(&onnx_runtime);
    let _audio_pipeline = AudioTranscriptionPipeline::from_env();
    eprintln!("cradle chronicle audio transcription pipeline ready (local ONNX + remote fallback)");

    while !SHUTDOWN_REQUESTED.load(Ordering::Relaxed) {
        process_transcripts(&config.inbox_root, &client);
        process_audio_segment_if_due(config, &client, &mut last_audio_segment_time);
        #[cfg(target_os = "macos")]
        refresh_ax_observer(config, &mut ax_observer);
        #[cfg(target_os = "macos")]
        process_ax_observer_events(config, &client, &ax_observer, &mut frame_index);

        // Check system idle
        let idle_seconds = system_idle_seconds();
        if idle_seconds >= config.idle_timeout_seconds && !is_idle {
            is_idle = true;
            eprintln!("pausing screen recording due to system idle time");
        }
        if is_idle {
            if idle_seconds < config.idle_timeout_seconds {
                is_idle = false;
                sampler.reset(config.poll_interval_ms);
                eprintln!("resuming screen recording after system idle time reset");
            } else {
                thread::sleep(Duration::from_secs(2));
                continue;
            }
        }

        // Capture
        match capture_once(config, frame_index) {
            Ok(report) => {
                frame_index += 1;
                if !report.persisted_frames.is_empty() {
                    report_snapshots(&client, &report.persisted_frames);

                    // Meeting detection from the latest captured frame
                    if let Some(latest_frame) = report.persisted_frames.last() {
                        check_meeting_state(latest_frame, &mut is_in_meeting);
                    }

                    // Feed adaptive sampler with fingerprint from captured frame
                    let fp = FrameFingerprint::from_parts(
                        &format!("frame-{frame_index}").into_bytes(),
                        &format!("persisted-{}", report.persisted_frames.len()),
                    );
                    sampler.observe(fp);
                    all_persisted.extend(report.persisted_frames);

                    // Cap pending frames to prevent unbounded growth
                    const MAX_PENDING_FRAMES: usize = 500;
                    if all_persisted.len() > MAX_PENDING_FRAMES {
                        eprintln!(
                            "cradle chronicle: pending frames exceeded cap, forcing early summarization"
                        );
                        if let Err(e) = run_summary(config, &all_persisted) {
                            eprintln!("cradle chronicle forced summary error: {e}");
                        }
                        process_pipeline(&mut pipeline, &all_persisted);
                        all_persisted.clear();
                        last_summary_time = Instant::now();
                    }

                    eprintln!(
                        "cradle chronicle daemon processed batch: observed={} persisted={}",
                        report.observed_frames,
                        all_persisted.len()
                    );
                } else {
                    // No new content — signal duplicate to sampler
                    let fp = FrameFingerprint::from_parts(b"dup", "dup");
                    sampler.observe(fp);
                }
            }
            Err(e) => {
                eprintln!("cradle chronicle capture error: {e}");
            }
        }

        // Periodic summarization
        if last_summary_time.elapsed() >= summary_interval && !all_persisted.is_empty() {
            if let Err(e) = run_summary(config, &all_persisted) {
                eprintln!("cradle chronicle summary error: {e}");
            }
            process_pipeline(&mut pipeline, &all_persisted);
            all_persisted.clear();
            last_summary_time = Instant::now();
        }

        // Cron check
        if last_cron_check.elapsed() >= cron_interval {
            process_cron_jobs(&mut cron, &mut pipeline, &all_persisted, &config.storage_root);
            last_cron_check = Instant::now();
        }

        // Slack poll
        if last_slack_poll.elapsed() >= slack_interval {
            if let Some(ref mut scanner) = slack_scanner {
                poll_slack(scanner, &client);
            }
            last_slack_poll = Instant::now();
        }

        let interval = Duration::from_millis(sampler.current_interval_ms());
        thread::sleep(interval);
    }

    // Final summary before exit
    if !all_persisted.is_empty() {
        if run_summary(config, &all_persisted).is_err() {
            eprintln!("cradle chronicle final summary error");
        }
        process_pipeline(&mut pipeline, &all_persisted);
    }

    // Save cron state before exit
    if let Err(e) = cron.save_state() {
        eprintln!("cradle chronicle cron save state error on exit: {e}");
    }

    Ok("cradle chronicle daemon stopped".to_string())
}

#[cfg(target_os = "macos")]
fn start_ax_observer(config: &ChronicleConfig) -> Option<AxObserverRuntime> {
    if config.provider != CaptureProvider::Macos || !config.ax_observer {
        return None;
    }
    match AxObserverRuntime::start_for_frontmost_app() {
        Ok(observer) => {
            eprintln!(
                "cradle chronicle AXObserver started: pid={} bundle={}",
                observer.target_pid(),
                observer.target_bundle_identifier()
            );
            Some(observer)
        }
        Err(error) => {
            eprintln!("cradle chronicle AXObserver unavailable: {error}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn refresh_ax_observer(config: &ChronicleConfig, observer: &mut Option<AxObserverRuntime>) {
    if config.provider != CaptureProvider::Macos || !config.ax_observer {
        *observer = None;
        return;
    }
    let changed = observer
        .as_ref()
        .is_none_or(AxObserverRuntime::frontmost_target_changed);
    if !changed {
        return;
    }
    if let Some(previous) = observer.take() {
        eprintln!(
            "cradle chronicle AXObserver target changed, stopping pid={} bundle={}",
            previous.target_pid(),
            previous.target_bundle_identifier()
        );
    }
    *observer = start_ax_observer(config);
}

#[cfg(target_os = "macos")]
fn process_ax_observer_events(
    config: &ChronicleConfig,
    client: &CradleClient,
    observer: &Option<AxObserverRuntime>,
    frame_index: &mut u64,
) {
    let Some(observer) = observer else {
        return;
    };
    for event in observer.drain(4) {
        let accessibility = read_ax_observer_accessibility_capture(&event);
        match capture_macos_with_accessibility(config, *frame_index, accessibility) {
            Ok(report) => {
                *frame_index += 1;
                if !report.persisted_frames.is_empty() {
                    report_snapshots(client, &report.persisted_frames);
                    eprintln!(
                        "cradle chronicle AXObserver event captured: notification={} pid={} frames={} dropped_total={}",
                        event.notification,
                        event.pid,
                        report.persisted_frames.len(),
                        observer.dropped_count()
                    );
                }
            }
            Err(error) => {
                eprintln!(
                    "cradle chronicle AXObserver event capture error: notification={} pid={} error={}",
                    event.notification, event.pid, error
                );
            }
        }
    }
}

fn capture_once(
    config: &ChronicleConfig,
    frame_index: u64,
) -> ChronicleResult<crate::RecorderReport> {
    match config.provider {
        CaptureProvider::Macos => capture_macos(config, frame_index),
        CaptureProvider::Inbox => capture_inbox(config),
    }
}

fn capture_inbox(config: &ChronicleConfig) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let source = InboxCaptureSource::new(&config.inbox_root)?;
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    manager.run_until_exhausted()
}

#[cfg(target_os = "macos")]
fn capture_macos(
    config: &ChronicleConfig,
    frame_index: u64,
) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let source = match config.display_id {
        Some(display_id) => MacosCaptureSource::capture(display_id, frame_index)?,
        None => MacosCaptureSource::capture_all(frame_index)?,
    };
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    manager.run_until_exhausted()
}

#[cfg(target_os = "macos")]
fn capture_macos_with_accessibility(
    config: &ChronicleConfig,
    frame_index: u64,
    accessibility: crate::screen::AccessibilityCapture,
) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let source = match config.display_id {
        Some(display_id) => {
            MacosCaptureSource::capture_with_accessibility(display_id, frame_index, accessibility)?
        }
        None => MacosCaptureSource::capture_all_with_accessibility(frame_index, accessibility)?,
    };
    let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);
    manager.run_until_exhausted()
}

#[cfg(not(target_os = "macos"))]
fn capture_macos(
    _config: &ChronicleConfig,
    _frame_index: u64,
) -> ChronicleResult<crate::RecorderReport> {
    Err(ChronicleError::InvalidArgument(
        "macOS capture provider is only available on macOS".to_string(),
    ))
}

fn run_summary(config: &ChronicleConfig, persisted: &[PersistedFrame]) -> ChronicleResult<()> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let memories_dir = store.memories_dir();
    let client = CradleClient::from_env();

    // Try Cradle Server for LLM-backed summarization
    if let Some(remote_config) = client.fetch_config()
        && remote_config.enabled
    {
        let prompt = crate::memory_pipeline::prompt::build_memory_prompt(persisted, &[]);
        match client.summarize(&prompt, "10min") {
            Ok(summary) => {
                // Write LLM summary to memories directory
                std::fs::create_dir_all(&memories_dir)
                    .map_err(|e| ChronicleError::io_at(&memories_dir, e))?;
                let filename = crate::memory_pipeline::naming::memory_filename(
                    segment_started_at,
                    &crate::memory_pipeline::naming::MemoryWindow::TenMinutes,
                    "cradle-llm-summary",
                );
                let output_path = memories_dir.join(filename);
                std::fs::write(&output_path, &summary)
                    .map_err(|e| ChronicleError::io_at(&output_path, e))?;
                eprintln!(
                    "cradle chronicle LLM memory written: {}",
                    output_path.display()
                );
                report_memory(
                    &client,
                    ChronicleMemoryReport::from_summary(
                        "10min",
                        segment_started_at.filesystem(),
                        &output_path,
                        summary,
                        "llm",
                        persisted,
                    ),
                );
                return Ok(());
            }
            Err(e) => {
                eprintln!("cradle chronicle LLM summary failed, falling back to local: {e}");
            }
        }
    }

    // Fallback: local summary (no LLM)
    let summarizer = RecursiveSummarizer::new(LocalSummaryWriter, memories_dir);
    let summary = summarizer
        .write_ten_minute_summary("Cradle Chronicle daemon capture", persisted.to_vec())?;
    eprintln!(
        "cradle chronicle local memory written: {}",
        summary.output_path.display()
    );
    report_memory(
        &client,
        ChronicleMemoryReport::from_summary(
            "10min",
            segment_started_at.filesystem(),
            &summary.output_path,
            summary.markdown,
            "local",
            persisted,
        ),
    );
    Ok(())
}

fn report_snapshots(client: &CradleClient, persisted: &[PersistedFrame]) {
    for frame in persisted {
        let report = ChronicleSnapshotReport::from_persisted_frame(frame);
        if let Err(error) = client.record_snapshot(&report) {
            eprintln!("cradle chronicle snapshot report failed, keeping local artifacts: {error}");
        }
    }
}

fn report_memory(client: &CradleClient, report: ChronicleMemoryReport) {
    if let Err(error) = client.record_memory(&report) {
        eprintln!("cradle chronicle memory report failed, keeping local memory: {error}");
    }
}

fn check_meeting_state(frame: &PersistedFrame, is_in_meeting: &mut bool) {
    // Reconstruct window observations from accessibility elements
    let windows: Vec<BrowserWindowObservation> = frame
        .accessibility
        .elements
        .iter()
        .filter(|el| el.role == "window")
        .map(|el| {
            let mut w = BrowserWindowObservation::new(
                el.window_id.unwrap_or(0),
                &el.label,
                &el.app_bundle_identifier,
            );
            if let Some(ref url) = el.value {
                w = w.with_url(url);
            }
            w
        })
        .collect();

    let now = match Timestamp::now() {
        Ok(t) => t,
        Err(_) => return,
    };

    let detection = detect_meeting(&windows, &frame.accessibility, now);

    if detection.is_meeting && !*is_in_meeting {
        *is_in_meeting = true;
        let app = detection.meeting_app.as_deref().unwrap_or("unknown");
        let title = detection.meeting_title.as_deref().unwrap_or("unknown");
        eprintln!("cradle chronicle meeting detected: app={app} title={title}");
    } else if !detection.is_meeting && *is_in_meeting {
        *is_in_meeting = false;
        eprintln!("cradle chronicle meeting ended");
    }
}

fn process_pipeline(pipeline: &mut Pipeline, frames: &[PersistedFrame]) {
    match pipeline.process_frames(frames) {
        Ok(report) => {
            eprintln!(
                "cradle chronicle pipeline completed: segments={} kept={} chunks={} deduped={}",
                report.segments_produced, report.segments_kept, report.chunks_produced, report.chunks_deduplicated
            );
        }
        Err(error) => {
            eprintln!("cradle chronicle pipeline error: {error}");
        }
    }
}

fn process_cron_jobs(cron: &mut CronScheduler, pipeline: &mut Pipeline, frames: &[PersistedFrame], _storage_root: &Path) {
    let now = match Timestamp::now() {
        Ok(t) => t,
        Err(_) => return,
    };
    let due_jobs = cron.tick(now);
    for result in due_jobs {
        if let CronTickResult::Due(job_id) = result {
            let task_kind = cron.get_job(&job_id).map(|j| j.task_kind);
            match task_kind {
                Some(TaskKind::Summarize) => {
                    eprintln!("cradle chronicle cron: summarize triggered");
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::Crystallize) => {
                    process_pipeline(pipeline, frames);
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::DreamArchive) => {
                    eprintln!("cradle chronicle cron: dream-archive triggered");
                    let mut engine = DreamEngine::new(DreamConfig::default());
                    let chunks = pipeline.drain_chunks();
                    engine.load_chunks(chunks);
                    let report = engine.run(DreamMode::Archive, now);
                    eprintln!("cradle chronicle dream-archive: archived={}", report.archived_count);
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::DreamMerge) => {
                    eprintln!("cradle chronicle cron: dream-merge triggered");
                    let mut engine = DreamEngine::new(DreamConfig::default());
                    let chunks = pipeline.drain_chunks();
                    engine.load_chunks(chunks);
                    let report = engine.run(DreamMode::Merge, now);
                    eprintln!("cradle chronicle dream-merge: merged={}", report.merged_count);
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::DreamPrune) => {
                    eprintln!("cradle chronicle cron: dream-prune triggered");
                    let mut engine = DreamEngine::new(DreamConfig::default());
                    let chunks = pipeline.drain_chunks();
                    engine.load_chunks(chunks);
                    let report = engine.run(DreamMode::Prune, now);
                    eprintln!("cradle chronicle dream-prune: pruned={}", report.pruned_count);
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::HealthCheck) => {
                    eprintln!("cradle chronicle cron: health check ok");
                    cron.mark_completed(&job_id, now, "ok");
                }
                Some(TaskKind::Cleanup) => {
                    eprintln!("cradle chronicle cron: cleanup (not yet fully implemented)");
                    cron.mark_completed(&job_id, now, "ok");
                }
                None => {}
            }
        }
    }
    if let Err(e) = cron.save_state() {
        eprintln!("cradle chronicle cron save state error: {e}");
    }
}

fn poll_slack(scanner: &mut SlackScanner, client: &CradleClient) {
    match scanner.poll_all() {
        Ok(messages) if !messages.is_empty() => {
            eprintln!("cradle chronicle slack polled: {} new messages", messages.len());
            for msg in &messages {
                let report_body = serde_json::json!({
                    "sourceId": format!("slack:{}:{}", msg.channel_id, msg.timestamp),
                    "platform": "slack",
                    "channelId": msg.channel_id,
                    "userId": msg.user_id,
                    "text": msg.text,
                    "timestamp": msg.timestamp,
                });
                if let Err(e) = client.record_chat_message(&report_body) {
                    eprintln!("cradle chronicle slack message report error: {e}");
                }
            }
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("cradle chronicle slack poll error: {error}");
        }
    }
}

fn process_transcripts(inbox_root: &Path, client: &CradleClient) {
    match process_transcript_inbox_tick(inbox_root, client) {
        Ok(report) if report.scanned > 0 => {
            eprintln!(
                "cradle chronicle transcript inbox processed: scanned={} reported={} failed={}",
                report.scanned, report.reported, report.failed
            );
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("cradle chronicle transcript inbox error: {error}");
        }
    }
}

fn process_audio_segment_if_due(
    config: &ChronicleConfig,
    client: &CradleClient,
    last_audio_segment_time: &mut Option<Instant>,
) {
    if !config.audio_capture {
        return;
    }
    let interval = Duration::from_millis(config.audio_segment_interval_ms.max(100));
    if !audio_segment_due(*last_audio_segment_time, interval) {
        return;
    }
    process_audio_segment(config, client);
    *last_audio_segment_time = Some(Instant::now());
}

fn audio_segment_due(last_audio_segment_time: Option<Instant>, interval: Duration) -> bool {
    last_audio_segment_time.is_none_or(|last_capture| last_capture.elapsed() >= interval)
}

fn process_audio_segment(config: &ChronicleConfig, client: &CradleClient) {
    match write_microphone_segment(config) {
        Ok(report) => {
            eprintln!(
                "cradle chronicle audio segment written: samples={} dropped={} rms={:.6} peak={:.6} active={} wav={} metadata={}",
                report.sample_count,
                report.dropped_samples,
                report.rms,
                report.peak,
                report.active,
                report.wav_path.display(),
                report.metadata_path.display()
            );
            report_audio_raw_segment(client, &report);
        }
        Err(error) => {
            eprintln!("cradle chronicle audio segment error: {error}");
        }
    }
}

fn report_audio_raw_segment(client: &CradleClient, report: &AudioSegmentArtifactReport) {
    let payload = ChronicleAudioRawSegmentReport {
        source_id: audio_segment_source_id(&report.metadata_path),
        recorded_at: report.recorded_at.clone(),
        source: ChronicleAudioRawSegmentSource::Microphone,
        status: ChronicleAudioRawSegmentStatus::Captured,
        audio_path: artifact_path_text(&report.wav_path),
        metadata_path: artifact_path_text(&report.metadata_path),
        sample_rate: report.sample_rate,
        channels: report.channels,
        sample_count: report.sample_count,
        dropped_samples: report.dropped_samples,
        duration_ms: report.duration_ms,
        rms: report.rms,
        peak: report.peak,
        active: report.active,
        vad_implemented: false,
        asr_implemented: false,
        speaker_labeling_implemented: false,
        metadata: serde_json::json!({
            "runtime": "microphone-segment",
            "sourceSampleFormat": report.source_sample_format,
            "vadImplemented": false,
            "asrImplemented": false,
            "speakerLabelingImplemented": false
        }),
    };
    if let Err(error) = client.record_audio_raw_segment(&payload) {
        eprintln!(
            "cradle chronicle raw audio segment report failed, keeping local artifacts: {error}"
        );
    }
}

#[derive(Debug, Clone, PartialEq)]
struct AudioSegmentArtifactReport {
    recorded_at: String,
    sample_rate: u32,
    channels: u16,
    source_sample_format: String,
    sample_count: usize,
    dropped_samples: usize,
    duration_ms: u64,
    rms: f32,
    peak: f32,
    active: bool,
    wav_path: PathBuf,
    metadata_path: PathBuf,
}

fn write_microphone_segment(
    config: &ChronicleConfig,
) -> ChronicleResult<AudioSegmentArtifactReport> {
    let capture = capture_microphone_samples(config.audio_segment_ms)?;
    let gate = RmsActivityGate::new(config.audio_rms_threshold);
    let activity = gate.analyze(&capture.samples);
    let metadata = AudioArtifactMetadata {
        recorded_at: Timestamp::now()?,
        sample_rate: capture.sample_rate,
        channels: capture.channels,
        source_sample_format: capture.source_sample_format,
        sample_count: capture.samples.len(),
        dropped_samples: capture.dropped_samples,
        rms: activity.rms,
        peak: activity.peak,
        active: activity.active,
    };
    let artifact = write_audio_segment_artifact(&config.storage_root, &capture.samples, &metadata)?;
    Ok(AudioSegmentArtifactReport {
        recorded_at: metadata.recorded_at.filesystem(),
        sample_rate: metadata.sample_rate,
        channels: metadata.channels,
        source_sample_format: metadata.source_sample_format,
        sample_count: metadata.sample_count,
        dropped_samples: metadata.dropped_samples,
        duration_ms: capture.duration_ms,
        rms: metadata.rms,
        peak: metadata.peak,
        active: metadata.active,
        wav_path: artifact.wav_path,
        metadata_path: artifact.metadata_path,
    })
}

fn audio_segment_source_id(metadata_path: &Path) -> String {
    let stem = metadata_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown");
    format!("audio:microphone:{stem}")
}

fn artifact_path_text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

// --- System idle detection ---

#[cfg(target_os = "macos")]
fn system_idle_seconds() -> u64 {
    // CGEventSourceSecondsSinceLastEventType with kCGEventSourceStateCombinedSessionState
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(source_state: u32, event_type: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0
    // kCGAnyInputEventType = 0xFFFFFFFF (all event types)
    let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(0, 0xFFFF_FFFF) };
    if seconds < 0.0 { 0 } else { seconds as u64 }
}

#[cfg(not(target_os = "macos"))]
fn system_idle_seconds() -> u64 {
    // On non-macOS, always report active (no idle detection)
    0
}

// --- Signal handling ---

fn install_signal_handlers() {
    #[cfg(unix)]
    {
        use std::sync::Once;
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            let mut sa: libc::sigaction = std::mem::zeroed();
            sa.sa_sigaction = signal_handler as *const () as usize;
            sa.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&mut sa.sa_mask);
            libc::sigaction(libc::SIGTERM, &sa, std::ptr::null_mut());
            libc::sigaction(libc::SIGINT, &sa, std::ptr::null_mut());
        });
    }
}

#[cfg(unix)]
extern "C" fn signal_handler(_sig: libc::c_int) {
    SHUTDOWN_REQUESTED.store(true, Ordering::Relaxed);
}

// --- Instance lock ---

struct InstanceLock {
    lock_path: PathBuf,
    #[cfg(unix)]
    _fd: std::os::unix::io::OwnedFd,
}

impl InstanceLock {
    fn acquire(storage_root: &Path) -> ChronicleResult<Self> {
        let lock_path = storage_root.join("codex_chronicle.lock");

        #[cfg(unix)]
        {
            use std::os::unix::io::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
            let file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(&lock_path)
                .map_err(|e| ChronicleError::io_at(&lock_path, e))?;

            let fd = unsafe { OwnedFd::from_raw_fd(file.into_raw_fd()) };
            let result = unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result != 0 {
                return Err(ChronicleError::Process(
                    "another Chronicle instance is already running (lock held)".to_string(),
                ));
            }
            // Set CLOEXEC so child processes don't inherit the lock
            unsafe {
                libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC);
            }
            Ok(Self { lock_path, _fd: fd })
        }

        #[cfg(not(unix))]
        {
            if lock_path.exists() {
                // Check if the PID in the lock file is still alive
                if let Ok(content) = fs::read_to_string(&lock_path) {
                    if let Ok(pid) = content.trim().parse::<u32>() {
                        // On non-unix systems, we can't easily check process liveness
                        // For now, treat existing lock as held
                        let _ = pid;
                    }
                }
                return Err(ChronicleError::Process(
                    "another Chronicle instance is already running (lock file exists)".to_string(),
                ));
            }
            fs::write(&lock_path, std::process::id().to_string().as_bytes())
                .map_err(|e| ChronicleError::io_at(&lock_path, e))?;
            Ok(Self { lock_path })
        }
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        // On unix, OwnedFd automatically closes the fd and releases flock
        let _ = fs::remove_file(&self.lock_path);
    }
}

// --- PID file ---

fn write_pid_file(storage_root: &Path) -> ChronicleResult<()> {
    let pid_path = storage_root.join("chronicle-started.pid");
    let mut file = fs::File::create(&pid_path).map_err(|e| ChronicleError::io_at(&pid_path, e))?;
    write!(file, "{}", std::process::id()).map_err(|e| ChronicleError::io_at(&pid_path, e))?;
    Ok(())
}

fn cleanup_pid_file(storage_root: &Path) {
    let pid_path = storage_root.join("chronicle-started.pid");
    let _ = fs::remove_file(pid_path);
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{Duration, Instant};

    use super::InstanceLock;

    #[test]
    fn lock_acquires_and_releases() {
        let root =
            std::env::temp_dir().join(format!("cradle-chronicle-lock-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let lock = InstanceLock::acquire(&root).expect("should acquire lock");
        let lock_path = root.join("codex_chronicle.lock");
        assert!(lock_path.exists());

        drop(lock);
        assert!(!lock_path.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_lock_fails() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-lock-test2-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let _lock1 = InstanceLock::acquire(&root).expect("first lock should succeed");
        let result = InstanceLock::acquire(&root);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pid_file_written_and_cleaned() {
        let root =
            std::env::temp_dir().join(format!("cradle-chronicle-pid-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        super::write_pid_file(&root).expect("should write pid");
        let pid_path = root.join("chronicle-started.pid");
        assert!(pid_path.exists());
        let content = fs::read_to_string(&pid_path).unwrap();
        assert_eq!(content, std::process::id().to_string());

        super::cleanup_pid_file(&root);
        assert!(!pid_path.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn audio_segment_due_respects_interval() {
        let interval = Duration::from_millis(1_000);
        let recent = Some(Instant::now());
        let older = Some(Instant::now() - Duration::from_millis(1_500));

        assert!(!super::audio_segment_due(recent, interval));
        assert!(super::audio_segment_due(older, interval));
        assert!(super::audio_segment_due(None, interval));
    }
}
