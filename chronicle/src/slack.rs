//! Slack message scanner using the Web API (conversations.history polling).

use std::collections::HashMap;
use std::env;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};

const DEFAULT_POLL_INTERVAL: u64 = 30;
const DEFAULT_BASE_URL: &str = "https://slack.com/api";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Configuration for the Slack scanner.
#[derive(Debug, Clone)]
pub struct SlackConfig {
    pub bot_token: String,
    pub channel_ids: Vec<String>,
    pub poll_interval_seconds: u64,
    pub base_url: String,
}

impl SlackConfig {
    /// Build config from environment variables.
    ///
    /// Required: `SLACK_BOT_TOKEN`
    /// Optional: `SLACK_CHANNEL_IDS` (comma-separated), `SLACK_POLL_INTERVAL`, `SLACK_BASE_URL`
    pub fn from_env() -> ChronicleResult<Self> {
        let bot_token = env::var("SLACK_BOT_TOKEN").map_err(|_| {
            ChronicleError::InvalidArgument(
                "SLACK_BOT_TOKEN environment variable is required".into(),
            )
        })?;

        let channel_ids = env::var("SLACK_CHANNEL_IDS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let poll_interval_seconds = env::var("SLACK_POLL_INTERVAL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_POLL_INTERVAL);

        let base_url = env::var("SLACK_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.into());

        Ok(Self {
            bot_token,
            channel_ids,
            poll_interval_seconds,
            base_url,
        })
    }
}

/// A Slack message normalized for Chronicle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackMessage {
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub user_id: String,
    pub user_name: Option<String>,
    pub text: String,
    pub timestamp: String,
    pub thread_ts: Option<String>,
    pub is_dm: bool,
}

/// A batch of messages retrieved from Slack.
#[derive(Debug, Clone)]
pub struct SlackPollResult {
    pub messages: Vec<SlackMessage>,
    pub channel_id: String,
    pub has_more: bool,
    pub latest_ts: Option<String>,
}

/// Basic channel info from the Slack API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackChannelInfo {
    pub id: String,
    pub name: String,
    pub is_private: bool,
}

// --- Internal API response types ---

#[derive(Debug, Deserialize)]
struct SlackApiResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    messages: Vec<SlackApiMessage>,
    #[serde(default)]
    has_more: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SlackApiMessage {
    #[serde(rename = "type")]
    _msg_type: Option<String>,
    user: Option<String>,
    text: Option<String>,
    ts: Option<String>,
    thread_ts: Option<String>,
    #[serde(default)]
    subtype: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SlackPostMessageResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SlackChannelsResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    channels: Vec<SlackApiChannel>,
}

#[derive(Debug, Deserialize)]
struct SlackApiChannel {
    id: Option<String>,
    name: Option<String>,
    is_private: Option<bool>,
}

// --- Scanner ---

/// The Slack scanner client.
pub struct SlackScanner {
    config: SlackConfig,
    /// Tracks the last seen timestamp per channel to only fetch new messages.
    channel_cursors: HashMap<String, String>,
}

impl SlackScanner {
    pub fn new(config: SlackConfig) -> Self {
        Self {
            config,
            channel_cursors: HashMap::new(),
        }
    }

    /// Create a scanner from environment variables.
    pub fn from_env() -> ChronicleResult<Self> {
        Ok(Self::new(SlackConfig::from_env()?))
    }

    /// Poll a single channel for new messages since the last cursor.
    pub fn poll_channel(&mut self, channel_id: &str) -> ChronicleResult<SlackPollResult> {
        let mut url = format!(
            "{}/conversations.history?channel={}&limit=100",
            self.config.base_url, channel_id
        );

        if let Some(cursor) = self.channel_cursors.get(channel_id) {
            url.push_str(&format!("&oldest={}", cursor));
        }

        let response: SlackApiResponse = self.get_json(&url)?;

        if !response.ok {
            let err = response.error.unwrap_or_else(|| "unknown error".into());
            return Err(ChronicleError::Process(format!(
                "Slack API error (conversations.history): {err}"
            )));
        }

        let mut messages: Vec<SlackMessage> = response
            .messages
            .iter()
            .filter(|m| m.subtype.is_none())
            .filter_map(|m| {
                let ts = m.ts.as_deref()?;
                Some(SlackMessage {
                    channel_id: channel_id.to_string(),
                    channel_name: None,
                    user_id: m.user.clone().unwrap_or_default(),
                    user_name: None,
                    text: m.text.clone().unwrap_or_default(),
                    timestamp: ts.to_string(),
                    thread_ts: m.thread_ts.clone(),
                    is_dm: false,
                })
            })
            .collect();

        // Slack returns newest first; reverse so oldest is first.
        messages.reverse();

        let latest_ts = messages.last().map(|m| m.timestamp.clone());

        if let Some(ref ts) = latest_ts {
            self.channel_cursors
                .insert(channel_id.to_string(), ts.clone());
        }

        Ok(SlackPollResult {
            messages,
            channel_id: channel_id.to_string(),
            has_more: response.has_more.unwrap_or(false),
            latest_ts,
        })
    }

    /// Poll all configured channels and aggregate messages.
    pub fn poll_all(&mut self) -> ChronicleResult<Vec<SlackMessage>> {
        let channel_ids = self.config.channel_ids.clone();
        let mut all_messages = Vec::new();

        for channel_id in &channel_ids {
            let result = self.poll_channel(channel_id)?;
            all_messages.extend(result.messages);
        }

        Ok(all_messages)
    }

    /// Send a message to a Slack channel.
    pub fn send_message(&self, channel_id: &str, text: &str) -> ChronicleResult<()> {
        let url = format!("{}/chat.postMessage", self.config.base_url);
        let body = serde_json::json!({
            "channel": channel_id,
            "text": text,
        });

        let json_bytes = body.to_string();
        let mut resp = ureq::post(&url)
            .header(
                "Authorization",
                &format!("Bearer {}", self.config.bot_token),
            )
            .header("Content-Type", "application/json; charset=utf-8")
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send(json_bytes.as_bytes())
            .map_err(|e| ChronicleError::Process(format!("Slack HTTP error: {e}")))?;

        let resp_body = resp
            .body_mut()
            .read_to_string()
            .map_err(|e| ChronicleError::Process(format!("Slack response read error: {e}")))?;
        let parsed: SlackPostMessageResponse = serde_json::from_str(&resp_body)
            .map_err(|e| ChronicleError::Process(format!("Slack response parse error: {e}")))?;

        if !parsed.ok {
            let err = parsed.error.unwrap_or_else(|| "unknown error".into());
            return Err(ChronicleError::Process(format!(
                "Slack API error (chat.postMessage): {err}"
            )));
        }

        Ok(())
    }

    /// List channels visible to the bot.
    pub fn list_channels(&self) -> ChronicleResult<Vec<SlackChannelInfo>> {
        let url = format!(
            "{}/conversations.list?types=public_channel,private_channel",
            self.config.base_url
        );

        let mut resp = ureq::get(&url)
            .header(
                "Authorization",
                &format!("Bearer {}", self.config.bot_token),
            )
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .call()
            .map_err(|e| ChronicleError::Process(format!("Slack HTTP error: {e}")))?;

        let resp_body = resp
            .body_mut()
            .read_to_string()
            .map_err(|e| ChronicleError::Process(format!("Slack response read error: {e}")))?;
        let parsed: SlackChannelsResponse = serde_json::from_str(&resp_body)
            .map_err(|e| ChronicleError::Process(format!("Slack response parse error: {e}")))?;

        if !parsed.ok {
            let err = parsed.error.unwrap_or_else(|| "unknown error".into());
            return Err(ChronicleError::Process(format!(
                "Slack API error (conversations.list): {err}"
            )));
        }

        let channels = parsed
            .channels
            .into_iter()
            .filter_map(|c| {
                Some(SlackChannelInfo {
                    id: c.id?,
                    name: c.name.unwrap_or_default(),
                    is_private: c.is_private.unwrap_or(false),
                })
            })
            .collect();

        Ok(channels)
    }

    // --- Private helpers ---

    fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> ChronicleResult<T> {
        let mut resp = ureq::get(url)
            .header(
                "Authorization",
                &format!("Bearer {}", self.config.bot_token),
            )
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .call()
            .map_err(|e| ChronicleError::Process(format!("Slack HTTP error: {e}")))?;

        let body = resp
            .body_mut()
            .read_to_string()
            .map_err(|e| ChronicleError::Process(format!("Slack response read error: {e}")))?;
        serde_json::from_str(&body)
            .map_err(|e| ChronicleError::Process(format!("Slack response parse error: {e}")))
    }
}

/// Parse a Slack timestamp ("1234567890.123456") to epoch seconds.
pub fn slack_ts_to_seconds(ts: &str) -> Option<u64> {
    let dot_pos = ts.find('.')?;
    ts[..dot_pos].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slack_ts_to_seconds_valid() {
        assert_eq!(slack_ts_to_seconds("1234567890.123456"), Some(1234567890));
        assert_eq!(slack_ts_to_seconds("1716307200.000100"), Some(1716307200));
        assert_eq!(slack_ts_to_seconds("0.000000"), Some(0));
    }

    #[test]
    fn test_slack_ts_to_seconds_invalid() {
        assert_eq!(slack_ts_to_seconds("no_dot"), None);
        assert_eq!(slack_ts_to_seconds("abc.123"), None);
        assert_eq!(slack_ts_to_seconds(""), None);
    }

    #[test]
    fn test_config_from_env_missing_token() {
        // Ensure the var is NOT set for this test.
        unsafe { env::remove_var("SLACK_BOT_TOKEN") };
        let result = SlackConfig::from_env();
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("SLACK_BOT_TOKEN"));
    }

    #[test]
    fn test_slack_message_serialization_roundtrip() {
        let msg = SlackMessage {
            channel_id: "C123".into(),
            channel_name: Some("general".into()),
            user_id: "U456".into(),
            user_name: Some("alice".into()),
            text: "hello world".into(),
            timestamp: "1716307200.000100".into(),
            thread_ts: None,
            is_dm: false,
        };

        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: SlackMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.channel_id, "C123");
        assert_eq!(deserialized.user_id, "U456");
        assert_eq!(deserialized.text, "hello world");
        assert_eq!(deserialized.timestamp, "1716307200.000100");
        assert!(!deserialized.is_dm);
    }
}
