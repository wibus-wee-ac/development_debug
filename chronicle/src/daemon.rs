//! Daemon mode for Cradle Chronicle.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::config::{CaptureProvider, ChronicleConfig};
use crate::cradle_client::{ChronicleMemoryReport, ChronicleSnapshotReport, CradleClient};
use crate::error::{ChronicleError, ChronicleResult};
use crate::memory_pipeline::recursive::RecursiveSummarizer;
use crate::memory_pipeline::summarizer::LocalSummaryWriter;
use crate::ocr::ObservedTextExtractor;
use crate::recorder::artifacts::{ArtifactStore, PersistedFrame};
use crate::recorder::fingerprint::FrameFingerprint;
use crate::recorder::sampler::AdaptiveSampler;
use crate::screen::inbox::InboxCaptureSource;
use crate::time::Timestamp;

#[cfg(target_os = "macos")]
use crate::screen::macos::MacosCaptureSource;

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
    let mut is_idle = false;

    while !SHUTDOWN_REQUESTED.load(Ordering::Relaxed) {
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
            all_persisted.clear();
            last_summary_time = Instant::now();
        }

        let interval = Duration::from_millis(sampler.current_interval_ms());
        thread::sleep(interval);
    }

    // Final summary before exit
    if !all_persisted.is_empty() && run_summary(config, &all_persisted).is_err() {
        eprintln!("cradle chronicle final summary error");
    }

    Ok("cradle chronicle daemon stopped".to_string())
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
}
