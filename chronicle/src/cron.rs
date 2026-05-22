//! Simple file-based cron scheduler for interval and daily tasks.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::time::Timestamp;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    /// Run at fixed intervals (e.g. every 600 seconds).
    Interval,
    /// Run once per day at a specific hour (0-23).
    Daily,
    /// Run only when manually triggered.
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Summarize,
    Crystallize,
    DreamArchive,
    DreamMerge,
    DreamPrune,
    HealthCheck,
    Cleanup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub schedule_kind: ScheduleKind,
    pub interval_seconds: u64,
    pub daily_hour: u8,
    pub task_kind: TaskKind,
    pub last_run_at: Option<u64>,
    pub last_run_status: Option<String>,
    pub next_run_at: Option<u64>,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CronTickResult {
    /// No jobs are due.
    Idle,
    /// A job is due and should be executed.
    Due(String),
}

pub struct CronScheduler {
    jobs: Vec<CronJob>,
    state_path: PathBuf,
}

impl CronScheduler {
    pub fn new(state_path: impl Into<PathBuf>) -> Self {
        Self {
            jobs: Vec::new(),
            state_path: state_path.into(),
        }
    }

    pub fn load_state(&mut self) -> ChronicleResult<()> {
        let path = &self.state_path;
        if !path.exists() {
            return Ok(());
        }
        let data =
            std::fs::read_to_string(path).map_err(|e| ChronicleError::io_at(path.clone(), e))?;
        self.jobs = serde_json::from_str(&data)
            .map_err(|e| ChronicleError::InvalidArgument(e.to_string()))?;
        Ok(())
    }

    pub fn save_state(&self) -> ChronicleResult<()> {
        let path = &self.state_path;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ChronicleError::io_at(parent.to_path_buf(), e))?;
        }
        let data = serde_json::to_string_pretty(&self.jobs)
            .map_err(|e| ChronicleError::InvalidArgument(e.to_string()))?;
        std::fs::write(path, data).map_err(|e| ChronicleError::io_at(path.clone(), e))?;
        Ok(())
    }

    pub fn add_job(&mut self, job: CronJob) {
        self.jobs.push(job);
    }

    pub fn remove_job(&mut self, id: &str) -> bool {
        let len_before = self.jobs.len();
        self.jobs.retain(|j| j.id != id);
        self.jobs.len() < len_before
    }

    pub fn get_job(&self, id: &str) -> Option<&CronJob> {
        self.jobs.iter().find(|j| j.id == id)
    }

    pub fn jobs(&self) -> &[CronJob] {
        &self.jobs
    }

    pub fn tick(&mut self, now: Timestamp) -> Vec<CronTickResult> {
        let now_secs = now.seconds_since_epoch();
        let mut results = Vec::new();

        for job in &self.jobs {
            if !job.enabled {
                continue;
            }
            let due = match job.schedule_kind {
                ScheduleKind::Interval => {
                    let last = job.last_run_at.unwrap_or(0);
                    now_secs >= last + job.interval_seconds
                }
                ScheduleKind::Daily => {
                    let target_secs = start_of_day(now_secs) + u64::from(job.daily_hour) * 3600;
                    let past_target = now_secs >= target_secs;
                    let already_ran_today = job
                        .last_run_at
                        .map(|last| start_of_day(last) == start_of_day(now_secs))
                        .unwrap_or(false);
                    past_target && !already_ran_today
                }
                ScheduleKind::Manual => false,
            };
            if due {
                results.push(CronTickResult::Due(job.id.clone()));
            }
        }

        if results.is_empty() {
            vec![CronTickResult::Idle]
        } else {
            results
        }
    }

    pub fn mark_completed(&mut self, id: &str, now: Timestamp, status: &str) {
        let now_secs = now.seconds_since_epoch();
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == id) {
            job.last_run_at = Some(now_secs);
            job.last_run_status = Some(status.to_string());
            job.next_run_at = compute_next_run(job, now_secs);
        }
    }

    pub fn run_now(&mut self, id: &str, now: Timestamp) -> Option<CronTickResult> {
        let exists = self.jobs.iter().any(|j| j.id == id);
        if exists {
            let now_secs = now.seconds_since_epoch();
            if let Some(job) = self.jobs.iter_mut().find(|j| j.id == id) {
                job.last_run_at = Some(now_secs);
                job.next_run_at = compute_next_run(job, now_secs);
            }
            Some(CronTickResult::Due(id.to_string()))
        } else {
            None
        }
    }
}

fn start_of_day(secs: u64) -> u64 {
    secs - (secs % 86_400)
}

fn compute_next_run(job: &CronJob, now_secs: u64) -> Option<u64> {
    match job.schedule_kind {
        ScheduleKind::Interval => Some(now_secs + job.interval_seconds),
        ScheduleKind::Daily => {
            let today_target = start_of_day(now_secs) + u64::from(job.daily_hour) * 3600;
            if now_secs < today_target {
                Some(today_target)
            } else {
                Some(today_target + 86_400)
            }
        }
        ScheduleKind::Manual => None,
    }
}

pub fn default_jobs(now: Timestamp) -> Vec<CronJob> {
    let created = now.seconds_since_epoch();
    vec![
        CronJob {
            id: "summarize".into(),
            name: "Summarize".into(),
            description: "Summarize recent activity".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Interval,
            interval_seconds: 600,
            daily_hour: 0,
            task_kind: TaskKind::Summarize,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(created + 600),
            created_at: created,
        },
        CronJob {
            id: "crystallize".into(),
            name: "Crystallize".into(),
            description: "Crystallize memory segments".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Interval,
            interval_seconds: 900,
            daily_hour: 0,
            task_kind: TaskKind::Crystallize,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(created + 900),
            created_at: created,
        },
        CronJob {
            id: "dream-archive".into(),
            name: "Dream Archive".into(),
            description: "Archive old dream entries".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Daily,
            interval_seconds: 0,
            daily_hour: 3,
            task_kind: TaskKind::DreamArchive,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(start_of_day(created) + 3 * 3600 + 86_400),
            created_at: created,
        },
        CronJob {
            id: "dream-merge".into(),
            name: "Dream Merge".into(),
            description: "Merge related dream entries".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Daily,
            interval_seconds: 0,
            daily_hour: 4,
            task_kind: TaskKind::DreamMerge,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(start_of_day(created) + 4 * 3600 + 86_400),
            created_at: created,
        },
        CronJob {
            id: "health-check".into(),
            name: "Health Check".into(),
            description: "Run system health check".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Interval,
            interval_seconds: 3600,
            daily_hour: 0,
            task_kind: TaskKind::HealthCheck,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(created + 3600),
            created_at: created,
        },
        CronJob {
            id: "cleanup".into(),
            name: "Cleanup".into(),
            description: "Remove stale temporary files and processed inbox manifests".into(),
            enabled: true,
            schedule_kind: ScheduleKind::Daily,
            interval_seconds: 0,
            daily_hour: 5,
            task_kind: TaskKind::Cleanup,
            last_run_at: None,
            last_run_status: None,
            next_run_at: Some(start_of_day(created) + 5 * 3600 + 86_400),
            created_at: created,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_scheduler() -> CronScheduler {
        CronScheduler::new("/tmp/test-cron-state.json")
    }

    fn interval_job(id: &str, interval: u64) -> CronJob {
        CronJob {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            enabled: true,
            schedule_kind: ScheduleKind::Interval,
            interval_seconds: interval,
            daily_hour: 0,
            task_kind: TaskKind::Summarize,
            last_run_at: None,
            last_run_status: None,
            next_run_at: None,
            created_at: 1000,
        }
    }

    #[test]
    fn tick_returns_due_interval_jobs() {
        let mut sched = make_scheduler();
        let mut job = interval_job("j1", 60);
        job.last_run_at = Some(1000);
        sched.add_job(job);

        // Not yet due at 1059
        let results = sched.tick(Timestamp::from_seconds(1059));
        assert_eq!(results, vec![CronTickResult::Idle]);

        // Due at 1060
        let results = sched.tick(Timestamp::from_seconds(1060));
        assert_eq!(results, vec![CronTickResult::Due("j1".into())]);
    }

    #[test]
    fn tick_skips_disabled_jobs() {
        let mut sched = make_scheduler();
        let mut job = interval_job("disabled", 60);
        job.enabled = false;
        job.last_run_at = Some(1000);
        sched.add_job(job);

        let results = sched.tick(Timestamp::from_seconds(2000));
        assert_eq!(results, vec![CronTickResult::Idle]);
    }

    #[test]
    fn mark_completed_updates_timestamps() {
        let mut sched = make_scheduler();
        let job = interval_job("j1", 300);
        sched.add_job(job);

        let now = Timestamp::from_seconds(5000);
        sched.mark_completed("j1", now, "ok");

        let job = sched.get_job("j1").unwrap();
        assert_eq!(job.last_run_at, Some(5000));
        assert_eq!(job.last_run_status.as_deref(), Some("ok"));
        assert_eq!(job.next_run_at, Some(5300));
    }

    #[test]
    fn run_now_triggers_manual_job() {
        let mut sched = make_scheduler();
        let job = CronJob {
            id: "manual-task".into(),
            name: "Manual".into(),
            description: String::new(),
            enabled: true,
            schedule_kind: ScheduleKind::Manual,
            interval_seconds: 0,
            daily_hour: 0,
            task_kind: TaskKind::Cleanup,
            last_run_at: None,
            last_run_status: None,
            next_run_at: None,
            created_at: 1000,
        };
        sched.add_job(job);

        let result = sched.run_now("manual-task", Timestamp::from_seconds(2000));
        assert_eq!(result, Some(CronTickResult::Due("manual-task".into())));

        let job = sched.get_job("manual-task").unwrap();
        assert_eq!(job.last_run_at, Some(2000));
        assert_eq!(job.next_run_at, None); // Manual has no next
    }

    #[test]
    fn run_now_returns_none_for_missing_job() {
        let mut sched = make_scheduler();
        let result = sched.run_now("nope", Timestamp::from_seconds(1000));
        assert_eq!(result, None);
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir().join("chronicle-cron-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("state.json");

        let mut sched = CronScheduler::new(&path);
        sched.add_job(interval_job("rt1", 120));
        sched.add_job(interval_job("rt2", 240));
        sched.save_state().unwrap();

        let mut loaded = CronScheduler::new(&path);
        loaded.load_state().unwrap();
        assert_eq!(loaded.jobs().len(), 2);
        assert_eq!(loaded.get_job("rt1").unwrap().interval_seconds, 120);
        assert_eq!(loaded.get_job("rt2").unwrap().interval_seconds, 240);

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn daily_job_due_after_target_hour() {
        let mut sched = make_scheduler();
        // A daily job at hour 3 (3 AM = 10800s into the day)
        let job = CronJob {
            id: "daily".into(),
            name: "Daily".into(),
            description: String::new(),
            enabled: true,
            schedule_kind: ScheduleKind::Daily,
            interval_seconds: 0,
            daily_hour: 3,
            task_kind: TaskKind::DreamArchive,
            last_run_at: None,
            last_run_status: None,
            next_run_at: None,
            created_at: 0,
        };
        sched.add_job(job);

        // Before 3AM on day 1 (86400 + 10000 = 96400, hour ~2.7)
        let results = sched.tick(Timestamp::from_seconds(86_400 + 10_000));
        assert_eq!(results, vec![CronTickResult::Idle]);

        // After 3AM on day 1 (86400 + 11000 = 97400, hour ~3.05)
        let results = sched.tick(Timestamp::from_seconds(86_400 + 11_000));
        assert_eq!(results, vec![CronTickResult::Due("daily".into())]);
    }

    #[test]
    fn daily_job_not_due_twice_same_day() {
        let mut sched = make_scheduler();
        let job = CronJob {
            id: "daily".into(),
            name: "Daily".into(),
            description: String::new(),
            enabled: true,
            schedule_kind: ScheduleKind::Daily,
            interval_seconds: 0,
            daily_hour: 3,
            task_kind: TaskKind::DreamArchive,
            last_run_at: Some(86_400 + 10_800), // Ran at 3AM today
            last_run_status: None,
            next_run_at: None,
            created_at: 0,
        };
        sched.add_job(job);

        // Later same day
        let results = sched.tick(Timestamp::from_seconds(86_400 + 50_000));
        assert_eq!(results, vec![CronTickResult::Idle]);
    }

    #[test]
    fn default_jobs_created() {
        let jobs = default_jobs(Timestamp::from_seconds(10_000));
        assert_eq!(jobs.len(), 6);
        assert_eq!(jobs[0].id, "summarize");
        assert_eq!(jobs[1].id, "crystallize");
        assert_eq!(jobs[2].id, "dream-archive");
        assert_eq!(jobs[3].id, "dream-merge");
        assert_eq!(jobs[4].id, "health-check");
        assert_eq!(jobs[5].id, "cleanup");
    }
}
