//! Transcript inbox for externally produced audio transcript evidence.

use std::fs;
use std::path::Path;

use crate::cradle_client::{ChronicleAudioTranscriptReport, CradleClient};
use crate::error::{ChronicleError, ChronicleResult};

const DEFAULT_TRANSCRIPT_INBOX_BATCH_LIMIT: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptInboxReport {
    pub scanned: usize,
    pub reported: usize,
    pub failed: usize,
}

pub fn process_transcript_inbox(
    inbox_root: impl AsRef<Path>,
    client: &CradleClient,
) -> ChronicleResult<TranscriptInboxReport> {
    process_transcript_inbox_with_limit(inbox_root, client, usize::MAX)
}

pub fn process_transcript_inbox_tick(
    inbox_root: impl AsRef<Path>,
    client: &CradleClient,
) -> ChronicleResult<TranscriptInboxReport> {
    process_transcript_inbox_with_limit(inbox_root, client, DEFAULT_TRANSCRIPT_INBOX_BATCH_LIMIT)
}

pub fn process_transcript_inbox_with_limit(
    inbox_root: impl AsRef<Path>,
    client: &CradleClient,
    max_manifests: usize,
) -> ChronicleResult<TranscriptInboxReport> {
    let transcript_root = inbox_root.as_ref().join("audio-transcripts");
    if !transcript_root.exists() || max_manifests == 0 {
        return Ok(TranscriptInboxReport {
            scanned: 0,
            reported: 0,
            failed: 0,
        });
    }

    let mut manifests = Vec::new();
    for entry in fs::read_dir(&transcript_root)
        .map_err(|source| ChronicleError::io_at(&transcript_root, source))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("json") {
            manifests.push(path);
        }
    }
    manifests.sort();

    let mut reported = 0;
    let mut failed = 0;
    let selected_manifests: Vec<_> = manifests.iter().take(max_manifests).collect();
    for manifest in &selected_manifests {
        match report_transcript_manifest(manifest, client) {
            Ok(()) => {
                mark_processed(manifest)?;
                reported += 1;
            }
            Err(error) => {
                failed += 1;
                eprintln!(
                    "cradle chronicle transcript report failed for {}: {error}",
                    manifest.display()
                );
            }
        }
    }

    Ok(TranscriptInboxReport {
        scanned: selected_manifests.len(),
        reported,
        failed,
    })
}

fn report_transcript_manifest(manifest_path: &Path, client: &CradleClient) -> ChronicleResult<()> {
    let body = fs::read_to_string(manifest_path)
        .map_err(|source| ChronicleError::io_at(manifest_path, source))?;
    const MAX_TRANSCRIPT_BYTES: usize = 10 * 1024 * 1024;
    if body.len() > MAX_TRANSCRIPT_BYTES {
        return Err(ChronicleError::Process(format!(
            "transcript manifest exceeds {} MB limit: {}",
            MAX_TRANSCRIPT_BYTES / (1024 * 1024),
            manifest_path.display()
        )));
    }
    let report: ChronicleAudioTranscriptReport = serde_json::from_str(&body).map_err(|source| {
        ChronicleError::InvalidArgument(format!(
            "invalid transcript manifest {}: {source}",
            manifest_path.display()
        ))
    })?;
    report.validate()?;
    client.record_audio_transcript(&report)
}

fn mark_processed(manifest_path: &Path) -> ChronicleResult<()> {
    let parent = manifest_path.parent().ok_or_else(|| {
        ChronicleError::InvalidArgument(format!(
            "transcript manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;
    let processed_dir = parent.join("processed");
    fs::create_dir_all(&processed_dir)
        .map_err(|source| ChronicleError::io_at(&processed_dir, source))?;
    let processed_path = processed_dir.join(manifest_path.file_name().ok_or_else(|| {
        ChronicleError::InvalidArgument("transcript manifest has no file name".to_string())
    })?);
    fs::rename(manifest_path, &processed_path)
        .map_err(|source| ChronicleError::io_at(&processed_path, source))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    use super::{process_transcript_inbox, process_transcript_inbox_with_limit};
    use crate::cradle_client::CradleClient;

    #[test]
    fn reports_transcript_manifest_and_marks_processed() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        fs::write(
            transcript_root.join("meeting.json"),
            serde_json::json!({
                "sourceId": "meeting-source-1",
                "title": "Chronicle transcript",
                "source": "imported",
                "status": "completed",
                "startedAt": "2026-05-21T10:30:00Z",
                "endedAt": "2026-05-21T10:40:00Z",
                "language": "en",
                "segments": [{
                    "startMs": 0,
                    "endMs": 2500,
                    "speakerLabel": "Ada",
                    "text": "Inbox transcript target",
                    "confidence": 0.94,
                    "language": "en",
                    "metadata": {}
                }],
                "metadata": {
                    "runtime": "fixture"
                }
            })
            .to_string(),
        )
        .expect("manifest should write");

        let server = TestServer::start(200);
        let client = CradleClient::new(server.url());
        let report = process_transcript_inbox(&root, &client).expect("inbox should process");

        assert_eq!(report.scanned, 1);
        assert_eq!(report.reported, 1);
        assert_eq!(report.failed, 0);
        assert!(transcript_root.join("processed/meeting.json").exists());
        assert!(
            server
                .received_body()
                .contains("\"sourceId\":\"meeting-source-1\"")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn applies_server_defaults_before_reporting_manifest() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-defaults-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        fs::write(
            transcript_root.join("meeting.json"),
            serde_json::json!({
                "sourceId": "meeting-source-1",
                "startedAt": "2026-05-21T10:30:00Z",
                "segments": [{
                    "startMs": 0,
                    "text": "Inbox transcript target"
                }]
            })
            .to_string(),
        )
        .expect("manifest should write");

        let server = TestServer::start(200);
        let client = CradleClient::new(server.url());
        let report = process_transcript_inbox(&root, &client).expect("inbox should process");
        let body = server.received_body();

        assert_eq!(report.scanned, 1);
        assert_eq!(report.reported, 1);
        assert_eq!(report.failed, 0);
        assert!(body.contains("\"source\":\"imported\""));
        assert!(body.contains("\"status\":\"imported\""));
        assert!(body.contains("\"metadata\":{}"));
        assert!(transcript_root.join("processed/meeting.json").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_manifest_when_transport_fails() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-fail-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        fs::write(
            transcript_root.join("meeting.json"),
            serde_json::json!({
                "sourceId": "meeting-source-1",
                "source": "imported",
                "status": "completed",
                "startedAt": "2026-05-21T10:30:00Z",
                "segments": [{
                    "startMs": 0,
                    "text": "Inbox transcript target",
                    "metadata": {}
                }],
                "metadata": {}
            })
            .to_string(),
        )
        .expect("manifest should write");

        let client = CradleClient::new("http://127.0.0.1:1");
        let report = process_transcript_inbox(&root, &client).expect("inbox should process");

        assert_eq!(report.scanned, 1);
        assert_eq!(report.reported, 0);
        assert_eq!(report.failed, 1);
        assert!(transcript_root.join("meeting.json").exists());
        assert!(!transcript_root.join("processed/meeting.json").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_manifest_when_server_rejects_report() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-reject-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        fs::write(
            transcript_root.join("meeting.json"),
            serde_json::json!({
                "sourceId": "meeting-source-1",
                "source": "imported",
                "status": "completed",
                "startedAt": "2026-05-21T10:30:00Z",
                "segments": [{
                    "startMs": 0,
                    "text": "Inbox transcript target",
                    "metadata": {}
                }],
                "metadata": {}
            })
            .to_string(),
        )
        .expect("manifest should write");

        let server = TestServer::start(400);
        let client = CradleClient::new(server.url());
        let report = process_transcript_inbox(&root, &client).expect("inbox should process");

        assert_eq!(report.scanned, 1);
        assert_eq!(report.reported, 0);
        assert_eq!(report.failed, 1);
        assert!(transcript_root.join("meeting.json").exists());
        assert!(!transcript_root.join("processed/meeting.json").exists());
        assert!(
            server
                .received_body()
                .contains("\"sourceId\":\"meeting-source-1\"")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_manifest_when_server_errors_report() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-error-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        fs::write(
            transcript_root.join("meeting.json"),
            serde_json::json!({
                "sourceId": "meeting-source-1",
                "source": "imported",
                "status": "completed",
                "startedAt": "2026-05-21T10:30:00Z",
                "segments": [{
                    "startMs": 0,
                    "text": "Inbox transcript target",
                    "metadata": {}
                }],
                "metadata": {}
            })
            .to_string(),
        )
        .expect("manifest should write");

        let server = TestServer::start(500);
        let client = CradleClient::new(server.url());
        let report = process_transcript_inbox(&root, &client).expect("inbox should process");

        assert_eq!(report.scanned, 1);
        assert_eq!(report.reported, 0);
        assert_eq!(report.failed, 1);
        assert!(transcript_root.join("meeting.json").exists());
        assert!(!transcript_root.join("processed/meeting.json").exists());
        assert!(
            server
                .received_body()
                .contains("\"sourceId\":\"meeting-source-1\"")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn limits_failed_manifest_work_per_tick() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-transcript-inbox-limit-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let transcript_root = root.join("audio-transcripts");
        fs::create_dir_all(&transcript_root).expect("transcript root should create");
        for index in 0..5 {
            fs::write(
                transcript_root.join(format!("meeting-{index}.json")),
                serde_json::json!({
                    "sourceId": format!("meeting-source-{index}"),
                    "source": "imported",
                    "status": "completed",
                    "startedAt": "2026-05-21T10:30:00Z",
                    "segments": [{
                        "startMs": 0,
                        "text": "Inbox transcript target",
                        "metadata": {}
                    }],
                    "metadata": {}
                })
                .to_string(),
            )
            .expect("manifest should write");
        }

        let client = CradleClient::new("http://127.0.0.1:1");
        let report =
            process_transcript_inbox_with_limit(&root, &client, 2).expect("inbox should process");

        assert_eq!(report.scanned, 2);
        assert_eq!(report.reported, 0);
        assert_eq!(report.failed, 2);
        assert_eq!(
            fs::read_dir(&transcript_root)
                .expect("transcript root should read")
                .filter_map(Result::ok)
                .filter(
                    |entry| entry.path().extension().and_then(|value| value.to_str())
                        == Some("json")
                )
                .count(),
            5
        );

        let _ = fs::remove_dir_all(&root);
    }

    struct TestServer {
        base_url: String,
        handle: thread::JoinHandle<String>,
    }

    impl TestServer {
        fn start(status_code: u16) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("server should bind");
            let address = listener.local_addr().expect("server address should exist");
            let handle = thread::spawn(move || {
                let (stream, _) = listener.accept().expect("request should arrive");
                handle_connection(stream, status_code)
            });
            Self {
                base_url: format!("http://{}", address),
                handle,
            }
        }

        fn url(&self) -> String {
            self.base_url.clone()
        }

        fn received_body(self) -> String {
            self.handle.join().expect("server should join")
        }
    }

    fn handle_connection(mut stream: TcpStream, status_code: u16) -> String {
        use std::io::{Read, Write};

        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if request_body_complete(&buffer) {
                break;
            }
        }
        let status_text = if status_code == 200 { "OK" } else { "Rejected" };
        let response =
            format!("HTTP/1.1 {status_code} {status_text}\r\nContent-Length: 2\r\n\r\n{{}}");
        stream
            .write_all(response.as_bytes())
            .expect("response should write");
        let request = String::from_utf8_lossy(&buffer).to_string();
        request
            .split("\r\n\r\n")
            .nth(1)
            .unwrap_or_default()
            .to_string()
    }

    fn request_body_complete(buffer: &[u8]) -> bool {
        let request = String::from_utf8_lossy(buffer);
        let Some((head, body)) = request.split_once("\r\n\r\n") else {
            return false;
        };
        let content_length = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("content-length") {
                    Some(value.trim())
                } else {
                    None
                }
            })
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        body.len() >= content_length
    }
}
