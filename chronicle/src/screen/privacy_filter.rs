//! Privacy-sensitive window filtering for captured frames.
//!
//! Input: observed window titles, bundle identifiers, URLs, and private flags.
//! Output: exclusion decisions before artifacts are persisted.
//! Position: recorder safety gate matching the Chronicle draft privacy boundary.

use crate::screen::{BrowserWindowObservation, CapturedFrame};

#[derive(Debug, Clone)]
pub struct PrivacyFilter {
    chrome_bundles: Vec<&'static str>,
}

impl Default for PrivacyFilter {
    fn default() -> Self {
        Self {
            chrome_bundles: vec![
                "com.google.Chrome",
                "com.google.Chrome.beta",
                "com.google.Chrome.canary",
                "com.google.Chrome.dev",
            ],
        }
    }
}

impl PrivacyFilter {
    pub fn should_exclude_frame(&self, frame: &CapturedFrame) -> bool {
        frame
            .windows
            .iter()
            .any(|window| self.is_privacy_sensitive_window(window))
    }

    pub fn is_privacy_sensitive_window(&self, window: &BrowserWindowObservation) -> bool {
        let name = window.name.to_ascii_lowercase();
        let bundle = window.app_bundle_identifier.as_str();
        let url = window.url.as_deref().unwrap_or("").to_ascii_lowercase();

        let is_chrome = self.chrome_bundles.iter().any(|candidate| *candidate == bundle);
        let is_safari = bundle == "com.apple.Safari"
            || bundle == "com.apple.SafariTechnologyPreview";

        window.is_private
            || (is_chrome && (name.contains("incognito") || name.contains("(incognito)")))
            || (is_safari && name.contains("private browsing"))
            || name.contains("google meet")
            || url.contains("meet.google.com")
    }
}

#[cfg(test)]
mod tests {
    use crate::screen::{BrowserWindowObservation, CapturedFrame};
    use crate::time::Timestamp;

    use super::PrivacyFilter;

    fn frame(window: BrowserWindowObservation) -> CapturedFrame {
        CapturedFrame {
            display_id: 1,
            frame_index: 1,
            captured_at: Timestamp::from_seconds(1),
            bytes: b"frame".to_vec(),
            observed_text: "frame".to_string(),
            windows: vec![window],
        }
    }

    #[test]
    fn excludes_chrome_incognito() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(
            1,
            "Search (Incognito)",
            "com.google.Chrome",
        );

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_google_meet_by_url() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(1, "Team Call", "com.google.Chrome")
            .with_url("https://meet.google.com/abc-defg-hij");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn allows_regular_cradle_window() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(1, "Cradle", "app.cradle.desktop");

        assert!(!filter.should_exclude_frame(&frame(window)));
    }
}
