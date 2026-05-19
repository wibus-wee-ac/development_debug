//! macOS native capture source for Cradle Chronicle.
//!
//! Input: macOS `screencapture`, CoreGraphics window inventory, and Vision OCR.
//! Output: real PNG screen frames with recognized text.
//! Position: standalone macOS production provider; no Electron dependency.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{ChronicleError, ChronicleResult};
use crate::screen::privacy_filter::PrivacyFilter;
use crate::screen::{BrowserWindowObservation, CaptureSource, CapturedFrame};
use crate::time::Timestamp;

pub struct MacosCaptureSource {
    frame: Option<CapturedFrame>,
}

impl MacosCaptureSource {
    pub fn capture(display_id: u32, frame_index: u64) -> ChronicleResult<Self> {
        let windows = read_window_inventory()?;
        if PrivacyFilter::default().should_exclude_windows(&windows) {
            return Ok(Self { frame: None });
        }

        let captured_at = Timestamp::now()?;
        let temp_path = temp_capture_path(captured_at, frame_index);
        run_screencapture(&temp_path)?;
        let bytes =
            fs::read(&temp_path).map_err(|source| ChronicleError::io_at(&temp_path, source))?;
        if bytes.is_empty() {
            return Err(ChronicleError::Process(format!(
                "macOS screen capture produced an empty file at {}",
                temp_path.display()
            )));
        }
        let observed_text = run_vision_ocr(&temp_path)?;
        let _ = fs::remove_file(&temp_path);

        Ok(Self {
            frame: Some(CapturedFrame {
                display_id,
                frame_index,
                captured_at,
                bytes,
                frame_extension: "png".to_string(),
                observed_text,
                windows,
            }),
        })
    }
}

impl CaptureSource for MacosCaptureSource {
    fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
        Ok(self.frame.take())
    }
}

fn run_screencapture(output_path: &Path) -> ChronicleResult<()> {
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "png"])
        .arg(output_path)
        .status()
        .map_err(|source| {
            ChronicleError::Process(format!("failed to start macOS screencapture: {source}"))
        })?;

    if !status.success() {
        return Err(ChronicleError::Process(format!(
            "macOS screencapture failed with status {status}. Grant Screen Recording permission to the terminal or app that starts Chronicle."
        )));
    }

    Ok(())
}

fn read_window_inventory() -> ChronicleResult<Vec<BrowserWindowObservation>> {
    let helper = resolve_helper(
        "macos_windows.swift",
        "CRADLE_CHRONICLE_MACOS_WINDOWS_HELPER",
    )?;
    let output = Command::new("/usr/bin/swift")
        .arg(&helper)
        .output()
        .map_err(|source| {
            ChronicleError::Process(format!(
                "failed to start macOS window inventory helper {}: {source}",
                helper.display()
            ))
        })?;

    if !output.status.success() {
        return Err(ChronicleError::Process(format!(
            "macOS window inventory helper failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let stdout = String::from_utf8(output.stdout)?;
    let mut windows = Vec::new();
    for (index, line) in stdout.lines().enumerate() {
        let mut fields = line.splitn(3, '\t');
        let id = fields
            .next()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(index as u32 + 1);
        let bundle_id = fields.next().unwrap_or("unknown");
        let name = fields.next().unwrap_or("");
        windows.push(BrowserWindowObservation::new(id, name, bundle_id));
    }
    Ok(windows)
}

fn run_vision_ocr(image_path: &Path) -> ChronicleResult<String> {
    let helper = resolve_helper("macos_ocr.swift", "CRADLE_CHRONICLE_MACOS_OCR_HELPER")?;
    let output = Command::new("/usr/bin/swift")
        .arg(&helper)
        .arg(image_path)
        .output()
        .map_err(|source| {
            ChronicleError::Process(format!(
                "failed to start macOS Vision OCR helper {}: {source}",
                helper.display()
            ))
        })?;

    if !output.status.success() {
        return Err(ChronicleError::Process(format!(
            "macOS Vision OCR helper failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    String::from_utf8(output.stdout).map_err(ChronicleError::from)
}

fn resolve_helper(file_name: &str, env_name: &str) -> ChronicleResult<PathBuf> {
    if let Some(configured) = std::env::var_os(env_name) {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Ok(path);
        }
        return Err(ChronicleError::InvalidArgument(format!(
            "configured helper does not exist: {}",
            path.display()
        )));
    }

    let candidates = [
        PathBuf::from("chronicle/helpers").join(file_name),
        PathBuf::from("../chronicle/helpers").join(file_name),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let current_exe = std::env::current_exe()?;
    for ancestor in current_exe.ancestors() {
        let candidate = ancestor.join("helpers").join(file_name);
        if candidate.exists() {
            return Ok(candidate);
        }
        let candidate = ancestor.join("chronicle/helpers").join(file_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(ChronicleError::InvalidArgument(format!(
        "macOS helper {file_name} not found; set {env_name}"
    )))
}

fn temp_capture_path(timestamp: Timestamp, frame_index: u64) -> PathBuf {
    std::env::temp_dir().join(format!(
        "cradle-chronicle-capture-{}-{}-{frame_index}.png",
        std::process::id(),
        timestamp.seconds_since_epoch()
    ))
}
