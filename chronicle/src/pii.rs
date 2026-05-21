//! PII detection and redaction for Chronicle text processing.

use serde::{Deserialize, Serialize};

/// Types of PII that can be detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PiiType {
    Email,
    Phone,
    CreditCard,
    ApiKey,
    IpAddress,
    Url,
    SocialSecurity,
    Sensitive,
}

impl PiiType {
    fn label(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Phone => "phone",
            Self::CreditCard => "credit_card",
            Self::ApiKey => "api_key",
            Self::IpAddress => "ip_address",
            Self::Url => "url",
            Self::SocialSecurity => "ssn",
            Self::Sensitive => "sensitive",
        }
    }

    /// Priority for overlap resolution. Lower = higher priority (more specific).
    fn priority(&self) -> u8 {
        match self {
            Self::SocialSecurity => 0,
            Self::CreditCard => 1,
            Self::IpAddress => 2,
            Self::ApiKey => 3,
            Self::Email => 4,
            Self::Phone => 10, // least specific, catches many digit sequences
            Self::Url => 5,
            Self::Sensitive => 20,
        }
    }
}

/// A detected PII entity in text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PiiEntity {
    pub pii_type: PiiType,
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// Result of PII redaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactedText {
    pub text: String,
    pub entities_found: Vec<PiiEntity>,
    pub entity_count: usize,
}

/// Configuration for PII detection.
#[derive(Debug, Clone)]
pub struct PiiConfig {
    pub detect_email: bool,
    pub detect_phone: bool,
    pub detect_credit_card: bool,
    pub detect_api_key: bool,
    pub detect_ip: bool,
    pub detect_url: bool,
    pub detect_ssn: bool,
    pub use_remote_model: bool,
    pub remote_url: String,
}

impl Default for PiiConfig {
    fn default() -> Self {
        Self {
            detect_email: true,
            detect_phone: true,
            detect_credit_card: true,
            detect_api_key: true,
            detect_ip: true,
            detect_url: true,
            detect_ssn: true,
            use_remote_model: false,
            remote_url: String::new(),
        }
    }
}

/// PII detector and redactor.
#[derive(Default)]
pub struct PiiRedactor {
    config: PiiConfig,
}

impl PiiRedactor {
    pub fn new(config: PiiConfig) -> Self {
        Self { config }
    }

    /// Detect all PII entities in the given text.
    pub fn detect(&self, text: &str) -> Vec<PiiEntity> {
        let mut entities = Vec::new();

        if self.config.detect_email {
            entities.extend(detect_emails(text));
        }
        if self.config.detect_phone {
            entities.extend(detect_phones(text));
        }
        if self.config.detect_credit_card {
            entities.extend(detect_credit_cards(text));
        }
        if self.config.detect_api_key {
            entities.extend(detect_api_keys(text));
        }
        if self.config.detect_ip {
            entities.extend(detect_ip_addresses(text));
        }
        if self.config.detect_ssn {
            entities.extend(detect_ssns(text));
        }

        // Sort by start offset, longest match, then priority (specific patterns first).
        entities.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.end.cmp(&a.end))
                .then(a.pii_type.priority().cmp(&b.pii_type.priority()))
        });

        // Remove overlapping entities (keep the first/most-specific).
        let mut deduped: Vec<PiiEntity> = Vec::new();
        for entity in entities {
            if let Some(last) = deduped.last()
                && entity.start < last.end
            {
                continue; // overlapping, skip
            }
            deduped.push(entity);
        }

        deduped
    }

    /// Redact all PII in text, replacing with `[REDACTED:type]` placeholders.
    pub fn redact(&self, text: &str) -> RedactedText {
        let entities = self.detect(text);
        let entity_count = entities.len();

        if entities.is_empty() {
            return RedactedText {
                text: text.to_string(),
                entities_found: entities,
                entity_count,
            };
        }

        // Work backward to preserve byte offsets.
        let mut result = text.to_string();
        for entity in entities.iter().rev() {
            let replacement = format!("[REDACTED:{}]", entity.pii_type.label());
            result.replace_range(entity.start..entity.end, &replacement);
        }

        RedactedText {
            text: result,
            entities_found: entities,
            entity_count,
        }
    }

    /// Quick check if text contains any PII.
    pub fn is_sensitive(&self, text: &str) -> bool {
        !self.detect(text).is_empty()
    }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '-' || c == '+'
}

fn is_domain_char(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '.'
}

/// Detect email addresses by scanning for `@`.
fn detect_emails(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();
    let bytes = text.as_bytes();

    for (i, &b) in bytes.iter().enumerate() {
        if b != b'@' {
            continue;
        }

        // Find local part (before @).
        let mut local_start = i;
        while local_start > 0
            && is_word_char(
                text[local_start - 1..local_start]
                    .chars()
                    .next()
                    .unwrap_or(' '),
            )
        {
            local_start -= 1;
        }
        if local_start == i {
            continue; // no local part
        }

        // Find domain part (after @).
        let mut domain_end = i + 1;
        while domain_end < bytes.len()
            && is_domain_char(
                text[domain_end..domain_end + 1]
                    .chars()
                    .next()
                    .unwrap_or(' '),
            )
        {
            domain_end += 1;
        }

        // Domain must contain at least one dot.
        let domain = &text[i + 1..domain_end];
        if !domain.contains('.') || domain.len() < 3 {
            continue;
        }
        // Don't end with a dot.
        let domain_end = if text[domain_end - 1..domain_end].starts_with('.') {
            domain_end - 1
        } else {
            domain_end
        };
        let domain = &text[i + 1..domain_end];
        if domain.is_empty() || !domain.contains('.') {
            continue;
        }

        results.push(PiiEntity {
            pii_type: PiiType::Email,
            start: local_start,
            end: domain_end,
            text: text[local_start..domain_end].to_string(),
        });
    }

    results
}

/// Detect phone numbers: sequences of 10+ digits with optional separators.
fn detect_phones(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check if we're at the start of a phone-like sequence.
        if !chars[i].is_ascii_digit() && chars[i] != '+' && chars[i] != '(' {
            i += 1;
            continue;
        }

        let start_byte = text.char_indices().nth(i).map(|(idx, _)| idx).unwrap_or(0);
        let mut j = i;
        let mut digit_count = 0;

        while j < len {
            let c = chars[j];
            if c.is_ascii_digit() {
                digit_count += 1;
                j += 1;
            } else if c == '-' || c == ' ' || c == '.' || c == '(' || c == ')' || c == '+' {
                j += 1;
            } else {
                break;
            }
        }

        if digit_count >= 10 {
            let end_byte = text
                .char_indices()
                .nth(j)
                .map(|(idx, _)| idx)
                .unwrap_or(text.len());
            // Trim trailing separators.
            let trimmed = text[start_byte..end_byte].trim_end_matches(['-', ' ', '.', ')']);
            let actual_end = start_byte + trimmed.len();

            results.push(PiiEntity {
                pii_type: PiiType::Phone,
                start: start_byte,
                end: actual_end,
                text: text[start_byte..actual_end].to_string(),
            });
            i = j;
        } else {
            i += 1;
        }
    }

    results
}

/// Detect credit card numbers: 13-19 digit sequences with optional separators.
fn detect_credit_cards(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }

        let start_byte = text.char_indices().nth(i).map(|(idx, _)| idx).unwrap_or(0);
        let mut j = i;
        let mut digit_count = 0;
        let mut has_separator = false;

        while j < len {
            let c = chars[j];
            if c.is_ascii_digit() {
                digit_count += 1;
                j += 1;
            } else if c == '-' || c == ' ' {
                has_separator = true;
                j += 1;
            } else {
                break;
            }
        }

        // Credit cards are 13-19 digits, and typically have separators (to distinguish from random numbers).
        if (13..=19).contains(&digit_count) && has_separator {
            let end_byte = text
                .char_indices()
                .nth(j)
                .map(|(idx, _)| idx)
                .unwrap_or(text.len());
            let trimmed = text[start_byte..end_byte].trim_end_matches(['-', ' ']);
            let actual_end = start_byte + trimmed.len();

            results.push(PiiEntity {
                pii_type: PiiType::CreditCard,
                start: start_byte,
                end: actual_end,
                text: text[start_byte..actual_end].to_string(),
            });
            i = j;
        } else {
            i += 1;
        }
    }

    results
}

/// Known API key prefixes.
const API_KEY_PREFIXES: &[&str] = &[
    "sk-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "ghp_",
    "gho_",
    "github_pat_",
    "AKIA",
    "Bearer ",
    "sk_live_",
    "sk_test_",
    "pk_live_",
    "pk_test_",
    "rk_live_",
    "rk_test_",
];

/// Detect API keys by checking for known prefixes.
fn detect_api_keys(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();

    for prefix in API_KEY_PREFIXES {
        let mut search_from = 0;
        while let Some(pos) = text[search_from..].find(prefix) {
            let start = search_from + pos;
            // Extend to end of token (non-whitespace, non-comma, non-quote).
            let mut end = start + prefix.len();
            let bytes = text.as_bytes();
            while end < bytes.len() {
                let c = bytes[end];
                if c == b' '
                    || c == b'\n'
                    || c == b'\r'
                    || c == b'\t'
                    || c == b','
                    || c == b'"'
                    || c == b'\''
                    || c == b';'
                {
                    break;
                }
                end += 1;
            }

            // Must have content after prefix.
            if end > start + prefix.len() {
                results.push(PiiEntity {
                    pii_type: PiiType::ApiKey,
                    start,
                    end,
                    text: text[start..end].to_string(),
                });
            }

            search_from = end;
        }
    }

    results
}

/// Detect IPv4 addresses.
fn detect_ip_addresses(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }

        // Try to parse four octets.
        let start = i;
        let mut valid = true;
        let mut end = i;

        for octet_idx in 0..4 {
            // Parse digits.
            let mut num: u32 = 0;
            let mut digit_count = 0;
            while end < len && bytes[end].is_ascii_digit() && digit_count < 4 {
                num = num * 10 + (bytes[end] - b'0') as u32;
                digit_count += 1;
                end += 1;
            }

            if digit_count == 0 || num > 255 {
                valid = false;
                break;
            }

            // After the last octet, no dot needed.
            if octet_idx < 3 {
                if end < len && bytes[end] == b'.' {
                    end += 1;
                } else {
                    valid = false;
                    break;
                }
            }
        }

        if valid && end > start {
            // Make sure it's not part of a longer number/word.
            let before_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            let after_ok = end >= len || !bytes[end].is_ascii_digit();

            if before_ok && after_ok {
                results.push(PiiEntity {
                    pii_type: PiiType::IpAddress,
                    start,
                    end,
                    text: text[start..end].to_string(),
                });
                i = end;
                continue;
            }
        }

        i += 1;
    }

    results
}

/// Detect SSN patterns: XXX-XX-XXXX.
fn detect_ssns(text: &str) -> Vec<PiiEntity> {
    let mut results = Vec::new();
    let bytes = text.as_bytes();
    let len = bytes.len();

    // Need at least 11 chars: XXX-XX-XXXX
    if len < 11 {
        return results;
    }

    let mut i = 0;
    while i + 10 < len {
        // Check pattern: 3 digits, dash, 2 digits, dash, 4 digits.
        if bytes[i].is_ascii_digit()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3] == b'-'
            && bytes[i + 4].is_ascii_digit()
            && bytes[i + 5].is_ascii_digit()
            && bytes[i + 6] == b'-'
            && bytes[i + 7].is_ascii_digit()
            && bytes[i + 8].is_ascii_digit()
            && bytes[i + 9].is_ascii_digit()
            && bytes[i + 10].is_ascii_digit()
        {
            let end = i + 11;
            // Not part of a longer number.
            let before_ok = i == 0 || !bytes[i - 1].is_ascii_digit();
            let after_ok = end >= len || !bytes[end].is_ascii_digit();

            if before_ok && after_ok {
                results.push(PiiEntity {
                    pii_type: PiiType::SocialSecurity,
                    start: i,
                    end,
                    text: text[i..end].to_string(),
                });
                i = end;
                continue;
            }
        }

        i += 1;
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_email_addresses() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("Contact us at hello@example.com for info.");
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].pii_type, PiiType::Email);
        assert_eq!(entities[0].text, "hello@example.com");
    }

    #[test]
    fn detects_phone_numbers() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("Call me at +1-555-123-4567 today.");
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].pii_type, PiiType::Phone);
        assert!(entities[0].text.contains("555"));
    }

    #[test]
    fn detects_credit_card_numbers() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("Card: 4111-1111-1111-1111 is a test card.");
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].pii_type, PiiType::CreditCard);
        assert_eq!(entities[0].text, "4111-1111-1111-1111");
    }

    #[test]
    fn detects_api_keys() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("Token: sk-abc123def456 and xoxb-something-here");
        let api_keys: Vec<_> = entities
            .iter()
            .filter(|e| e.pii_type == PiiType::ApiKey)
            .collect();
        assert_eq!(api_keys.len(), 2);
        assert!(api_keys[0].text.starts_with("sk-"));
        assert!(api_keys[1].text.starts_with("xoxb-"));
    }

    #[test]
    fn detects_ip_addresses() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("Server at 192.168.1.100 is down.");
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].pii_type, PiiType::IpAddress);
        assert_eq!(entities[0].text, "192.168.1.100");
    }

    #[test]
    fn detects_ssn() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("SSN: 123-45-6789 on file.");
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].pii_type, PiiType::SocialSecurity);
        assert_eq!(entities[0].text, "123-45-6789");
    }

    #[test]
    fn redacts_all_pii_in_mixed_text() {
        let redactor = PiiRedactor::default();
        let input = "Email me at user@test.org, my SSN is 111-22-3333.";
        let result = redactor.redact(input);
        assert!(result.text.contains("[REDACTED:email]"));
        assert!(result.text.contains("[REDACTED:ssn]"));
        assert!(!result.text.contains("user@test.org"));
        assert!(!result.text.contains("111-22-3333"));
        assert_eq!(result.entity_count, 2);
    }

    #[test]
    fn is_sensitive_returns_true_for_pii() {
        let redactor = PiiRedactor::default();
        assert!(redactor.is_sensitive("my email is foo@bar.com"));
    }

    #[test]
    fn is_sensitive_returns_false_for_clean_text() {
        let redactor = PiiRedactor::default();
        assert!(!redactor.is_sensitive("Hello world, this is a normal sentence."));
    }

    #[test]
    fn handles_empty_input() {
        let redactor = PiiRedactor::default();
        let entities = redactor.detect("");
        assert!(entities.is_empty());
        let result = redactor.redact("");
        assert_eq!(result.text, "");
        assert_eq!(result.entity_count, 0);
    }

    #[test]
    fn handles_overlapping_patterns() {
        let redactor = PiiRedactor::default();
        // An SSN embedded in what could look like a phone-ish sequence.
        let entities = redactor.detect("Number: 123-45-6789");
        // Should detect SSN (more specific pattern wins via ordering).
        let ssns: Vec<_> = entities
            .iter()
            .filter(|e| e.pii_type == PiiType::SocialSecurity)
            .collect();
        assert!(!ssns.is_empty());
    }
}
