//! Child process execution boundary for future LLM-backed summaries.
//!
//! Input: executable, arguments, stdin prompt, and timeout.
//! Output: captured stdout or a process error.
//! Position: isolates external model runners from Chronicle core logic.

use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone)]
pub struct ChildProcessRequest {
    pub executable: String,
    pub args: Vec<String>,
    pub stdin: String,
    pub timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

pub fn run_child_process(request: ChildProcessRequest) -> ChronicleResult<ChildProcessOutput> {
    let mut child = Command::new(&request.executable)
        .args(&request.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|source| {
            ChronicleError::Process(format!(
                "failed to spawn {}: {}",
                request.executable, source
            ))
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ChronicleError::Process("child stdin was not piped".to_string()))?;
    stdin.write_all(request.stdin.as_bytes())?;
    drop(stdin);

    let started_at = Instant::now();
    loop {
        if let Some(_status) = child.try_wait()? {
            let output = child.wait_with_output()?;
            if !output.status.success() {
                return Err(ChronicleError::Process(format!(
                    "child exited with status {}",
                    output.status
                )));
            }
            return Ok(ChildProcessOutput {
                stdout: String::from_utf8(output.stdout)?,
                stderr: String::from_utf8(output.stderr)?,
            });
        }

        if started_at.elapsed() >= request.timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ChronicleError::Process(format!(
                "child timed out after {:?}",
                request.timeout
            )));
        }

        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{ChildProcessRequest, run_child_process};

    #[test]
    fn runs_local_child_process_with_stdin() {
        let output = run_child_process(ChildProcessRequest {
            executable: "/bin/cat".to_string(),
            args: Vec::new(),
            stdin: "chronicle prompt".to_string(),
            timeout: Duration::from_secs(2),
        })
        .expect("cat should echo stdin");

        assert_eq!(output.stdout, "chronicle prompt");
    }
}
