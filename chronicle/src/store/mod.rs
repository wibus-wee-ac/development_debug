//! Local Chronicle store for event and memory indexes.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone)]
pub struct ChronicleStore {
    root: PathBuf,
}

impl ChronicleStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn events_path(&self) -> PathBuf {
        self.root.join("events.ndjson")
    }

    pub fn memory_manifest_path(&self) -> PathBuf {
        self.root.join("memory-manifest.json")
    }

    pub fn append_event(&self, event: &ChronicleStoreEvent) -> ChronicleResult<()> {
        fs::create_dir_all(&self.root).map_err(|error| ChronicleError::io_at(&self.root, error))?;
        let path = self.events_path();
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        serde_json::to_writer(&mut file, event)
            .map_err(|error| ChronicleError::Process(format!("serialize store event: {error}")))?;
        file.write_all(b"\n")
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        Ok(())
    }

    pub fn record_memory(&self, memory: &ChronicleMemoryManifest) -> ChronicleResult<()> {
        fs::create_dir_all(&self.root).map_err(|error| ChronicleError::io_at(&self.root, error))?;
        let mut memories = self.list_memories()?;
        if let Some(existing) = memories.iter_mut().find(|item| item.id == memory.id) {
            *existing = memory.clone();
        } else {
            memories.push(memory.clone());
        }
        memories.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        self.write_memory_manifest(&memories)
    }

    pub fn list_memories(&self) -> ChronicleResult<Vec<ChronicleMemoryManifest>> {
        let path = self.memory_manifest_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(&path).map_err(|error| ChronicleError::io_at(&path, error))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| ChronicleError::Process(format!("parse memory manifest: {error}")))
    }

    fn write_memory_manifest(&self, memories: &[ChronicleMemoryManifest]) -> ChronicleResult<()> {
        let path = self.memory_manifest_path();
        let temp_path = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(memories).map_err(|error| {
            ChronicleError::Process(format!("serialize memory manifest: {error}"))
        })?;
        fs::write(&temp_path, bytes).map_err(|error| ChronicleError::io_at(&temp_path, error))?;
        fs::rename(&temp_path, &path).map_err(|error| ChronicleError::io_at(&path, error))?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleStoreEvent {
    pub id: String,
    pub kind: String,
    pub created_at: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleMemoryManifest {
    pub id: String,
    pub window: String,
    pub created_at: String,
    pub memory_path: PathBuf,
    pub source_paths: Vec<PathBuf>,
    pub summary_kind: String,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::store::{ChronicleMemoryManifest, ChronicleStore, ChronicleStoreEvent};

    #[test]
    fn appends_events_and_records_memories() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-store-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let store = ChronicleStore::new(&root);

        store
            .append_event(&ChronicleStoreEvent {
                id: "event-1".to_string(),
                kind: "capture".to_string(),
                created_at: "2026-05-23T00-00-00Z".to_string(),
                payload: serde_json::json!({ "frames": 2 }),
            })
            .expect("event should append");

        store
            .record_memory(&ChronicleMemoryManifest {
                id: "memory-1".to_string(),
                window: "10min".to_string(),
                created_at: "2026-05-23T00-00-00Z".to_string(),
                memory_path: root.join("memories/memory.md"),
                source_paths: vec![root.join("frame.jpg")],
                summary_kind: "local".to_string(),
            })
            .expect("memory should record");

        let events = fs::read_to_string(store.events_path()).expect("events should read");
        assert_eq!(events.lines().count(), 1);
        assert!(events.contains("\"kind\":\"capture\""));

        let memories = store.list_memories().expect("memories should read");
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].id, "memory-1");

        let _ = fs::remove_dir_all(&root);
    }
}
