//! Recorder pipeline modules.
//!
//! Input: captured frames and extracted text.
//! Output: persisted artifacts and recorder reports.
//! Position: owns Chronicle's capture-to-storage contract.

pub mod artifacts;
pub mod fingerprint;
pub mod manager;
pub mod sampler;
