//! Chronicle memory file naming.
//!
//! Input: capture timestamp, time window, and description text.
//! Output: filesystem-safe memory filename.
//! Position: stable contract for files under `memories/`.

use crate::time::Timestamp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryWindow {
    TenMinutes,
    SixHours,
    Custom(String),
}

impl MemoryWindow {
    pub fn label(&self) -> &str {
        match self {
            Self::TenMinutes => "10min",
            Self::SixHours => "6h",
            Self::Custom(value) => value.as_str(),
        }
    }
}

pub fn memory_filename(timestamp: Timestamp, window: &MemoryWindow, description: &str) -> String {
    let suffix = stable_suffix(description);
    let slug = slugify(description);
    format!(
        "{}-{}-{}-{}.md",
        timestamp.compact(),
        suffix,
        window.label(),
        slug
    )
}

fn stable_suffix(input: &str) -> String {
    let mut hash = 0x811c_9dc5u32;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
    (0..4)
        .map(|shift| {
            let index = ((hash >> (shift * 5)) as usize) % alphabet.len();
            alphabet[index] as char
        })
        .collect()
}

pub fn slugify(input: &str) -> String {
    let mut output = String::new();
    let mut previous_was_separator = false;

    for character in input.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator && !output.is_empty() {
            output.push('_');
            previous_was_separator = true;
        }
    }

    while output.ends_with('_') {
        output.pop();
    }

    if output.is_empty() {
        "memory".to_string()
    } else {
        output.chars().take(64).collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::time::Timestamp;

    use super::{MemoryWindow, memory_filename, slugify};

    #[test]
    fn creates_chronicle_style_filename() {
        let name = memory_filename(
            Timestamp::from_seconds(1_779_125_791),
            &MemoryWindow::TenMinutes,
            "Debugging Cradle Chronicle smoke flow",
        );

        assert!(name.starts_with("20260518173631-"));
        assert!(name.contains("-10min-debugging_cradle_chronicle_smoke_flow.md"));
    }

    #[test]
    fn slug_falls_back_for_empty_input() {
        assert_eq!(slugify("!!!"), "memory");
    }
}
