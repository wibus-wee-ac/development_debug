//! Cradle-owned passive context and memory pipeline.
//!
//! LLM providers plug into traits instead of owning the storage contract.

pub mod audio;
#[allow(dead_code)]
pub(crate) mod codex_exec;
pub mod config;
pub mod cradle_client;
pub mod cron;
pub mod crystallizer;
pub mod daemon;
pub mod dedup;
pub mod dream;
pub mod embedding;
pub mod error;
pub(crate) mod json;
pub mod meeting;
pub mod memory_pipeline;
pub mod models;
pub mod ocr;
pub mod onnx;
pub mod pii;
pub mod pipeline;
pub mod recorder;
pub mod screen;
pub mod search;
pub mod segmenter;
pub mod slack;
pub mod time;
pub mod transcript_inbox;
pub mod triage;

pub use config::ChronicleConfig;
pub use error::{ChronicleError, ChronicleResult};
pub use recorder::manager::{RecorderManager, RecorderReport};
