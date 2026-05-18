//! Capture source abstractions for Cradle Chronicle.
//!
//! Input: platform capture APIs, browser/plugin feeds, or synthetic frames.
//! Output: normalized captured frames for recorder processing.
//! Position: input boundary; storage and memory modules do not depend on platform APIs.

pub mod privacy_filter;
pub mod synthetic;

use crate::error::ChronicleResult;
use crate::time::Timestamp;

pub trait CaptureSource {
    fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedFrame {
    pub display_id: u32,
    pub frame_index: u64,
    pub captured_at: Timestamp,
    pub bytes: Vec<u8>,
    pub observed_text: String,
    pub windows: Vec<BrowserWindowObservation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserWindowObservation {
    pub id: u32,
    pub name: String,
    pub app_bundle_identifier: String,
    pub url: Option<String>,
    pub is_private: bool,
}

impl BrowserWindowObservation {
    pub fn new(
        id: u32,
        name: impl Into<String>,
        app_bundle_identifier: impl Into<String>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            app_bundle_identifier: app_bundle_identifier.into(),
            url: None,
            is_private: false,
        }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    pub fn with_private_flag(mut self) -> Self {
        self.is_private = true;
        self
    }
}
