//! Binary smoke validation for Cradle Chronicle.
//!
//! Input: the compiled `cradle-chronicle` binary.
//! Output: real artifacts and memory files in a temporary storage root.
//! Position: end-to-end test for the first shippable Chronicle path.

use std::fs;
use std::process::Command;

#[test]
fn binary_smoke_writes_artifacts_and_memory() {
    let binary = env!("CARGO_BIN_EXE_cradle-chronicle");
    let root = std::env::temp_dir().join(format!(
        "cradle-chronicle-binary-smoke-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);

    let output = Command::new(binary)
        .args([
            "--smoke",
            "--storage-root",
            root.to_str().expect("temp path should be utf8"),
            "--capture-limit",
            "2",
        ])
        .output()
        .expect("binary should run");

    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("cradle chronicle smoke completed"));

    let display_root = root.join("1");
    assert!(display_root.exists());
    assert!(root.join("memories").exists());

    let segment = fs::read_dir(&display_root)
        .expect("display dir should read")
        .next()
        .expect("segment should exist")
        .expect("segment entry should read")
        .path();
    assert!(segment.join("frame-00001.jpg").exists());
    assert!(segment.join("capture-00001.json").exists());
    assert!(segment.join("ocr-00001.json").exists());
    assert!(segment.join("ocr.json").exists());
    assert!(segment.join("capture.json").exists());
    assert!(segment.join("snapshot.json").exists());

    let memory_count = fs::read_dir(root.join("memories"))
        .expect("memories should read")
        .count();
    assert_eq!(memory_count, 1);

    let _ = fs::remove_dir_all(&root);
}
