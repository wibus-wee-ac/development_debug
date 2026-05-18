//! Runtime configuration for Cradle Chronicle.
//!
//! Input: CLI flags, environment variables, and defaults.
//! Output: a typed configuration used by the recorder and smoke command.
//! Position: boundary between CLI parsing and library code.

use std::env;
use std::path::PathBuf;

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChronicleConfig {
    pub storage_root: PathBuf,
    pub display_id: u32,
    pub capture_limit: usize,
    pub smoke: bool,
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
        let mut display_id = 1;
        let mut capture_limit = 3;
        let mut smoke = false;

        let mut iterator = args.into_iter().map(Into::into).peekable();
        while let Some(arg) = iterator.next() {
            if arg == "--smoke" {
                smoke = true;
            } else if let Some(value) = arg.strip_prefix("--storage-root=") {
                storage_root = PathBuf::from(value);
            } else if arg == "--storage-root" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--storage-root requires a value".to_string())
                })?;
                storage_root = PathBuf::from(value);
            } else if let Some(value) = arg.strip_prefix("--display-id=") {
                display_id = parse_u32("--display-id", value)?;
            } else if arg == "--display-id" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--display-id requires a value".to_string())
                })?;
                display_id = parse_u32("--display-id", &value)?;
            } else if let Some(value) = arg.strip_prefix("--capture-limit=") {
                capture_limit = parse_usize("--capture-limit", value)?;
            } else if arg == "--capture-limit" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--capture-limit requires a value".to_string())
                })?;
                capture_limit = parse_usize("--capture-limit", &value)?;
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
            display_id,
            capture_limit,
            smoke,
        })
    }
}

pub fn usage() -> String {
    "usage: cradle-chronicle --smoke [--storage-root <path>] [--display-id <id>] [--capture-limit <count>]".to_string()
}

fn parse_u32(name: &str, value: &str) -> ChronicleResult<u32> {
    value.parse::<u32>().map_err(|_| {
        ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer"))
    })
}

fn parse_usize(name: &str, value: &str) -> ChronicleResult<usize> {
    value.parse::<usize>().map_err(|_| {
        ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer"))
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::ChronicleConfig;

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
        assert_eq!(config.capture_limit, 2);
    }

    #[test]
    fn rejects_zero_capture_limit() {
        let error = ChronicleConfig::from_args(["--capture-limit=0"]).unwrap_err();
        assert!(error.to_string().contains("greater than zero"));
    }
}
