//! Child process execution boundary for future LLM-backed summaries.
//!
//! Input: executable, arguments, stdin prompt, and timeout.
//! Output: captured stdout or a process error.
//! Position: isolates external model runners from Chronicle core logic.

use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

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

    // Avoid pipe deadlock: spawn a thread for the timeout kill,
    // then call wait_with_output() which reads stdout/stderr concurrently.
    let timeout = request.timeout;
    let child_id = child.id();
    let killer = thread::spawn(move || {
        thread::sleep(timeout);
        // Best-effort kill after timeout
        unsafe { libc::kill(child_id as i32, libc::SIGKILL); }
    });

    let output = child.wait_with_output().map_err(|e| {
        ChronicleError::Process(format!("failed to wait for child: {e}"))
    })?;

    // If the killer thread hasn't fired yet, it will exit harmlessly
    // when its sleep completes (kill on a dead PID is a no-op).
    drop(killer);

    if !output.status.success() {
        // Check if killed by our timeout thread
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            if output.status.signal() == Some(9) {
                return Err(ChronicleError::Process(format!(
                    "child timed out after {:?}",
                    timeout
                )));
            }
        }
        return Err(ChronicleError::Process(format!(
            "child exited with status {}",
            output.status
        )));
    }

    Ok(ChildProcessOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
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
