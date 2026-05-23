//! Cradle-owned passive context and memory pipeline.
//!
//! LLM providers plug into traits instead of owning the storage contract.

pub mod audio;
pub mod capabilities;
#[allow(dead_code)]
pub(crate) mod codex_exec;
pub mod config;
pub mod core;
pub mod cron;
pub mod crystallizer;
pub mod daemon;
pub mod dedup;
pub mod dream;
pub mod embedding;
pub mod error;
pub mod integrations;
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
pub mod store;
pub mod time;
pub mod triage;

pub use config::ChronicleConfig;
pub use error::{ChronicleError, ChronicleResult};
pub use recorder::manager::{RecorderManager, RecorderReport};
