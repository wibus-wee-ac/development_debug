//! Runtime configuration for Cradle Chronicle.

use std::env;
use std::path::PathBuf;

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureProvider {
    Macos,
    Inbox,
}

impl CaptureProvider {
    pub fn parse(s: &str) -> ChronicleResult<Self> {
        match s {
            "macos" => Ok(Self::Macos),
            "inbox" => Ok(Self::Inbox),
            other => Err(ChronicleError::InvalidArgument(format!(
                "unsupported provider: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChronicleConfig {
    pub storage_root: PathBuf,
    pub inbox_root: PathBuf,
    pub provider: CaptureProvider,
    pub display_id: Option<u32>,
    pub capture_limit: usize,
    pub poll_interval_ms: u64,
    pub idle_timeout_seconds: u64,
    pub min_interval_ms: u64,
    pub max_interval_ms: u64,
    pub smoke: bool,
    pub daemon: bool,
    pub run_once: bool,
}

impl ChronicleConfig {
    pub fn from_env_args() -> ChronicleResult<Self> {
        Self::from_args(env::args().skip(1))
    }

    pub fn from_args<I, S>(args: I) -> ChronicleResult<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut storage_root = env::var_os("STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("./.cradle/chronicle"));
        let mut inbox_root = env::var_os("CHRONICLE_INBOX_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| storage_root.join("inbox"));
        let mut provider = match env::var("CRADLE_CHRONICLE_PROVIDER").as_deref() {
            Ok("macos") => CaptureProvider::Macos,
            Ok("inbox") => CaptureProvider::Inbox,
            Ok(other) => {
                return Err(ChronicleError::InvalidArgument(format!(
                    "unsupported CRADLE_CHRONICLE_PROVIDER: {other}"
                )));
            }
            Err(_) => {
                if cfg!(target_os = "macos") {
                    CaptureProvider::Macos
                } else {
                    CaptureProvider::Inbox
                }
            }
        };
        let mut display_id = None;
        let mut capture_limit = 3;
        let mut poll_interval_ms = 5_000;
        let mut idle_timeout_seconds = 300;
        let mut min_interval_ms = 2_000;
        let mut max_interval_ms = 30_000;
        let mut smoke = false;
        let mut daemon = false;
        let mut run_once = false;

        let mut iterator = args.into_iter().map(Into::into).peekable();
        while let Some(arg) = iterator.next() {
            if arg == "--smoke" {
                smoke = true;
            } else if arg == "--daemon" {
                daemon = true;
            } else if arg == "--run-once" {
                run_once = true;
            } else if let Some(value) = arg.strip_prefix("--storage-root=") {
                storage_root = PathBuf::from(value);
                if env::var_os("CHRONICLE_INBOX_ROOT").is_none() {
                    inbox_root = storage_root.join("inbox");
                }
            } else if arg == "--storage-root" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--storage-root requires a value".to_string())
                })?;
                storage_root = PathBuf::from(value);
                if env::var_os("CHRONICLE_INBOX_ROOT").is_none() {
                    inbox_root = storage_root.join("inbox");
                }
            } else if let Some(value) = arg.strip_prefix("--inbox-root=") {
                inbox_root = PathBuf::from(value);
            } else if arg == "--inbox-root" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--inbox-root requires a value".to_string())
                })?;
                inbox_root = PathBuf::from(value);
            } else if let Some(value) = arg.strip_prefix("--provider=") {
                provider = CaptureProvider::parse(value)?;
            } else if arg == "--provider" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--provider requires a value".to_string())
                })?;
                provider = CaptureProvider::parse(&value)?;
            } else if let Some(value) = arg.strip_prefix("--display-id=") {
                display_id = Some(parse_u32("--display-id", value)?);
            } else if arg == "--display-id" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--display-id requires a value".to_string())
                })?;
                display_id = Some(parse_u32("--display-id", &value)?);
            } else if let Some(value) = arg.strip_prefix("--capture-limit=") {
                capture_limit = parse_usize("--capture-limit", value)?;
            } else if arg == "--capture-limit" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--capture-limit requires a value".to_string())
                })?;
                capture_limit = parse_usize("--capture-limit", &value)?;
            } else if let Some(value) = arg.strip_prefix("--poll-ms=") {
                poll_interval_ms = parse_u64("--poll-ms", value)?;
            } else if arg == "--poll-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--poll-ms requires a value".to_string())
                })?;
                poll_interval_ms = parse_u64("--poll-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--idle-timeout=") {
                idle_timeout_seconds = parse_u64("--idle-timeout", value)?;
            } else if arg == "--idle-timeout" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--idle-timeout requires a value".to_string())
                })?;
                idle_timeout_seconds = parse_u64("--idle-timeout", &value)?;
            } else if let Some(value) = arg.strip_prefix("--min-interval-ms=") {
                min_interval_ms = parse_u64("--min-interval-ms", value)?;
            } else if arg == "--min-interval-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--min-interval-ms requires a value".to_string(),
                    )
                })?;
                min_interval_ms = parse_u64("--min-interval-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--max-interval-ms=") {
                max_interval_ms = parse_u64("--max-interval-ms", value)?;
            } else if arg == "--max-interval-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--max-interval-ms requires a value".to_string(),
                    )
                })?;
                max_interval_ms = parse_u64("--max-interval-ms", &value)?;
            } else if arg == "--help" || arg == "-h" {
                return Err(ChronicleError::InvalidArgument(usage()));
            } else {
                return Err(ChronicleError::InvalidArgument(format!(
                    "unknown argument: {arg}\n{}",
                    usage()
                )));
            }
        }

        if capture_limit == 0 {
            return Err(ChronicleError::InvalidArgument(
                "--capture-limit must be greater than zero".to_string(),
            ));
        }

        Ok(Self {
            storage_root,
            inbox_root,
            provider,
            display_id,
            capture_limit,
            poll_interval_ms,
            idle_timeout_seconds,
            min_interval_ms,
            max_interval_ms,
            smoke,
            daemon,
            run_once,
        })
    }
}

pub fn usage() -> String {
    "usage: cradle-chronicle (--smoke | --daemon) [--provider macos|inbox] [--storage-root <path>] [--inbox-root <path>] [--display-id <id>] [--capture-limit <count>] [--poll-ms <ms>] [--idle-timeout <seconds>] [--min-interval-ms <ms>] [--max-interval-ms <ms>] [--run-once]".to_string()
}

fn parse_u32(name: &str, value: &str) -> ChronicleResult<u32> {
    value
        .parse::<u32>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

fn parse_usize(name: &str, value: &str) -> ChronicleResult<usize> {
    value
        .parse::<usize>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

fn parse_u64(name: &str, value: &str) -> ChronicleResult<u64> {
    value
        .parse::<u64>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{CaptureProvider, ChronicleConfig};

    #[test]
    fn parses_storage_root_forms() {
        let config = ChronicleConfig::from_args([
            "--smoke",
            "--storage-root",
            "/tmp/cradle-chronicle-test",
            "--capture-limit=2",
        ])
        .expect("config should parse");

        assert!(config.smoke);
        assert_eq!(
            config.storage_root,
            PathBuf::from("/tmp/cradle-chronicle-test")
        );
        assert_eq!(
            config.inbox_root,
            PathBuf::from("/tmp/cradle-chronicle-test/inbox")
        );
        assert_eq!(config.display_id, None);
        assert_eq!(config.capture_limit, 2);
    }

    #[test]
    fn parses_daemon_options() {
        let config = ChronicleConfig::from_args([
            "--daemon",
            "--storage-root",
            "/tmp/cradle-chronicle",
            "--inbox-root",
            "/tmp/cradle-inbox",
            "--poll-ms",
            "25",
            "--provider",
            "inbox",
            "--run-once",
        ])
        .expect("config should parse");

        assert!(config.daemon);
        assert!(config.run_once);
        assert_eq!(config.inbox_root, PathBuf::from("/tmp/cradle-inbox"));
        assert_eq!(config.provider, CaptureProvider::Inbox);
        assert_eq!(config.poll_interval_ms, 25);
    }

    #[test]
    fn parses_display_id_as_explicit_override() {
        let config = ChronicleConfig::from_args(["--daemon", "--display-id", "42"])
            .expect("config should parse");

        assert_eq!(config.display_id, Some(42));
    }

    #[test]
    fn rejects_zero_capture_limit() {
        let error = ChronicleConfig::from_args(["--capture-limit=0"]).unwrap_err();
        assert!(error.to_string().contains("greater than zero"));
    }
}
