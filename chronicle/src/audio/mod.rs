//! Local audio capture foundations for Chronicle runtime diagnostics.

pub mod activity;
pub mod capture;
pub mod wav;

pub use activity::{AudioActivityReport, BoundedPcmBuffer, RmsActivityGate};
pub use capture::{
    AudioDiagnosticsReport, MicrophoneCaptureReport, capture_microphone_samples,
    record_microphone_diagnostics,
};
pub use wav::{AudioArtifactMetadata, WavArtifact, write_audio_segment_artifact};
