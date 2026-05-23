//! Provider-neutral external capability boundaries for Chronicle core.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::codex_exec::{ChildProcessRequest, run_child_process};
use crate::error::{ChronicleError, ChronicleResult};
use crate::memory_pipeline::naming::MemoryWindow;

/// Request for a component that can turn observed evidence into markdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryCapabilityRequest {
    pub prompt: String,
    pub window: MemoryWindow,
    pub evidence_paths: Vec<PathBuf>,
    pub child_summaries: Vec<String>,
}

/// Output from a summary capability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryCapabilityOutput {
    pub markdown: String,
    pub provider: SummaryProvider,
}

/// The implementation family that produced a summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SummaryProvider {
    Local,
    ChildProcess,
    External(String),
}

impl SummaryProvider {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Local => "local",
            Self::ChildProcess => "child-process",
            Self::External(value) => value.as_str(),
        }
    }
}

/// A narrow interface for summary generation.
pub trait SummaryCapability {
    fn summarize(
        &self,
        request: SummaryCapabilityRequest,
    ) -> ChronicleResult<SummaryCapabilityOutput>;
}

/// Deterministic local summary capability used when no external model is configured.
#[derive(Debug, Default, Clone, Copy)]
pub struct LocalSummaryCapability;

impl SummaryCapability for LocalSummaryCapability {
    fn summarize(
        &self,
        request: SummaryCapabilityRequest,
    ) -> ChronicleResult<SummaryCapabilityOutput> {
        let mut markdown = String::new();
        markdown.push_str("## Memory summary\n\n");
        markdown.push_str("Chronicle captured local evidence and produced a deterministic local summary. [chronicle memory]\n\n");
        markdown.push_str("## Recording summary\n\n");
        if request.evidence_paths.is_empty() {
            markdown.push_str("- No evidence paths were attached. [chronicle memory]\n");
        } else {
            for path in request.evidence_paths {
                markdown.push_str(&format!(
                    "- Evidence: {} [chronicle memory]\n",
                    path.display()
                ));
            }
        }
        if !request.child_summaries.is_empty() {
            markdown.push_str("\n## Child summaries\n\n");
            for (index, child) in request.child_summaries.iter().enumerate() {
                markdown.push_str(&format!(
                    "- Child summary {}: {}\n",
                    index + 1,
                    child.trim()
                ));
            }
        }
        markdown.push_str("\n## Local citations\n\n");
        markdown.push_str("- local-summary-capability\n");

        Ok(SummaryCapabilityOutput {
            markdown,
            provider: SummaryProvider::Local,
        })
    }
}

/// Summary capability backed by a child process.
#[derive(Debug, Clone)]
pub struct ChildProcessSummaryCapability {
    executable: String,
    args: Vec<String>,
    timeout: Duration,
}

impl ChildProcessSummaryCapability {
    pub fn new(executable: impl Into<String>, args: Vec<String>, timeout: Duration) -> Self {
        Self {
            executable: executable.into(),
            args,
            timeout,
        }
    }

    pub fn from_env() -> Option<Self> {
        let command = std::env::var("CRADLE_CHRONICLE_LLM_COMMAND").ok()?;
        let mut parts = command.split_whitespace();
        let executable = parts.next()?.to_string();
        let args = parts.map(ToString::to_string).collect();
        let timeout_ms = std::env::var("CRADLE_CHRONICLE_LLM_TIMEOUT_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(120_000);
        Some(Self::new(
            executable,
            args,
            Duration::from_millis(timeout_ms),
        ))
    }
}

impl SummaryCapability for ChildProcessSummaryCapability {
    fn summarize(
        &self,
        request: SummaryCapabilityRequest,
    ) -> ChronicleResult<SummaryCapabilityOutput> {
        let output = run_child_process(ChildProcessRequest {
            executable: self.executable.clone(),
            args: self.args.clone(),
            stdin: request.prompt,
            timeout: self.timeout,
        })?;
        let markdown = output.stdout.trim().to_string();
        if markdown.is_empty() {
            return Err(ChronicleError::Process(
                "child summary capability returned empty stdout".to_string(),
            ));
        }
        Ok(SummaryCapabilityOutput {
            markdown,
            provider: SummaryProvider::ChildProcess,
        })
    }
}

/// Event published to optional external integrations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleIntegrationEvent {
    pub kind: String,
    pub payload: serde_json::Value,
}

/// Optional projection sink for external consumers.
pub trait IntegrationSink {
    fn publish(&self, event: ChronicleIntegrationEvent) -> ChronicleResult<()>;
}

/// Default sink that intentionally does nothing.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopIntegrationSink;

impl IntegrationSink for NoopIntegrationSink {
    fn publish(&self, _event: ChronicleIntegrationEvent) -> ChronicleResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::capabilities::{
        ChildProcessSummaryCapability, LocalSummaryCapability, SummaryCapability,
        SummaryCapabilityRequest, SummaryProvider,
    };
    use crate::memory_pipeline::naming::MemoryWindow;

    #[test]
    fn local_summary_capability_produces_markdown() {
        let output = LocalSummaryCapability
            .summarize(SummaryCapabilityRequest {
                prompt: "ignored by local summary".to_string(),
                window: MemoryWindow::TenMinutes,
                evidence_paths: vec!["/tmp/frame.jpg".into()],
                child_summaries: Vec::new(),
            })
            .expect("local summary should succeed");

        assert_eq!(output.provider, SummaryProvider::Local);
        assert!(output.markdown.contains("## Memory summary"));
        assert!(output.markdown.contains("/tmp/frame.jpg"));
    }

    #[test]
    fn child_process_summary_capability_reads_stdout() {
        let output =
            ChildProcessSummaryCapability::new("/bin/cat", Vec::new(), Duration::from_secs(2))
                .summarize(SummaryCapabilityRequest {
                    prompt: "## Memory summary\n\nchild output\n".to_string(),
                    window: MemoryWindow::TenMinutes,
                    evidence_paths: Vec::new(),
                    child_summaries: Vec::new(),
                })
                .expect("child process summary should succeed");

        assert_eq!(output.provider, SummaryProvider::ChildProcess);
        assert!(output.markdown.contains("child output"));
    }
}
