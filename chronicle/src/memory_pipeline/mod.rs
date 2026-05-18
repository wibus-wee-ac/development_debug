//! Memory generation modules for Cradle Chronicle.
//!
//! Input: persisted recording artifacts.
//! Output: Markdown summaries under the Chronicle storage root.
//! Position: summary boundary; LLM-backed writers can replace local smoke writers.

pub mod naming;
pub mod prompt;
pub mod summarizer;
