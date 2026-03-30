// ---------------------------------------------------------------------------
// storage/events.rs - emision de eventos Tauri al frontend.
// Responsabilidad:
//   * RefreshConfig: estado Tauri con cadencias normal/realtime y refreshes
//     coalescidos.
//   * start_background_ticker: worker unico que emite dashboard-update.
//   * request_dashboard_refresh: helper para pedir refresh sin rebuild inline.
// ---------------------------------------------------------------------------

use std::{
    sync::{Condvar, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::DashboardSnapshot;

use super::db::build_snapshot;
use super::runtime::RuntimeSupervisor;

// ---------------------------------------------------------------------------
// Estado Tauri: cadencias configurables y refresh pendiente
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DashboardRefreshPriority {
    Normal,
    Urgent,
}

#[derive(Debug, Clone, Copy)]
struct RefreshState {
    normal_ms: u64,
    realtime_ms: u64,
    pending_priority: Option<DashboardRefreshPriority>,
    version: u64,
}

impl Default for RefreshState {
    fn default() -> Self {
        Self {
            normal_ms: 2_000,
            realtime_ms: 1_000,
            pending_priority: None,
            version: 0,
        }
    }
}

impl RefreshState {
    fn request_refresh(&mut self, priority: DashboardRefreshPriority) {
        self.pending_priority = Some(
            self.pending_priority
                .map_or(priority, |current| current.max(priority)),
        );
        self.version = self.version.saturating_add(1);
    }

    fn update_intervals(&mut self, normal_ms: u64, realtime_ms: u64) {
        self.normal_ms = normal_ms.max(1_000);
        self.realtime_ms = realtime_ms.max(1_000);
        self.version = self.version.saturating_add(1);
    }

    fn take_pending_refresh(&mut self) -> Option<DashboardRefreshPriority> {
        self.pending_priority.take()
    }

    fn wait_duration(&self, has_active_runtime: bool) -> Duration {
        let interval_ms = if has_active_runtime {
            self.realtime_ms
        } else {
            self.normal_ms
        };
        Duration::from_millis(interval_ms)
    }
}

pub struct RefreshConfig {
    state: Mutex<RefreshState>,
    signal: Condvar,
    build_lock: Mutex<()>,
}

impl Default for RefreshConfig {
    fn default() -> Self {
        Self {
            state: Mutex::new(RefreshState::default()),
            signal: Condvar::new(),
            build_lock: Mutex::new(()),
        }
    }
}

// ---------------------------------------------------------------------------
// Worker de refresh
// ---------------------------------------------------------------------------

pub fn start_background_ticker(app: AppHandle) {
    thread::spawn(move || loop {
        let config = app.state::<RefreshConfig>();
        let mut state = config.state.lock().unwrap();

        if state.take_pending_refresh().is_some() {
            drop(state);
            if let Ok(snapshot) = build_dashboard_snapshot(&app) {
                emit_dashboard_snapshot(&app, &snapshot);
            }
            continue;
        }

        let version = state.version;
        let wait_duration = state.wait_duration(has_active_runtime(&app));
        let (next_state, wait_result) = config
            .signal
            .wait_timeout_while(state, wait_duration, |current| {
                current.pending_priority.is_none() && current.version == version
            })
            .unwrap();
        state = next_state;

        let should_refresh = if state.take_pending_refresh().is_some() {
            true
        } else {
            wait_result.timed_out()
        };

        drop(state);

        if should_refresh {
            if let Ok(snapshot) = build_dashboard_snapshot(&app) {
                emit_dashboard_snapshot(&app, &snapshot);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Helpers reutilizables
// ---------------------------------------------------------------------------

pub fn emit_dashboard_snapshot(app: &AppHandle, snapshot: &DashboardSnapshot) {
    let _ = app.emit("dashboard-update", snapshot.clone());
}

pub fn request_dashboard_refresh(app: &AppHandle, priority: DashboardRefreshPriority) {
    let config = app.state::<RefreshConfig>();
    let mut state = config.state.lock().unwrap();
    state.request_refresh(priority);
    config.signal.notify_one();
}

pub fn update_refresh_intervals(app: &AppHandle, normal_ms: u64, realtime_ms: u64) {
    let config = app.state::<RefreshConfig>();
    let mut state = config.state.lock().unwrap();
    state.update_intervals(normal_ms, realtime_ms);
    config.signal.notify_one();
}

pub fn build_dashboard_snapshot(app: &AppHandle) -> Result<DashboardSnapshot, String> {
    let config = app.state::<RefreshConfig>();
    let _build_guard = config.build_lock.lock().unwrap();
    build_snapshot(app)
}

fn has_active_runtime(app: &AppHandle) -> bool {
    let supervisor = app.state::<RuntimeSupervisor>();
    if !supervisor.launching.lock().unwrap().is_empty() {
        return true;
    }
    let has_supervised_processes = !supervisor.processes.lock().unwrap().is_empty();
    has_supervised_processes
}

#[cfg(test)]
mod tests {
    use super::{DashboardRefreshPriority, RefreshState};
    use std::time::Duration;

    #[test]
    fn coalesces_refresh_requests_by_priority() {
        let mut state = RefreshState::default();
        state.request_refresh(DashboardRefreshPriority::Normal);
        state.request_refresh(DashboardRefreshPriority::Urgent);

        assert_eq!(
            state.take_pending_refresh(),
            Some(DashboardRefreshPriority::Urgent)
        );
        assert_eq!(state.take_pending_refresh(), None);
    }

    #[test]
    fn uses_realtime_interval_when_runtime_is_active() {
        let state = RefreshState::default();
        assert_eq!(state.wait_duration(false), Duration::from_millis(2_000));
        assert_eq!(state.wait_duration(true), Duration::from_millis(1_000));
    }

    #[test]
    fn updates_intervals_from_settings() {
        let mut state = RefreshState::default();
        state.update_intervals(5_000, 2_500);

        assert_eq!(state.wait_duration(false), Duration::from_millis(5_000));
        assert_eq!(state.wait_duration(true), Duration::from_millis(2_500));
    }
}
