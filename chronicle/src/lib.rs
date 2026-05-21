//! Cradle-owned passive context and memory pipeline.
//!
//! LLM providers plug into traits instead of owning the storage contract.

pub mod audio;
#[allow(dead_code)]
pub(crate) mod codex_exec;
pub mod config;
pub mod cradle_client;
pub mod daemon;
pub mod error;
pub(crate) mod json;
pub mod memory_pipeline;
pub mod ocr;
pub mod recorder;
pub mod screen;
pub mod time;
pub mod transcript_inbox;

pub use config::ChronicleConfig;
pub use error::{ChronicleError, ChronicleResult};
pub use recorder::manager::{RecorderManager, RecorderReport};
