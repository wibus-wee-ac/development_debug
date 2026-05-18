//! OCR abstraction for Cradle Chronicle.
//!
//! Input: captured frames from the screen module.
//! Output: normalized text that can be persisted and summarized.
//! Position: replaceable boundary for platform OCR, Tesseract, or plugin text feeds.

use crate::error::ChronicleResult;
use crate::screen::CapturedFrame;

pub trait TextExtractor {
    fn extract_text(&self, frame: &CapturedFrame) -> ChronicleResult<OcrText>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OcrText {
    pub normalized_text: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ObservedTextExtractor;

impl TextExtractor for ObservedTextExtractor {
    fn extract_text(&self, frame: &CapturedFrame) -> ChronicleResult<OcrText> {
        Ok(OcrText {
            normalized_text: normalize_observed_text(&frame.observed_text),
        })
    }
}

pub fn normalize_observed_text(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::normalize_observed_text;

    #[test]
    fn normalizes_whitespace() {
        assert_eq!(
            normalize_observed_text(" Cradle\n\nChronicle\tmemory  "),
            "Cradle Chronicle memory"
        );
    }
}
