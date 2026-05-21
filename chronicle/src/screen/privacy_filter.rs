//! Privacy-sensitive window filtering for captured frames.

use crate::screen::{BrowserWindowObservation, CapturedFrame};

const CHROME_BUNDLES: &[&str] = &[
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.google.Chrome.dev",
];

#[derive(Debug, Clone, Copy)]
pub struct PrivacyFilter;

impl Default for PrivacyFilter {
    fn default() -> Self {
        Self
    }
}

impl PrivacyFilter {
    pub fn should_exclude_windows(&self, windows: &[BrowserWindowObservation]) -> bool {
        windows
            .iter()
            .any(|window| self.is_privacy_sensitive_window(window))
    }

    pub fn should_exclude_frame(&self, frame: &CapturedFrame) -> bool {
        self.should_exclude_windows(&frame.windows)
    }

    pub fn is_privacy_sensitive_window(&self, window: &BrowserWindowObservation) -> bool {
        let name = window.name.to_ascii_lowercase();
        let bundle = window.app_bundle_identifier.as_str();
        let url = window.url.as_deref().unwrap_or("").to_ascii_lowercase();

        let is_chrome = CHROME_BUNDLES.contains(&bundle);
        let is_safari =
            bundle == "com.apple.Safari" || bundle == "com.apple.SafariTechnologyPreview";

        window.is_private
            || (is_chrome && (name.contains("incognito") || name.contains("(incognito)")))
            || (is_safari && name.contains("private browsing"))
            || name.contains("private browsing")
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
            frame_extension: "jpg".to_string(),
            observed_text: "frame".to_string(),
            windows: vec![window],
        }
    }

    #[test]
    fn excludes_chrome_incognito() {
        let filter = PrivacyFilter;
        let window = BrowserWindowObservation::new(1, "Search (Incognito)", "com.google.Chrome");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_google_meet_by_url() {
        let filter = PrivacyFilter;
        let window = BrowserWindowObservation::new(1, "Team Call", "com.google.Chrome")
            .with_url("https://meet.google.com/abc-defg-hij");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn allows_regular_cradle_window() {
        let filter = PrivacyFilter;
        let window = BrowserWindowObservation::new(1, "Cradle", "app.cradle.desktop");

        assert!(!filter.should_exclude_frame(&frame(window)));
    }
}
