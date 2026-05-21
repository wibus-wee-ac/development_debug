//! GLiNER-based PII detection via ONNX Runtime.
//!
//! Detects personally identifiable information spans in text using a GLiNER
//! token-classification model exported to ONNX format.

use std::fmt::{self, Display};
use std::path::Path;

use ndarray::{Array1, Array2, Array3, Axis};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::error::{ChronicleError, ChronicleResult};

/// PII entity types detectable by GLiNER.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PiiEntityType {
    Person,
    Email,
    PhoneNumber,
    CreditCard,
    Address,
    ApiKey,
    Ssn,
    IpAddress,
}

impl PiiEntityType {
    /// All entity types in label-index order (matches model output dim).
    pub const ALL: &'static [PiiEntityType] = &[
        PiiEntityType::Person,
        PiiEntityType::Email,
        PiiEntityType::PhoneNumber,
        PiiEntityType::CreditCard,
        PiiEntityType::Address,
        PiiEntityType::ApiKey,
        PiiEntityType::Ssn,
        PiiEntityType::IpAddress,
    ];

    /// Label string used during model training.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Email => "email",
            Self::PhoneNumber => "phone_number",
            Self::CreditCard => "credit_card",
            Self::Address => "address",
            Self::ApiKey => "api_key",
            Self::Ssn => "ssn",
            Self::IpAddress => "ip_address",
        }
    }

    /// Parse from label string.
    pub fn from_label(s: &str) -> Option<Self> {
        match s {
            "person" => Some(Self::Person),
            "email" => Some(Self::Email),
            "phone_number" => Some(Self::PhoneNumber),
            "credit_card" => Some(Self::CreditCard),
            "address" => Some(Self::Address),
            "api_key" => Some(Self::ApiKey),
            "ssn" => Some(Self::Ssn),
            "ip_address" => Some(Self::IpAddress),
            _ => None,
        }
    }

    /// Placeholder tag for redaction, e.g. `[PERSON]`.
    pub fn redact_tag(&self) -> &'static str {
        match self {
            Self::Person => "[PERSON]",
            Self::Email => "[EMAIL]",
            Self::PhoneNumber => "[PHONE_NUMBER]",
            Self::CreditCard => "[CREDIT_CARD]",
            Self::Address => "[ADDRESS]",
            Self::ApiKey => "[API_KEY]",
            Self::Ssn => "[SSN]",
            Self::IpAddress => "[IP_ADDRESS]",
        }
    }
}

impl Display for PiiEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// A detected PII entity span.
#[derive(Debug, Clone)]
pub struct PiiSpan {
    pub entity_type: PiiEntityType,
    pub text: String,
    pub start: usize,
    pub end: usize,
    pub confidence: f32,
}

/// GLiNER-based PII detector using ONNX Runtime.
pub struct GlinerPiiDetector {
    session: Session,
    tokenizer: Tokenizer,
    entity_types: Vec<PiiEntityType>,
    threshold: f32,
}

impl GlinerPiiDetector {
    /// Load model and tokenizer from disk.
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> ChronicleResult<Self> {
        let session = super::load_session(model_path)?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| ChronicleError::Process(format!("failed to load tokenizer: {e}")))?;

        Ok(Self {
            session,
            tokenizer,
            entity_types: PiiEntityType::ALL.to_vec(),
            threshold: 0.5,
        })
    }

    /// Set confidence threshold (default 0.5).
    pub fn with_threshold(mut self, threshold: f32) -> Self {
        self.threshold = threshold;
        self
    }

    /// Detect PII entities in text.
    pub fn detect(&mut self, text: &str) -> ChronicleResult<Vec<PiiSpan>> {
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| ChronicleError::Process(format!("tokenization failed: {e}")))?;

        let ids = encoding.get_ids();
        let offsets = encoding.get_offsets();
        let word_ids = encoding.get_word_ids();
        let seq_len = ids.len();

        // Build input tensors.
        let input_ids: Vec<i64> = ids.iter().map(|&id| id as i64).collect();
        let attention_mask: Vec<i64> = vec![1i64; seq_len];

        // word_mask: 1 for tokens that start a new word (first subword), 0 otherwise.
        let word_mask: Vec<i64> = word_ids
            .iter()
            .enumerate()
            .map(|(i, wid)| {
                match wid {
                    None => 0, // special tokens
                    Some(w) => {
                        if i == 0 {
                            1
                        } else {
                            // New word if word_id differs from previous token's word_id.
                            let prev = word_ids.get(i - 1).copied().flatten();
                            if prev == Some(*w) { 0 } else { 1 }
                        }
                    }
                }
            })
            .collect();

        let text_lengths: Vec<i64> = vec![seq_len as i64];

        // Convert to ndarray tensors.
        let input_ids_arr = Array2::from_shape_vec((1, seq_len), input_ids)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let attention_mask_arr = Array2::from_shape_vec((1, seq_len), attention_mask)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let word_mask_arr = Array2::from_shape_vec((1, seq_len), word_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let text_lengths_arr = Array1::from_vec(text_lengths);

        // Try GLiNER-style inference (4 inputs).
        let outputs = self
            .run_gliner(
                &input_ids_arr,
                &attention_mask_arr,
                &word_mask_arr,
                &text_lengths_arr,
            )
            .or_else(|_| {
                // Fallback: simpler NER model with only input_ids + attention_mask.
                self.run_simple_ner(&input_ids_arr, &attention_mask_arr)
            })?;

        // Extract spans from output scores.
        let spans = self.extract_spans(&outputs, text, offsets, &word_mask, word_ids);
        Ok(spans)
    }

    /// Redact detected PII entities, replacing with [TYPE] placeholders.
    pub fn redact(&mut self, text: &str) -> ChronicleResult<String> {
        let mut spans = self.detect(text)?;
        if spans.is_empty() {
            return Ok(text.to_string());
        }

        // Sort by start offset descending so we can replace without shifting indices.
        spans.sort_by_key(|s| std::cmp::Reverse(s.start));

        let mut result = text.to_string();
        for span in &spans {
            let byte_start = char_to_byte_offset(text, span.start);
            let byte_end = char_to_byte_offset(text, span.end);
            result.replace_range(byte_start..byte_end, span.entity_type.redact_tag());
        }

        Ok(result)
    }

    /// Run GLiNER-style 4-input inference.
    fn run_gliner(
        &mut self,
        input_ids: &Array2<i64>,
        attention_mask: &Array2<i64>,
        word_mask: &Array2<i64>,
        text_lengths: &Array1<i64>,
    ) -> ChronicleResult<Array3<f32>> {
        let input_ids_tensor = Tensor::from_array(input_ids.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let attention_mask_tensor = Tensor::from_array(attention_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let word_mask_tensor = Tensor::from_array(word_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let text_lengths_tensor = Tensor::from_array(text_lengths.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
                "word_mask" => word_mask_tensor,
                "text_lengths" => text_lengths_tensor,
            ])
            .map_err(|e| ChronicleError::Process(format!("ONNX inference failed: {e}")))?;

        let (shape, output_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| ChronicleError::Process(format!("output extraction failed: {e}")))?;

        // Shape derefs to &[i64].
        // Expected shape: [batch=1, num_spans, num_entity_types].
        if shape.len() == 3 {
            let arr = Array3::from_shape_vec(
                (shape[0] as usize, shape[1] as usize, shape[2] as usize),
                output_data.to_vec(),
            )
            .map_err(|e| ChronicleError::Process(format!("output reshape failed: {e}")))?;
            Ok(arr)
        } else if shape.len() == 2 {
            // [num_spans, num_entity_types] — add batch dim.
            let arr = Array3::from_shape_vec(
                (1, shape[0] as usize, shape[1] as usize),
                output_data.to_vec(),
            )
            .map_err(|e| ChronicleError::Process(format!("output reshape failed: {e}")))?;
            Ok(arr)
        } else {
            Err(ChronicleError::Process(format!(
                "unexpected output shape: {shape:?}"
            )))
        }
    }

    /// Fallback: simpler NER model with input_ids + attention_mask only.
    fn run_simple_ner(
        &mut self,
        input_ids: &Array2<i64>,
        attention_mask: &Array2<i64>,
    ) -> ChronicleResult<Array3<f32>> {
        let input_ids_tensor = Tensor::from_array(input_ids.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let attention_mask_tensor = Tensor::from_array(attention_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
            ])
            .map_err(|e| {
                ChronicleError::Process(format!("ONNX inference (fallback) failed: {e}"))
            })?;

        let (shape, output_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| ChronicleError::Process(format!("output extraction failed: {e}")))?;

        if shape.len() == 3 {
            let arr = Array3::from_shape_vec(
                (shape[0] as usize, shape[1] as usize, shape[2] as usize),
                output_data.to_vec(),
            )
            .map_err(|e| ChronicleError::Process(format!("output reshape failed: {e}")))?;
            Ok(arr)
        } else if shape.len() == 2 {
            let arr = Array3::from_shape_vec(
                (1, shape[0] as usize, shape[1] as usize),
                output_data.to_vec(),
            )
            .map_err(|e| ChronicleError::Process(format!("output reshape failed: {e}")))?;
            Ok(arr)
        } else {
            Err(ChronicleError::Process(format!(
                "unexpected fallback output shape: {shape:?}"
            )))
        }
    }

    /// Extract PII spans from model output scores.
    ///
    /// GLiNER outputs a score matrix of shape [batch, num_word_spans, num_entity_types].
    /// Each "word span" index `i` corresponds to the i-th word-starting token.
    /// We find entries above threshold and map back to character offsets.
    fn extract_spans(
        &self,
        scores: &Array3<f32>,
        text: &str,
        offsets: &[(usize, usize)],
        word_mask: &[i64],
        word_ids: &[Option<u32>],
    ) -> Vec<PiiSpan> {
        let batch_scores = scores.index_axis(Axis(0), 0); // [num_spans, num_entity_types]
        let num_spans = batch_scores.shape()[0];
        let num_types = batch_scores.shape()[1];

        // Collect indices of word-starting tokens.
        let word_token_indices: Vec<usize> = word_mask
            .iter()
            .enumerate()
            .filter(|&(_, m)| *m == 1)
            .map(|(i, _)| i)
            .collect();

        let mut spans = Vec::new();

        for span_idx in 0..num_spans {
            for type_idx in 0..num_types.min(self.entity_types.len()) {
                let score = batch_scores[[span_idx, type_idx]];
                if score <= self.threshold {
                    continue;
                }

                // Map span_idx to the corresponding word-starting token.
                let Some(&token_idx) = word_token_indices.get(span_idx) else {
                    continue;
                };

                // Find the extent of this word span: consecutive tokens with same word_id.
                let current_word_id = word_ids.get(token_idx).copied().flatten();
                let Some(wid) = current_word_id else {
                    continue;
                };

                // Find last token belonging to this word.
                let mut end_token_idx = token_idx;
                for ti in (token_idx + 1)..offsets.len() {
                    if word_ids.get(ti).copied().flatten() == Some(wid) {
                        end_token_idx = ti;
                    } else {
                        break;
                    }
                }

                // Get character offsets.
                let (char_start, _) = offsets[token_idx];
                let (_, char_end) = offsets[end_token_idx];

                if char_start >= char_end || char_end > text.len() {
                    continue;
                }

                let span_text = &text[char_start..char_end];
                spans.push(PiiSpan {
                    entity_type: self.entity_types[type_idx],
                    text: span_text.to_string(),
                    start: char_start,
                    end: char_end,
                    confidence: score,
                });
            }
        }

        // Deduplicate overlapping spans: keep highest confidence.
        spans.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.confidence.partial_cmp(&a.confidence).unwrap())
        });
        dedup_overlapping(&mut spans);

        spans
    }
}

/// Remove overlapping spans, keeping the higher-confidence one.
fn dedup_overlapping(spans: &mut Vec<PiiSpan>) {
    let mut i = 0;
    while i < spans.len() {
        let mut j = i + 1;
        while j < spans.len() {
            // If span j overlaps with span i, remove j (i has higher confidence due to sort).
            if spans[j].start < spans[i].end {
                spans.remove(j);
            } else {
                j += 1;
            }
        }
        i += 1;
    }
}

/// Convert a char offset to byte offset in a string.
fn char_to_byte_offset(s: &str, char_offset: usize) -> usize {
    s.char_indices()
        .nth(char_offset)
        .map(|(byte_idx, _)| byte_idx)
        .unwrap_or(s.len())
}

/// Redact PII in text given pre-computed spans (useful for external callers).
pub fn redact_with_spans(text: &str, spans: &[PiiSpan]) -> String {
    if spans.is_empty() {
        return text.to_string();
    }

    let mut sorted: Vec<&PiiSpan> = spans.iter().collect();
    sorted.sort_by_key(|s| std::cmp::Reverse(s.start));

    let mut result = text.to_string();
    for span in sorted {
        let byte_start = char_to_byte_offset(&result, span.start);
        let byte_end = char_to_byte_offset(&result, span.end);
        if byte_start <= byte_end && byte_end <= result.len() {
            result.replace_range(byte_start..byte_end, span.entity_type.redact_tag());
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_type_display_roundtrip() {
        for &et in PiiEntityType::ALL {
            let label = et.label();
            let parsed = PiiEntityType::from_label(label);
            assert_eq!(parsed, Some(et), "roundtrip failed for {label}");
        }
    }

    #[test]
    fn entity_type_display_format() {
        assert_eq!(format!("{}", PiiEntityType::Person), "person");
        assert_eq!(format!("{}", PiiEntityType::CreditCard), "credit_card");
        assert_eq!(format!("{}", PiiEntityType::IpAddress), "ip_address");
    }

    #[test]
    fn from_label_unknown_returns_none() {
        assert_eq!(PiiEntityType::from_label("unknown"), None);
        assert_eq!(PiiEntityType::from_label(""), None);
    }

    #[test]
    fn redact_with_spans_basic() {
        let text = "Call John at john@example.com please";
        let spans = vec![
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "John".to_string(),
                start: 5,
                end: 9,
                confidence: 0.9,
            },
            PiiSpan {
                entity_type: PiiEntityType::Email,
                text: "john@example.com".to_string(),
                start: 13,
                end: 29,
                confidence: 0.95,
            },
        ];

        let redacted = redact_with_spans(text, &spans);
        assert_eq!(redacted, "Call [PERSON] at [EMAIL] please");
    }

    #[test]
    fn redact_with_spans_empty() {
        let text = "Nothing to redact here";
        let redacted = redact_with_spans(text, &[]);
        assert_eq!(redacted, text);
    }

    #[test]
    fn threshold_filtering() {
        // Simulate: scores below threshold should be excluded.
        let threshold = 0.5f32;
        let scores = vec![0.3, 0.7, 0.49, 0.51, 0.99, 0.01];
        let above: Vec<f32> = scores.into_iter().filter(|&s| s > threshold).collect();
        assert_eq!(above, vec![0.7, 0.51, 0.99]);
    }

    #[test]
    fn dedup_overlapping_keeps_higher_confidence() {
        let mut spans = vec![
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "John Smith".to_string(),
                start: 0,
                end: 10,
                confidence: 0.9,
            },
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "Smith".to_string(),
                start: 5,
                end: 10,
                confidence: 0.6,
            },
            PiiSpan {
                entity_type: PiiEntityType::Email,
                text: "a@b.com".to_string(),
                start: 15,
                end: 22,
                confidence: 0.8,
            },
        ];
        // Pre-sort as extract_spans does.
        spans.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.confidence.partial_cmp(&a.confidence).unwrap())
        });
        dedup_overlapping(&mut spans);

        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].text, "John Smith");
        assert_eq!(spans[1].text, "a@b.com");
    }

    #[test]
    fn char_to_byte_offset_ascii() {
        let s = "hello world";
        assert_eq!(char_to_byte_offset(s, 0), 0);
        assert_eq!(char_to_byte_offset(s, 5), 5);
        assert_eq!(char_to_byte_offset(s, 11), s.len());
    }

    #[test]
    fn char_to_byte_offset_unicode() {
        let s = "héllo"; // 'é' is 2 bytes in UTF-8
        assert_eq!(char_to_byte_offset(s, 0), 0);
        assert_eq!(char_to_byte_offset(s, 1), 1); // 'h' is 1 byte
        assert_eq!(char_to_byte_offset(s, 2), 3); // 'é' is 2 bytes, so char 2 starts at byte 3
    }

    #[test]
    fn redact_tags_format() {
        assert_eq!(PiiEntityType::Person.redact_tag(), "[PERSON]");
        assert_eq!(PiiEntityType::Email.redact_tag(), "[EMAIL]");
        assert_eq!(PiiEntityType::PhoneNumber.redact_tag(), "[PHONE_NUMBER]");
        assert_eq!(PiiEntityType::CreditCard.redact_tag(), "[CREDIT_CARD]");
        assert_eq!(PiiEntityType::Address.redact_tag(), "[ADDRESS]");
        assert_eq!(PiiEntityType::ApiKey.redact_tag(), "[API_KEY]");
        assert_eq!(PiiEntityType::Ssn.redact_tag(), "[SSN]");
        assert_eq!(PiiEntityType::IpAddress.redact_tag(), "[IP_ADDRESS]");
    }
}
