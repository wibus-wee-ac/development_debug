//! ONNX Runtime inference providers for Chronicle local models.
//!
//! All models run locally through ONNX Runtime (`ort` crate with `load-dynamic` feature).
//! Models are downloaded on demand via [`crate::models::ModelManager`].

pub mod asr;
pub mod embedding;
pub mod pii;
pub mod runtime;
pub mod vad;

pub use runtime::OnnxRuntime;

use std::path::Path;
use std::sync::Once;

use ort::session::{Session, builder::GraphOptimizationLevel};

use crate::error::{ChronicleError, ChronicleResult};

static ORT_INIT: Once = Once::new();

/// Initialize ONNX Runtime environment (idempotent).
pub fn init_runtime() {
    ORT_INIT.call_once(|| {
        ort::init().commit();
    });
}

/// Load an ONNX model from disk into a session.
pub fn load_session(model_path: &Path) -> ChronicleResult<Session> {
    init_runtime();

    let mut builder = Session::builder()
        .map_err(|e| ChronicleError::Process(format!("ONNX session builder failed: {e}")))?;

    builder = builder
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| ChronicleError::Process(format!("ONNX optimization level failed: {e}")))?;

    builder = builder
        .with_intra_threads(2)
        .map_err(|e| ChronicleError::Process(format!("ONNX intra threads failed: {e}")))?;

    builder
        .commit_from_file(model_path)
        .map_err(|e| ChronicleError::Process(format!("ONNX session load failed: {e}")))
}
