//! HTTP client for Cradle Server integration.
//!
//! Input: Cradle Server URL (from env or config).
//! Output: dynamic config fetch and LLM summarization via Cradle's API.
//! Position: replaces codex_exec.rs as the LLM invocation boundary.

use std::env;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};

const DEFAULT_CRADLE_URL: &str = "http://127.0.0.1:21423";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONFIG_TIMEOUT: Duration = Duration::from_secs(5);

/// Dynamic configuration fetched from Cradle Server before each summarization.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleRemoteConfig {
    pub profile_id: String,
    pub model_id: String,
    pub workspace_id: String,
    pub enabled: bool,
}

/// Request body for the summarize endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeRequest {
    prompt: String,
    window_type: String,
}

/// Response from the summarize endpoint.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeResponse {
    summary: String,
}

/// HTTP client for communicating with Cradle Server.
#[derive(Debug, Clone)]
pub struct CradleClient {
    base_url: String,
}

impl CradleClient {
    /// Create a new client. Reads `CRADLE_URL` env var, falls back to default.
    pub fn from_env() -> Self {
        let base_url = env::var("CRADLE_URL")
            .unwrap_or_else(|_| DEFAULT_CRADLE_URL.to_string());
        Self { base_url }
    }

    /// Create a client with an explicit URL.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self { base_url: base_url.into() }
    }

    /// Fetch current Chronicle configuration from Cradle Server.
    /// Returns None if the server is unreachable (graceful degradation).
    pub fn fetch_config(&self) -> Option<ChronicleRemoteConfig> {
        let url = format!("{}/api/chronicle/config", self.base_url);
        match ureq::get(&url)
            .config()
            .timeout_global(Some(CONFIG_TIMEOUT))
            .build()
            .call()
        {
            Ok(mut response) => {
                match response.body_mut().read_to_string() {
                    Ok(body) => serde_json::from_str(&body).ok(),
                    Err(_) => None,
                }
            }
            Err(_) => None,
        }
    }

    /// Call Cradle Server to generate an LLM summary.
    /// Returns the generated markdown summary.
    pub fn summarize(&self, prompt: &str, window_type: &str) -> ChronicleResult<String> {
        let url = format!("{}/api/chronicle/summarize", self.base_url);
        let body = SummarizeRequest {
            prompt: prompt.to_string(),
            window_type: window_type.to_string(),
        };

        let json_body = serde_json::to_string(&body)
            .map_err(|e| ChronicleError::Process(format!("failed to serialize request: {e}")))?;

        let mut response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send(json_body.as_bytes())
            .map_err(|e| ChronicleError::Process(format!(
                "Cradle Server summarize request failed: {e}"
            )))?;

        let response_body = response.body_mut().read_to_string()
            .map_err(|e| ChronicleError::Process(format!(
                "failed to read summarize response: {e}"
            )))?;

        let parsed: SummarizeResponse = serde_json::from_str(&response_body)
            .map_err(|e| ChronicleError::Process(format!(
                "failed to parse summarize response: {e}"
            )))?;

        Ok(parsed.summary)
    }

    /// Check if Cradle Server is reachable.
    pub fn is_available(&self) -> bool {
        self.fetch_config().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::CradleClient;

    #[test]
    fn client_from_env_uses_default() {
        let client = CradleClient::from_env();
        // Default URL when CRADLE_URL not set
        assert!(client.base_url.contains("127.0.0.1"));
    }

    #[test]
    fn fetch_config_returns_none_when_unavailable() {
        let client = CradleClient::new("http://127.0.0.1:1"); // port 1 = unreachable
        assert!(client.fetch_config().is_none());
    }

    #[test]
    fn is_available_returns_false_when_unreachable() {
        let client = CradleClient::new("http://127.0.0.1:1");
        assert!(!client.is_available());
    }
}
