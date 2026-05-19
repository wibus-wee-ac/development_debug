//! Cradle-owned passive context and memory pipeline.
//!
//! Input: platform or synthetic capture sources that provide observed frames.
//! Output: durable Chronicle artifacts and local memory summaries.
//! Position: independent Rust crate under Cradle ownership; platform capture and
//! LLM providers plug into traits instead of owning the storage contract.

#[allow(dead_code)]
pub(crate) mod codex_exec;
pub mod config;
pub mod daemon;
pub mod error;
pub(crate) mod json;
pub mod memory_pipeline;
pub mod ocr;
pub mod recorder;
pub mod screen;
pub mod time;

pub use config::ChronicleConfig;
pub use error::{ChronicleError, ChronicleResult};
pub use recorder::manager::{RecorderManager, RecorderReport};
