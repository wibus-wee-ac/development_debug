//! Chronicle core composition root.

use crate::capabilities::{
    ChronicleIntegrationEvent, IntegrationSink, SummaryCapability, SummaryCapabilityOutput,
    SummaryCapabilityRequest,
};
use crate::error::ChronicleResult;
use crate::store::{ChronicleMemoryManifest, ChronicleStore, ChronicleStoreEvent};

#[derive(Debug)]
pub struct ChronicleCore<C, S> {
    store: ChronicleStore,
    summary: C,
    sink: S,
}

impl<C, S> ChronicleCore<C, S>
where
    C: SummaryCapability,
    S: IntegrationSink,
{
    pub fn new(store: ChronicleStore, summary: C, sink: S) -> Self {
        Self {
            store,
            summary,
            sink,
        }
    }

    pub fn store(&self) -> &ChronicleStore {
        &self.store
    }

    pub fn append_event(&self, event: ChronicleStoreEvent) -> ChronicleResult<()> {
        self.store.append_event(&event)?;
        self.sink.publish(ChronicleIntegrationEvent {
            kind: event.kind,
            payload: event.payload,
        })?;
        Ok(())
    }

    pub fn record_memory(&self, memory: ChronicleMemoryManifest) -> ChronicleResult<()> {
        self.store.record_memory(&memory)?;
        self.sink.publish(ChronicleIntegrationEvent {
            kind: "memory-recorded".to_string(),
            payload: serde_json::json!({
                "id": memory.id,
                "window": memory.window,
                "createdAt": memory.created_at,
                "memoryPath": memory.memory_path
            }),
        })?;
        Ok(())
    }

    pub fn summarize(
        &self,
        request: SummaryCapabilityRequest,
    ) -> ChronicleResult<SummaryCapabilityOutput> {
        self.summary.summarize(request)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::capabilities::{
        LocalSummaryCapability, NoopIntegrationSink, SummaryCapabilityRequest,
    };
    use crate::core::ChronicleCore;
    use crate::memory_pipeline::naming::MemoryWindow;
    use crate::store::{ChronicleMemoryManifest, ChronicleStore, ChronicleStoreEvent};

    #[test]
    fn core_records_events_memories_and_summarizes() {
        let root =
            std::env::temp_dir().join(format!("cradle-chronicle-core-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let core = ChronicleCore::new(
            ChronicleStore::new(&root),
            LocalSummaryCapability,
            NoopIntegrationSink,
        );

        core.append_event(ChronicleStoreEvent {
            id: "event-1".to_string(),
            kind: "capture".to_string(),
            created_at: "2026-05-23T00-00-00Z".to_string(),
            payload: serde_json::json!({ "persisted": 1 }),
        })
        .expect("event should record");
        core.record_memory(ChronicleMemoryManifest {
            id: "memory-1".to_string(),
            window: "10min".to_string(),
            created_at: "2026-05-23T00-00-00Z".to_string(),
            memory_path: root.join("memories/memory.md"),
            source_paths: vec![root.join("frame.jpg")],
            summary_kind: "local".to_string(),
        })
        .expect("memory should record");

        let output = core
            .summarize(SummaryCapabilityRequest {
                prompt: "summarize".to_string(),
                window: MemoryWindow::TenMinutes,
                evidence_paths: vec![root.join("frame.jpg")],
                child_summaries: Vec::new(),
            })
            .expect("summary should succeed");

        assert!(output.markdown.contains("## Memory summary"));
        assert_eq!(
            core.store()
                .list_memories()
                .expect("memories should read")
                .len(),
            1
        );

        let _ = fs::remove_dir_all(&root);
    }
}
