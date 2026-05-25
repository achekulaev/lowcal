use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, State,
    },
    routing::get,
    Router,
};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use parking_lot::{Mutex, RwLock};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    net::SocketAddr,
    path::Path,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU16, Ordering},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

mod app_settings;
mod broadcast_idle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub id: String,
    pub display_name: String,
    pub command: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub start_command_on_app_open: bool,
    pub status: SessionStatus,
    /// `true` while the most recent backend-initiated **Start** (sidebar / stage header /
    /// `start_command_on_app_open`) is still the "live" intent — i.e. **Stop** has not been
    /// pressed since. Drives the failure / red-dot indicator together with
    /// `last_exit_code`. Manual typing in the PTY never sets this.
    #[serde(default)]
    pub started_via_ui: bool,
    /// Exit code of the **last** Start-injected command, captured via an APC marker the
    /// shell prints after the command (see `inject_profile_command`). `None` until the
    /// first injected command exits, or while a Start/Stop is in progress.
    #[serde(default)]
    pub last_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Stopped,
    Running,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Config {
    pub profiles: Vec<Profile>,
}

#[inline]
fn serde_skip_bool_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Profile {
    pub id: String,
    #[serde(alias = "displayName")]
    pub display_name: String,
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// When true, injects `command` at app launch (same as **Start**).
    #[serde(default, alias = "startCommandOnAppOpen", skip_serializing_if = "serde_skip_bool_false")]
    pub start_command_on_app_open: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSaveInput {
    pub display_name: String,
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub start_command_on_app_open: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfilePayload {
    pub id: String,
    #[serde(flatten)]
    pub body: ProfileSaveInput,
}

#[derive(Debug)]
enum PtyCtl {
    Stdin(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

pub struct SessionRuntime {
    ctl_tx: std::sync::mpsc::Sender<PtyCtl>,
    output: broadcast::Sender<Vec<u8>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    /// True while the PTY foreground is likely running the profile command started via **Start**
    /// (see watchdog thread). Manual typing alone never sets this.
    command_running: Arc<AtomicBool>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// PID of the login shell child (for `getpgid` / foreground comparisons).
    shell_pid: i32,
    /// Watchdog ignores idle-looking PTYs until this instant has passed (startup / injection jitter).
    watch_gate: Arc<parking_lot::Mutex<Option<Instant>>>,
    /// `true` from the moment **Start** (or `start_command_on_app_open`) injects its
    /// command, until the matching **Stop** clears it. Combined with `command_running` and
    /// `last_exit_code` this lets the UI distinguish "stopped because the user pressed
    /// Stop" (gray) from "Start-injected command finished on its own and failed" (red).
    started_via_ui: Arc<AtomicBool>,
    /// Exit code captured via shell integration (OSC 133;D) or the APC suffix fallback.
    /// `None` while a Start is in flight or after a Stop / Restart resets it.
    last_exit_code: Arc<parking_lot::Mutex<Option<i32>>>,
    /// Which shell family this session uses — determines whether `inject_profile_command`
    /// appends the APC suffix (unknown shells) or relies on the OSC 133;D hook (known).
    shell_kind: ShellKind,
}

pub struct AppStateInner {
    config_path: PathBuf,
    config: RwLock<Config>,
    sessions: Mutex<HashMap<String, SessionRuntime>>,
    ws_port: AtomicU16,
    /// Set to `true` once the user has confirmed Quit-with-running. Lets the
    /// second `CloseRequested` (triggered by `window.destroy()`) short-circuit
    /// instead of re-prompting.
    close_confirmed: AtomicBool,
    /// Profile ids whose `start_command_on_app_open` auto-start is currently
    /// **in flight** inside `apply_startup_profile_actions` — the long
    /// `wait_for_login_shell_ready` + `wait_until_broadcast_receiver_idle`
    /// pipeline runs before `command_running` flips to `true`, so during that
    /// window the close-confirmation handler would otherwise miss them. The
    /// id is removed (via `StartupPendingGuard`) as soon as
    /// `start_profile_inner` returns (success or error), and `running_profile_names`
    /// unions this set into the running list so quit-during-launch still prompts.
    startup_pending: Mutex<HashSet<String>>,
}

pub type SharedState = Arc<AppStateInner>;

pub fn expand_path(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

/// Where `terminals.yaml` and `settings.yaml` live on disk.
///
/// By default this is Tauri's `app_config_dir()` (on macOS that's
/// `~/Library/Application Support/<identifier>/`). The `LOWCAL_CONFIG_DIR`
/// environment variable overrides it for demo / screenshot / scratch
/// instances — set it before launching the app and **both** YAML files
/// (and any future sibling file) will be read/written from there instead.
/// `~/` is expanded the same way it is for profile `cwd` so users can type
/// `LOWCAL_CONFIG_DIR=~/lowcal-demo` without resolving `$HOME` themselves.
///
/// Both `setup(...)` (terminals.yaml) and `app_settings::settings_path`
/// (settings.yaml) call this so the override is honoured for the full
/// on-disk surface, not just one file.
pub(crate) fn resolved_app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("LOWCAL_CONFIG_DIR") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let dir = expand_path(trimmed);
            tracing::info!(
                "LOWCAL_CONFIG_DIR override active — config dir = {}",
                dir.display()
            );
            return Ok(dir);
        }
    }
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Canonical absolute cwd for UI (same expansion as spawning a PTY). Non-existent paths keep the expanded path without canonicalizing.
#[tauri::command]
fn resolve_working_directory(raw: Option<String>) -> Result<Option<String>, String> {
    let Some(s) = raw else {
        return Ok(None);
    };
    if s.trim().is_empty() {
        return Ok(None);
    }

    let pb = expand_path(s.trim());
    let abs = match pb.canonicalize() {
        Ok(p) => p,
        Err(_) => pb,
    };
    Ok(Some(abs.display().to_string()))
}

/// User home directory for UI (tildeabbrev in the terminal header). `None` if unknown.
#[tauri::command]
fn user_home_directory() -> Result<Option<String>, String> {
    Ok(dirs::home_dir().map(|p| p.display().to_string()))
}

fn default_config_yaml() -> &'static str {
    r#"# Terminal orchestrator — edit profiles and tags
# Each profile opens an interactive login shell. Use **Start** to run `command` in that shell.
profiles:
  - id: demo-shell
    displayName: Demo shell
    command: 'echo "Hello from this profile''s Start command"'
    cwd: ~
    tags: [demo]
"#
}

impl AppStateInner {
    fn load_or_create_config(path: &std::path::Path) -> Result<Config, String> {
        if !path.exists() {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(path, default_config_yaml()).map_err(|e| e.to_string())?;
        }
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_yaml::from_str(&text).map_err(|e| format!("invalid YAML: {e}"))
    }

    pub fn new(config_path: PathBuf) -> Result<Self, String> {
        let config = Self::load_or_create_config(&config_path)?;
        Ok(Self {
            config_path,
            config: RwLock::new(config),
            sessions: Mutex::new(HashMap::new()),
            ws_port: AtomicU16::new(0),
            close_confirmed: AtomicBool::new(false),
            startup_pending: Mutex::new(HashSet::new()),
        })
    }

    pub fn set_ws_port(&self, port: u16) {
        self.ws_port.store(port, Ordering::SeqCst);
    }

    pub fn ws_port(&self) -> u16 {
        self.ws_port.load(Ordering::SeqCst)
    }

    pub fn reload_config(&self) -> Result<(), String> {
        let cfg = Self::load_or_create_config(&self.config_path)?;
        *self.config.write() = cfg;
        Ok(())
    }

    /// Read `terminals.yaml` from disk without creating a default file (for comparison / validation).
    pub fn read_config_strict(path: &Path) -> Result<Config, String> {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_yaml::from_str(&text).map_err(|e| format!("invalid YAML: {e}"))
    }

    /// Write the in-memory config snapshot to disk (overwrites external edits).
    pub fn persist_memory_to_disk(&self) -> Result<(), String> {
        let yaml = {
            let cfg = self.config.read();
            serde_yaml::to_string(&*cfg).map_err(|e| e.to_string())?
        };
        fs::write(&self.config_path, yaml).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn config_snapshot(&self) -> Config {
        self.config.read().clone()
    }

    pub fn list_dtos(&self) -> Vec<ProfileDto> {
        let cfg = self.config.read();
        let sessions = self.sessions.lock();
        cfg
            .profiles
            .iter()
            .map(|p| {
                let (status, started_via_ui, last_exit_code) = sessions
                    .get(&p.id)
                    .map(|s| {
                        let running = s.command_running.load(Ordering::SeqCst);
                        let started = s.started_via_ui.load(Ordering::SeqCst);
                        let last = *s.last_exit_code.lock();
                        let status = if running {
                            SessionStatus::Running
                        } else {
                            SessionStatus::Stopped
                        };
                        (status, started, last)
                    })
                    .unwrap_or((SessionStatus::Stopped, false, None));
                ProfileDto {
                    id: p.id.clone(),
                    display_name: p.display_name.clone(),
                    command: p.command.clone(),
                    cwd: p.cwd.clone(),
                    env: p.env.clone(),
                    tags: p.tags.clone(),
                    start_command_on_app_open: p.start_command_on_app_open,
                    status,
                    started_via_ui,
                    last_exit_code,
                }
            })
            .collect()
    }

    pub fn profile_ids_for_tag(&self, tag: &str) -> Vec<String> {
        let cfg = self.config.read();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for p in &cfg.profiles {
            if p.tags.iter().any(|t| t == tag) && seen.insert(p.id.clone()) {
                out.push(p.id.clone());
            }
        }
        out
    }

    /// Atomically apply mutation and persist YAML to disk.
    pub fn write_cfg<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut Config) -> Result<(), String>,
    {
        let mut cfg = self.config.write();
        f(&mut cfg)?;
        let yaml = serde_yaml::to_string(&*cfg).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, yaml).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for t in tags {
        let t = t.trim().to_string();
        if t.is_empty() {
            continue;
        }
        if seen.insert(t.clone()) {
            out.push(t);
        }
    }
    out
}

fn normalize_env(env: HashMap<String, String>) -> HashMap<String, String> {
    env.into_iter()
        .filter_map(|(k, v)| {
            let k = k.trim().to_string();
            let v = v.trim().to_string();
            if k.is_empty() {
                None
            } else {
                Some((k, v))
            }
        })
        .collect()
}

fn slug_from_display(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let mut slug = String::new();
    let mut prev_hyphen = true;
    for ch in lower.chars() {
        match ch {
            'a'..='z' | '0'..='9' => {
                slug.push(ch);
                prev_hyphen = false;
            }
            ' ' | '-' | '_' => {
                if !prev_hyphen && !slug.is_empty() {
                    slug.push('-');
                    prev_hyphen = true;
                }
            }
            _ => {}
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "terminal".into()
    } else {
        slug
    }
}

fn unique_profile_id(base: &str, existing: &HashSet<String>) -> String {
    if !existing.contains(base) {
        return base.to_string();
    }
    for n in 2..10_000u32 {
        let cand = format!("{base}-{n}");
        if !existing.contains(&cand) {
            return cand;
        }
    }
    format!(
        "{base}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

fn normalized_profile_body(
    input: ProfileSaveInput,
) -> Result<(String, String, Option<String>, Vec<String>, HashMap<String, String>, bool), String> {
    let display_name = input.display_name.trim().to_string();
    let command = input.command.trim().to_string();
    if display_name.is_empty() {
        return Err("display name is required".into());
    }
    if command.is_empty() {
        return Err("command is required".into());
    }
    let cwd = input
        .cwd
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        })
        .or_else(|| dirs::home_dir().map(|h| h.display().to_string()));
    let tags = normalize_tags(input.tags);
    let env = normalize_env(input.env);
    let start_command_on_app_open = input.start_command_on_app_open;
    Ok((
        display_name,
        command,
        cwd,
        tags,
        env,
        start_command_on_app_open,
    ))
}

fn emit_profiles(app: &AppHandle, state: &SharedState) {
    let list = state.list_dtos();
    let _ = app.emit("profiles-updated", list);
}

fn disk_config_differs_from_memory(state: &SharedState, config_path: &Path) -> bool {
    match AppStateInner::read_config_strict(config_path) {
        Ok(disk) => disk != state.config_snapshot(),
        Err(_) => true,
    }
}

fn config_file_event_targets_path(event: &notify::Event, config_path: &Path) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|p| p.as_path() == config_path)
}

/// Snapshot of display names for profiles the close-confirmation prompt
/// considers "running": either their Start-injected command is live
/// (`command_running == true`), or their `start_command_on_app_open` is
/// currently being processed by `apply_startup_profile_actions` (i.e. the id
/// is in `startup_pending`). The latter covers the multi-second window
/// between app launch and the actual `inject_profile_command` call where
/// `command_running` hasn't flipped yet but the user still expects the
/// command to be running on quit. Iterates `cfg.profiles` so the order
/// matches the YAML / sidebar list rather than the unordered `sessions` /
/// `startup_pending` maps.
fn running_profile_names(state: &SharedState) -> Vec<String> {
    let sessions = state.sessions.lock();
    let pending = state.startup_pending.lock();
    let cfg = state.config.read();
    cfg.profiles
        .iter()
        .filter_map(|p| {
            let live = sessions
                .get(&p.id)
                .map(|rt| rt.command_running.load(Ordering::SeqCst))
                .unwrap_or(false);
            let starting = pending.contains(&p.id);
            (live || starting).then(|| p.display_name.clone())
        })
        .collect()
}

/// Asks the frontend to surface the in-app **Quit confirmation** modal. Emits
/// `confirm-quit` with the list of running profile display names; the UI in
/// [`src/components/quit-confirm-modal.tsx`] listens for this event, opens the
/// React modal, and on **OK** the user invokes the `confirm_quit_proceed`
/// Tauri command — which is the only path that actually calls `app.exit(0)`.
/// On **Cancel** the frontend just closes the modal locally; nothing else
/// needs to be told because each quit route already prevented its respective
/// close/exit before emitting.
///
/// We deliberately use a custom React modal instead of a native NSAlert so
/// the dialog is wide enough for `"Quit Lowcal Terminal Orchestrator?"` to
/// stay on a single line and follows the app's theme. The native
/// `tauri-plugin-dialog` `MessageDialog` doesn't expose width controls and
/// `NSAlert` auto-sizes to its body content, which sometimes wrapped the
/// title.
fn emit_quit_confirmation(app: &AppHandle, running: Vec<String>) {
    if let Err(e) = app.emit("confirm-quit", running) {
        // If the emit fails (window already gone, etc.), there's no UI to
        // confirm in — log and stay running. The user can retry the quit.
        tracing::warn!(error = %e, "failed to emit confirm-quit event");
    }
}

/// Frontend → backend bridge for the **OK / Quit anyway** action of the
/// custom quit-confirmation modal. Sets the one-shot bypass flag so the next
/// `WindowEvent::CloseRequested` / `RunEvent::ExitRequested` short-circuits
/// without re-prompting, then triggers the standard Tauri exit path. **Cancel**
/// has no backend counterpart — the modal just closes locally.
#[tauri::command]
async fn confirm_quit_proceed(app: AppHandle, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    state.close_confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

#[cfg(not(mobile))]
fn destroy_all_shell_sessions(app: &AppHandle, state: &SharedState) {
    let runtimes: Vec<SessionRuntime> = {
        let mut g = state.sessions.lock();
        g.drain().map(|(_, rt)| rt).collect()
    };
    for rt in runtimes {
        dispose_runtime_quiet(rt);
    }
    emit_profiles(app, state);
}

#[cfg(not(mobile))]
fn spawn_config_file_watcher(app: AppHandle, state: SharedState, config_path: PathBuf) {
    let Some(watch_dir) = config_path.parent().map(|p| p.to_path_buf()) else {
        tracing::warn!("config path has no parent; external file watching disabled");
        return;
    };

    std::thread::spawn(move || {
        let prompt_gate = Arc::new(Mutex::new(()));
        let (notify_tx, notify_rx) = std::sync::mpsc::channel();
        let watched_path = config_path.clone();

        let mut watcher = match RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                if let Ok(ev) = res {
                    if config_file_event_targets_path(&ev, &watched_path) {
                        let _ = notify_tx.send(());
                    }
                }
            },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!(error = %e, "failed to create config file watcher");
                return;
            }
        };

        if let Err(e) = watcher.watch(&watch_dir, RecursiveMode::NonRecursive) {
            tracing::warn!(error = %e, dir = ?watch_dir, "failed to watch config directory");
            return;
        }

        let _keep_watcher_alive = watcher;

        loop {
            if notify_rx.recv().is_err() {
                break;
            }

            std::thread::sleep(Duration::from_millis(280));
            while notify_rx.try_recv().is_ok() {}

            let _held = prompt_gate.lock();

            if !disk_config_differs_from_memory(&state, &config_path) {
                continue;
            }

            let reload = app
                .dialog()
                .message(
                    "terminals.yaml was modified outside the app.\n\n\
                     Reload from disk (all open terminal sessions will close), \
                     or keep the configuration currently loaded in the app and overwrite the file on disk.",
                )
                .title("Configuration file changed")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Reload from disk".into(),
                    "Keep app version".into(),
                ))
                .blocking_show();

            if reload {
                if let Err(e) = AppStateInner::read_config_strict(&config_path) {
                    app.dialog()
                        .message(format!(
                            "The file on disk is not valid YAML. Sessions were not changed.\n\n{e}"
                        ))
                        .title("Cannot reload")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::Ok)
                        .blocking_show();
                    continue;
                }

                destroy_all_shell_sessions(&app, &state);
                if let Err(e) = state.reload_config() {
                    app.dialog()
                        .message(e)
                        .title("Reload failed")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::Ok)
                        .blocking_show();
                    continue;
                }
                apply_startup_profile_actions(&app, &state);
                emit_profiles(&app, &state);
            } else if let Err(e) = state.persist_memory_to_disk() {
                app.dialog()
                    .message(format!("Failed to write the in-memory config to disk:\n\n{e}"))
                    .title("Could not save")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .blocking_show();
            }
        }
    });
}

#[cfg(unix)]
fn kill_process_tree_best_effort(child: &mut dyn Child) {
    use std::time::Duration;
    if let Some(pid) = child.process_id() {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        std::thread::sleep(Duration::from_millis(150));
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_process_tree_best_effort(_child: &mut dyn Child) {}

#[cfg(unix)]
fn tty_foreground_pgrp(master_fd: libc::c_int) -> Option<libc::pid_t> {
    let p = unsafe { libc::tcgetpgrp(master_fd) };
    if p < 0 {
        None
    } else {
        Some(p)
    }
}

#[cfg(unix)]
fn shell_process_group(shell_pid: libc::pid_t) -> Option<libc::pid_t> {
    if shell_pid <= 0 {
        return None;
    }
    let p = unsafe { libc::getpgid(shell_pid) };
    if p < 0 {
        None
    } else {
        Some(p)
    }
}

#[cfg(unix)]
fn foreground_is_login_shell(master_fd: libc::c_int, shell_pid: libc::pid_t) -> bool {
    match (tty_foreground_pgrp(master_fd), shell_process_group(shell_pid)) {
        (Some(fg), Some(sp)) => fg == sp,
        _ => false,
    }
}

/// After the first Ctrl+C, wait up to 1500ms for the foreground to return to the login shell.
/// Some foreground jobs (e.g. Docker Compose) need a second interrupt to finish teardown.
#[cfg(unix)]
fn poll_second_interrupt_if_foreground_busy(
    ctl_tx: &std::sync::mpsc::Sender<PtyCtl>,
    master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    shell_pid: i32,
) {
    if shell_pid <= 0 {
        return;
    }
    const POLL_TOTAL: Duration = Duration::from_millis(1500);
    const TICK: Duration = Duration::from_millis(50);
    let deadline = Instant::now() + POLL_TOTAL;
    while Instant::now() < deadline {
        std::thread::sleep(TICK);
        let fd_opt = {
            let g = master.lock();
            g.as_raw_fd()
        };
        let Some(fd) = fd_opt else {
            continue;
        };
        if foreground_is_login_shell(fd, shell_pid as libc::pid_t) {
            return;
        }
    }
    let fd_opt = {
        let g = master.lock();
        g.as_raw_fd()
    };
    let Some(fd) = fd_opt else {
        return;
    };
    if !foreground_is_login_shell(fd, shell_pid as libc::pid_t) {
        let _ = ctl_tx.send(PtyCtl::Stdin(vec![0x03]));
    }
}

#[cfg(not(unix))]
fn poll_second_interrupt_if_foreground_busy(
    _ctl_tx: &std::sync::mpsc::Sender<PtyCtl>,
    _master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    _shell_pid: i32,
) {
}

fn stop_session_foreground_interrupt(
    ctl_tx: &std::sync::mpsc::Sender<PtyCtl>,
    master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    shell_pid: i32,
    running_flag: &Arc<AtomicBool>,
    gate: &Arc<parking_lot::Mutex<Option<Instant>>>,
    started_via_ui: &Arc<AtomicBool>,
    last_exit_code: &Arc<parking_lot::Mutex<Option<i32>>>,
) {
    let _ = ctl_tx.send(PtyCtl::Stdin(vec![0x03]));
    poll_second_interrupt_if_foreground_busy(ctl_tx, master, shell_pid);
    running_flag.store(false, Ordering::SeqCst);
    *gate.lock() = None;
    // Cleared so a Ctrl+C-induced 130 from the in-flight printf does NOT trigger the red
    // failure dot; the user intentionally pressed Stop.
    started_via_ui.store(false, Ordering::SeqCst);
    *last_exit_code.lock() = None;
}

/// Wait until the login shell owns the TTY foreground (interactive), or timeout.
/// Without this, injecting the Start command immediately after `spawn_shell_session` often races
/// the shell/login init and the command never runs.
#[cfg(unix)]
fn wait_for_login_shell_ready(
    master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    shell_pid: i32,
    timeout: Duration,
) -> bool {
    if shell_pid <= 0 {
        return false;
    }
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let fd_opt = {
            let g = master.lock();
            g.as_raw_fd()
        };
        let Some(fd) = fd_opt else {
            std::thread::sleep(Duration::from_millis(40));
            continue;
        };
        if foreground_is_login_shell(fd, shell_pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    false
}

#[cfg(not(unix))]
fn wait_for_login_shell_ready(
    _master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    _shell_pid: i32,
    _timeout: Duration,
) -> bool {
    true
}

#[cfg(unix)]
fn kill_non_shell_foreground(master_fd: libc::c_int, shell_pid: libc::pid_t) {
    let Some(fg) = tty_foreground_pgrp(master_fd) else {
        return;
    };
    let Some(spg) = shell_process_group(shell_pid) else {
        return;
    };
    if fg == spg {
        return;
    }
    unsafe {
        libc::kill(-fg, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(90));
    unsafe {
        libc::kill(-fg, libc::SIGKILL);
    }
}

#[cfg(unix)]
fn prepare_tty_for_saved_command(rt: &SessionRuntime) {
    if rt.shell_pid <= 0 {
        return;
    }
    let fd_opt = {
        let g = rt.master.lock();
        g.as_raw_fd()
    };
    let Some(fd) = fd_opt else {
        return;
    };
    kill_non_shell_foreground(fd, rt.shell_pid);
}

#[cfg(not(unix))]
fn prepare_tty_for_saved_command(_rt: &SessionRuntime) {}

#[cfg(unix)]
fn spawn_command_watchdog(
    app: AppHandle,
    state: SharedState,
    profile_id: String,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    shell_pid: i32,
    command_running: Arc<AtomicBool>,
    watch_gate: Arc<parking_lot::Mutex<Option<Instant>>>,
) {
    if shell_pid <= 0 {
        return;
    }

    std::thread::spawn(move || {
        let mut consec_shell_fg = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(180));
            if !state.sessions.lock().contains_key(&profile_id) {
                break;
            }
            if !command_running.load(Ordering::SeqCst) {
                consec_shell_fg = 0;
                continue;
            }

            let fd_opt = {
                let g = master.lock();
                g.as_raw_fd()
            };
            let Some(fd) = fd_opt else {
                continue;
            };

            let gate_open = {
                let gl = watch_gate.lock();
                gl.as_ref()
                    .map(|t| t.elapsed() >= Duration::from_millis(500))
                    .unwrap_or(false)
            };
            if !gate_open {
                consec_shell_fg = 0;
                continue;
            }

            if foreground_is_login_shell(fd, shell_pid) {
                consec_shell_fg += 1;
                if consec_shell_fg >= 4 {
                    command_running.store(false, Ordering::SeqCst);
                    *watch_gate.lock() = None;
                    consec_shell_fg = 0;
                    emit_profiles(&app, &state);
                }
            } else {
                consec_shell_fg = 0;
            }
        }
    });
}

fn dispose_runtime_quiet(rt: SessionRuntime) {
    drop(rt.ctl_tx);
    if let Some(mut child) = rt.child.lock().take() {
        kill_process_tree_best_effort(child.as_mut());
        let _ = child.wait();
    }
}

/// Suffix appended to Start-injected commands for **unknown shells** that have no
/// shell-integration hook. All printable ASCII — the shell's `printf` interprets `\033`
/// as ESC at execution time and emits the real APC sequence. The echo of this suffix is
/// stripped by `InjectedEchoScrubber` before reaching xterm.js.
const INJECTED_ECHO_SUFFIX: &[u8] = b"; printf '\\033_LOWCAL_RC=%d\\033\\\\' \"$?\"";

/// Streaming scanner that recognises two exit-code markers:
///
/// **Primary — OSC 133;D (shell integration hooks for bash/zsh/fish):**
/// ```text
/// ESC ] 133 ; D ; <digits> BEL
/// ```
/// Emitted by the `precmd` / `PROMPT_COMMAND` / `fish_postexec` hooks installed by our
/// shell-integration rc files. xterm.js dispatches unknown OSC numbers to a no-op
/// handler, so this marker is invisible in the rendered terminal.
///
/// **Secondary — APC fallback (unknown shells via suffix injection):**
/// ```text
/// ESC _ LOWCAL_RC = <digits> ESC \
/// ```
/// Emitted by the `printf` appended to injected commands for unrecognised shells.
/// xterm.js's APC state exits cleanly on `0x9c`; the `ESC \` terminator sometimes leaks
/// a stray `\` but that is a pre-existing limitation of the fallback path.
///
/// The scanner drains all fully-formed markers from a rolling tail and returns the
/// **last** code seen per `feed` call so back-to-back markers collapse to one UI update.
///
/// Owned by the reader thread; not thread-safe (single owner only).
struct ExitCodeScanner {
    pending: Vec<u8>,
}

const OSC133_D_PREFIX: &[u8] = b"\x1b]133;D;";
const APC_PREFIX: &[u8] = b"\x1b_LOWCAL_RC=";
const SCAN_BUF_CAP: usize = 1024;

impl ExitCodeScanner {
    fn new() -> Self { Self { pending: Vec::new() } }

    fn feed(&mut self, chunk: &[u8]) -> Option<i32> {
        self.pending.extend_from_slice(chunk);
        let mut found = None;

        'outer: loop {
            // Find whichever marker prefix comes first.
            let osc_pos = self.pending.windows(OSC133_D_PREFIX.len())
                .position(|w| w == OSC133_D_PREFIX);
            let apc_pos = self.pending.windows(APC_PREFIX.len())
                .position(|w| w == APC_PREFIX);

            match (osc_pos, apc_pos) {
                (None, None) => break,
                (Some(o), Some(a)) if a < o => {
                    // APC comes first — handle it.
                    if let Some(code) = Self::try_drain_apc(&mut self.pending, a) {
                        found = Some(code);
                        continue 'outer;
                    }
                    break;
                }
                (Some(o), _) => {
                    // OSC 133;D comes first — handle it.
                    if let Some(code) = Self::try_drain_osc133(&mut self.pending, o) {
                        found = Some(code);
                        continue 'outer;
                    }
                    break;
                }
                (None, Some(a)) => {
                    if let Some(code) = Self::try_drain_apc(&mut self.pending, a) {
                        found = Some(code);
                        continue 'outer;
                    }
                    break;
                }
            }
        }

        if self.pending.len() > SCAN_BUF_CAP {
            let drop = self.pending.len() - SCAN_BUF_CAP;
            self.pending.drain(..drop);
        }
        found
    }

    /// Try to drain one complete `ESC ] 133 ; D ; <digits> (BEL|ESC\|0x9c)` at `start`.
    /// Returns the parsed code on success and drains the marker. Returns `None` and trims
    /// the buffer up to `start` when the terminator hasn't arrived yet.
    fn try_drain_osc133(buf: &mut Vec<u8>, start: usize) -> Option<i32> {
        let after = start + OSC133_D_PREFIX.len();
        // Scan for any accepted OSC terminator: BEL (0x07), ST (ESC \), or 0x9c.
        let term_pos = buf[after..].iter().position(|&b| {
            b == 0x07 || b == 0x9c || b == 0x1b
        })?;
        let term_start = after + term_pos;
        let term_end = if buf[term_start] == 0x1b {
            // Needs a second byte `\`; if not yet arrived, keep buffering.
            if term_start + 1 >= buf.len() { return None; }
            if buf[term_start + 1] != b'\\' {
                // Not ST — skip this ESC and keep searching.
                buf.drain(..term_start + 1);
                return None;
            }
            term_start + 2
        } else {
            term_start + 1
        };
        // Digits (and optional ;key=value FinalTerm fields) between prefix and terminator.
        let raw = std::str::from_utf8(&buf[after..term_start]).ok()?;
        let digits = raw.split(';').next().unwrap_or("");
        let code = digits.parse::<i32>().ok();
        buf.drain(..term_end);
        code
    }

    /// Try to drain one complete `ESC _ LOWCAL_RC = <digits> ESC \` at `start`.
    fn try_drain_apc(buf: &mut Vec<u8>, start: usize) -> Option<i32> {
        let after = start + APC_PREFIX.len();
        const APC_TERM: &[u8] = b"\x1b\\";
        let end_off = buf[after..].windows(APC_TERM.len())
            .position(|w| w == APC_TERM)?;
        let digits = std::str::from_utf8(&buf[after..after + end_off]).ok()?;
        let code = digits.parse::<i32>().ok();
        buf.drain(..after + end_off + APC_TERM.len());
        code
    }
}

/// `true` when `LOWCAL_DEBUG_BYTES` env var is set to a non-empty / non-"0" value at
/// process startup. Used to gate verbose byte-level `tracing::debug!`s in the PTY reader
/// thread and at `inject_profile_command` so normal dev runs stay quiet; flip it on with
/// `LOWCAL_DEBUG_BYTES=1 cargo tauri dev --features debug-bridge` plus
/// `tauri-browser logs --level debug` to capture the raw scrubber I/O for diagnostics.
fn lowcal_debug_bytes_enabled() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| {
        matches!(
            std::env::var("LOWCAL_DEBUG_BYTES").as_deref(),
            Ok(v) if !v.is_empty() && v != "0"
        )
    })
}

/// Render a byte slice with non-printable characters escaped (`\x1b`, `\r`, `\n`, `\t`,
/// `\xNN`) so it survives a single log line. Used only behind `lowcal_debug_bytes_enabled`.
fn escape_bytes_for_log(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    for &b in bytes {
        match b {
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            0x1b => out.push_str("\\x1b"),
            0x20..=0x7e => out.push(b as char),
            _ => out.push_str(&format!("\\x{:02x}", b)),
        }
    }
    out
}

/// Returns a handle to the per-process debug log file, creating it on first call.
/// Path: `$TMPDIR/lowcal-debug/YYYYMMDD-HHMMSS.<pid>.log`
fn debug_log() -> Option<&'static std::sync::Mutex<std::io::BufWriter<fs::File>>> {
    static LOG: std::sync::OnceLock<Option<std::sync::Mutex<std::io::BufWriter<fs::File>>>> =
        std::sync::OnceLock::new();
    LOG.get_or_init(|| {
        if !lowcal_debug_bytes_enabled() { return None; }
        let dir = std::env::temp_dir().join("lowcal-debug");
        fs::create_dir_all(&dir).ok()?;
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs()).unwrap_or(0);
        let s = secs % 60; let m = (secs / 60) % 60; let h = (secs / 3600) % 24;
        let days = secs / 86400;
        let y = 1970 + days / 365; let yd = days % 365;
        let mo = yd / 30 + 1; let d = yd % 30 + 1;
        let name = format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}.{}.log", std::process::id());
        let path = dir.join(&name);
        eprintln!("[lowcal] LOWCAL_DEBUG_BYTES → {}", path.display());
        let file = fs::File::create(&path).ok()?;
        Some(std::sync::Mutex::new(std::io::BufWriter::new(file)))
    }).as_ref()
}

/// Write one line to the debug log file. No-op when `LOWCAL_DEBUG_BYTES` is unset.
fn debug_writeln(line: &str) {
    use std::io::Write;
    if let Some(lock) = debug_log() {
        if let Ok(mut w) = lock.lock() {
            let _ = writeln!(w, "{line}");
            let _ = w.flush();
        }
    }
}

/// Streaming filter that removes the **echo** of `INJECTED_ECHO_SUFFIX` from PTY output
/// before it reaches xterm.js, so the orchestrator instrumentation never renders on the
/// prompt line.
///
/// Why this works without an "is a Start in flight?" gate: the shell's `readline` / `zle`
/// echoes back exactly the bytes we wrote into the master. The injected suffix is a fixed
/// printable string we control, and no user is going to type those 39 characters by accident
/// in their own input — so any occurrence in the output stream is, with overwhelming
/// probability, the round-trip of our own injection. (If a user really does, the only
/// consequence is that one line of their output gets clipped — same severity as a typo.)
///
/// The exit-code APC marker that `printf` emits at *execution* time is intentionally **not**
/// touched by this scrubber: `ExitCodeScanner` consumes the unfiltered chunk, and xterm.js
/// swallows real APC sequences on its own. This scrubber only operates on the bytes we
/// forward to the broadcast channel.
///
/// ## Limitations (documented, accepted)
///
/// 1. zsh plugins that colorize the input line as you type (`zsh-syntax-highlighting`,
///    starship's input-highlight variants, etc.) insert `\033[…m` ANSI runs *between*
///    individual characters of the echoed suffix. The literal-byte match then fails and the
///    suffix stays visible — falls back to pre-scrubber behavior, doesn't make it worse.
/// 2. If the terminal width is narrow enough that the injected line wraps mid-suffix, the
///    shell inserts wrap bytes (CR + spaces, or a soft-wrap sequence) between characters of
///    the echo. Same outcome as #1.
/// 3. `bash-preexec` and similar `preexec` hooks that emit ANSI before each command don't
///    intrude into the suffix itself, so they survive this fine.
///
/// Owned by the reader thread; not thread-safe (single owner only).
struct InjectedEchoScrubber {
    /// Holds a strict prefix of `INJECTED_ECHO_SUFFIX` that might be the start of an
    /// in-progress occurrence split across PTY `read()` boundaries. Bounded by
    /// `INJECTED_ECHO_SUFFIX.len() - 1` bytes by construction (never exceeds it).
    pending: Vec<u8>,
}

impl InjectedEchoScrubber {
    fn new() -> Self {
        Self { pending: Vec::new() }
    }

    /// Append `chunk` to the rolling tail and return the bytes that are **safe to forward**
    /// to xterm.js — i.e. everything except complete occurrences of `INJECTED_ECHO_SUFFIX`,
    /// minus a trailing slice short enough that it could still be the prefix of a not-yet-
    /// complete occurrence (held back for the next `feed` call).
    fn feed(&mut self, chunk: &[u8]) -> Vec<u8> {
        self.pending.extend_from_slice(chunk);
        let sig = INJECTED_ECHO_SUFFIX;
        let mut out = Vec::with_capacity(self.pending.len());
        let mut i = 0;
        while i < self.pending.len() {
            // Full match → skip the whole signature.
            if self.pending[i..].starts_with(sig) {
                i += sig.len();
                continue;
            }
            // Tail strictly shorter than the signature *and* a valid prefix of it: it might
            // still complete on the next read. Hold the tail back and break.
            let remaining = &self.pending[i..];
            if remaining.len() < sig.len() && sig.starts_with(remaining) {
                break;
            }
            out.push(self.pending[i]);
            i += 1;
        }
        self.pending.drain(..i);
        out
    }

    /// Flush whatever is still buffered (used when the PTY reader loop exits — at that
    /// point no more bytes can arrive, so any held-back tail is by definition *not* the
    /// start of a future signature and should be released to the UI).
    fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }

    /// Length of the in-progress prefix the scrubber is currently holding back (for
    /// `LOWCAL_DEBUG_BYTES` diagnostics — never used for control flow).
    #[allow(dead_code)]
    fn pending_len(&self) -> usize {
        self.pending.len()
    }

    /// Borrow the in-progress prefix bytes (for `LOWCAL_DEBUG_BYTES` diagnostics — never
    /// used for control flow). Returned slice is valid until the next `feed`/`flush` call.
    #[allow(dead_code)]
    fn pending_snapshot(&self) -> &[u8] {
        &self.pending
    }
}

// ── Shell integration ─────────────────────────────────────────────────────────

/// Identifies the shell family so we know how to wire the integration hook.
#[derive(Clone, Copy, Debug, PartialEq)]
enum ShellKind { Bash, Zsh, Fish, Other }

fn detect_shell_kind(shell_path: &std::path::Path) -> ShellKind {
    let name = shell_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.trim_start_matches('-'))
        .unwrap_or("");
    match name {
        "bash" | "bash.exe" => ShellKind::Bash,
        "zsh"  | "zsh.exe"  => ShellKind::Zsh,
        "fish" | "fish.exe" => ShellKind::Fish,
        _ => ShellKind::Other,
    }
}

/// Materialises the bundled shell-integration files into
/// `<app_local_data_dir>/shell-integration/` once per process, and returns the
/// directory path. Uses a `OnceLock` so subsequent shell spawns are free.
fn shell_integration_dir(app: &AppHandle) -> Option<PathBuf> {
    static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        let base = app.path().app_local_data_dir().ok()?;
        let dir = base.join("shell-integration");
        let zdotdir = dir.join("zdotdir");
        fs::create_dir_all(&zdotdir).ok()?;

        macro_rules! write_file {
            ($path:expr, $content:expr) => {
                fs::write($path, $content).ok()?;
            };
        }
        write_file!(dir.join("integration.bash"),
            include_str!("../shell-integration/integration.bash"));
        write_file!(dir.join("integration.zsh"),
            include_str!("../shell-integration/integration.zsh"));
        write_file!(dir.join("integration.fish"),
            include_str!("../shell-integration/integration.fish"));
        write_file!(zdotdir.join(".zshrc"),
            include_str!("../shell-integration/zdotdir/.zshrc"));
        write_file!(zdotdir.join(".zprofile"),
            include_str!("../shell-integration/zdotdir/.zprofile"));
        write_file!(zdotdir.join(".zshenv"),
            include_str!("../shell-integration/zdotdir/.zshenv"));
        write_file!(zdotdir.join(".zlogin"),
            include_str!("../shell-integration/zdotdir/.zlogin"));

        Some(dir)
    }).clone()
}

/// Wire the shell command and env vars for shell integration. Returns the shell
/// kind (used later by `inject_profile_command` to decide whether to append the
/// suffix fallback for unknown shells).
fn apply_shell_integration(
    app: &AppHandle,
    shell_path: &std::path::Path,
    cmd: &mut CommandBuilder,
) -> ShellKind {
    let kind = detect_shell_kind(shell_path);
    let Some(dir) = shell_integration_dir(app) else {
        tracing::warn!("shell integration dir unavailable — falling back to plain shell");
        return ShellKind::Other;
    };

    match kind {
        ShellKind::Bash => {
            // bash -l does not honour --rcfile, so we drop -l and replay the
            // login chain ourselves inside integration.bash.
            cmd.arg("--rcfile");
            cmd.arg(dir.join("integration.bash"));
        }
        ShellKind::Zsh => {
            // ZDOTDIR redirect causes zsh to read our shim startup files which
            // chain to the user's real files, then source integration.zsh.
            // LOWCAL_ORIG_ZDOTDIR lets the shims find the user's actual files.
            // LOWCAL_INTEGRATION_DIR lets integration.zsh be located without
            // relying on $0 (which is "zsh" in auto-sourced .zshrc — pitfall #2).
            let orig_zdotdir = std::env::var_os("ZDOTDIR")
                .unwrap_or_else(|| std::env::var_os("HOME").unwrap_or_default());
            cmd.env("ZDOTDIR", dir.join("zdotdir"));
            cmd.env("LOWCAL_ORIG_ZDOTDIR", orig_zdotdir);
            cmd.env("LOWCAL_INTEGRATION_DIR", &dir);
        }
        ShellKind::Fish => {
            // -C runs after config.fish so our hook installs after the user's config.
            let snippet = format!("source '{}'", dir.join("integration.fish").display());
            cmd.arg("-C");
            cmd.arg(snippet);
        }
        ShellKind::Other => {
            tracing::warn!(
                shell = %shell_path.display(),
                "unrecognised shell — using suffix injection fallback (no shell integration)"
            );
        }
    }
    kind
}

// ─────────────────────────────────────────────────────────────────────────────

/// Spawn an interactive login shell for this profile (cwd + env from config). Idempotent.
fn spawn_shell_session(app: &AppHandle, state: &SharedState, profile_id: &str) -> Result<(), String> {
    let profile = state
        .config_snapshot()
        .profiles
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("unknown profile: {profile_id}"))?;

    {
        let guard = state.sessions.lock();
        if guard.contains_key(profile_id) {
            return Ok(());
        }
    }

    let shell_path = std::env::var_os("SHELL")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/bin/bash"));

    let (output_tx, _) = broadcast::channel::<Vec<u8>>(4096);
    let (ctl_tx, ctl_rx) = std::sync::mpsc::channel::<PtyCtl>();

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell_path);
    // Keep -l for zsh and fish (integration honours login semantics).
    // Bash drops -l because --rcfile only works for non-login interactive bash.
    // Other shells keep -l.
    cmd.arg("-l");

    // PTY output is rendered by xterm.js, so the terminal type is *always*
    // `xterm-256color` regardless of how LowCal itself was launched. Without
    // these defaults, an `.app` opened from Finder/Dock inherits launchd's
    // minimal env (no `TERM`, no `COLORTERM`), the login shell falls back to
    // `dumb`, and prompts/colors/keys behave oddly even though the PTY itself
    // is healthy. profile.env still overrides these via the loop below.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Wire shell integration. For bash, apply_shell_integration removes the -l
    // already added above and adds --rcfile instead.
    let shell_kind = apply_shell_integration(app, &shell_path, &mut cmd);
    if shell_kind == ShellKind::Bash {
        // Drop the -l we just added; apply_shell_integration added --rcfile.
        // portable-pty's CommandBuilder doesn't expose removal so we rebuild.
        cmd = CommandBuilder::new(&shell_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let _ = apply_shell_integration(app, &shell_path, &mut cmd);
    }

    if let Some(ref cwd) = profile.cwd {
        cmd.cwd(expand_path(cwd));
    }
    for (k, v) in &profile.env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let shell_pid = child
        .process_id()
        .map(|pid| pid as i32)
        .unwrap_or(-1);

    let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
    let child_arc: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>> =
        Arc::new(Mutex::new(Some(child)));

    // Created here (before the reader thread) so the reader can hold its own clone of
    // `last_exit_code` and update it the moment the APC marker arrives — typically
    // hundreds of ms before the watchdog flips `command_running` back to `false`.
    let command_running = Arc::new(AtomicBool::new(false));
    let watch_gate = Arc::new(parking_lot::Mutex::new(None));
    let started_via_ui = Arc::new(AtomicBool::new(false));
    let last_exit_code: Arc<parking_lot::Mutex<Option<i32>>> =
        Arc::new(parking_lot::Mutex::new(None));

    let master_reader = Arc::clone(&master);
    let output_reader = output_tx.clone();
    let app_reader = app.clone();
    let state_reader = Arc::clone(state);
    let id_reader = profile_id.to_string();
    let last_exit_code_reader = Arc::clone(&last_exit_code);
    std::thread::spawn(move || {
        let reader_result = { master_reader.lock().try_clone_reader() };
        let Ok(mut reader) = reader_result else {
            let rt_opt = state_reader.sessions.lock().remove(&id_reader);
            if let Some(rt) = rt_opt {
                dispose_runtime_quiet(rt);
            }
            emit_profiles(&app_reader, &state_reader);
            return;
        };
        let mut buf = [0u8; 8192];
        let mut scanner = ExitCodeScanner::new();
        let mut scrubber = InjectedEchoScrubber::new();
        let debug_bytes = lowcal_debug_bytes_enabled();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    if debug_bytes {
                        debug_writeln(&format!(
                            "pty_read  profile={} len={} raw={}",
                            id_reader, chunk.len(), escape_bytes_for_log(chunk)
                        ));
                    }
                    // Scrub the visible echo of the injected suffix (unknown-shell fallback
                    // only — known shells produce no suffix). For known shells the scrubber
                    // is effectively a passthrough since INJECTED_ECHO_SUFFIX is never sent.
                    let visible = scrubber.feed(chunk);
                    if debug_bytes {
                        debug_writeln(&format!(
                            "scrubber  profile={} forwarded={} fwd={}",
                            id_reader, visible.len(),
                            escape_bytes_for_log(&visible),
                        ));
                    }
                    if !visible.is_empty() {
                        let _ = output_reader.send(visible);
                    }
                    // Exit-code capture: OSC 133;D (shell integration, all known shells)
                    // or APC LOWCAL_RC= (suffix fallback for unknown shells). No
                    // command_running gate — we record the exit code unconditionally so
                    // the implementation stays simple. The red dot only shows when
                    // started_via_ui is also true, which is only set by Start.
                    if let Some(code) = scanner.feed(chunk) {
                        if debug_bytes {
                            debug_writeln(&format!(
                                "exit_code profile={} code={}", id_reader, code
                            ));
                        }
                        *last_exit_code_reader.lock() = Some(code);
                        emit_profiles(&app_reader, &state_reader);
                    }
                }
                Err(_) => break,
            }
        }
        // Reader loop exited (EOF or error). No more bytes will arrive, so any tail the
        // scrubber was holding back (in case it grew into a full signature) is by definition
        // *not* the start of a future signature — release it to the UI so we don't drop
        // legitimate trailing output of the user's command.
        let tail = scrubber.flush();
        if !tail.is_empty() {
            let _ = output_reader.send(tail);
        }
        let rt_opt = state_reader.sessions.lock().remove(&id_reader);
        // If `None`, teardown already ran (e.g. **Delete profile**) — do not emit `session-ended`
        // or the UI would call `ensure_shell_session` for a removed profile.
        if let Some(rt) = rt_opt {
            dispose_runtime_quiet(rt);
            let _ = app_reader.emit(
                "session-ended",
                serde_json::json!({ "profileId": id_reader.clone() }),
            );
            emit_profiles(&app_reader, &state_reader);
        }
    });

    let master_writer = Arc::clone(&master);
    std::thread::spawn(move || {
        let writer_result = { master_writer.lock().take_writer() };
        let Ok(mut writer) = writer_result else {
            return;
        };
        loop {
            match ctl_rx.recv() {
                Ok(PtyCtl::Stdin(data)) => {
                    use std::io::Write;
                    let _ = writer.write_all(&data);
                    let _ = writer.flush();
                }
                Ok(PtyCtl::Resize { cols, rows }) => {
                    let g = master_writer.lock();
                    let _ = g.resize(PtySize {
                        cols,
                        rows,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
                Err(_) => break,
            }
        }
    });

    #[cfg(unix)]
    spawn_command_watchdog(
        app.clone(),
        Arc::clone(state),
        profile_id.to_string(),
        Arc::clone(&master),
        shell_pid,
        Arc::clone(&command_running),
        Arc::clone(&watch_gate),
    );

    let runtime = SessionRuntime {
        ctl_tx,
        output: output_tx,
        child: Arc::clone(&child_arc),
        command_running,
        master,
        shell_pid,
        watch_gate,
        started_via_ui,
        last_exit_code,
        shell_kind,
    };

    state
        .sessions
        .lock()
        .insert(profile_id.to_string(), runtime);

    emit_profiles(app, state);
    Ok(())
}

fn ensure_shell_session_impl(app: &AppHandle, state: &SharedState, profile_id: &str) -> Result<(), String> {
    if !state
        .config_snapshot()
        .profiles
        .iter()
        .any(|p| p.id == profile_id)
    {
        return Ok(());
    }
    if state.sessions.lock().contains_key(profile_id) {
        return Ok(());
    }
    spawn_shell_session(app, state, profile_id)
}

/// RAII guard that registers a profile id in `state.startup_pending` while
/// `apply_startup_profile_actions` is mid-`start_profile_inner` and removes
/// it on drop — including the early-`?` and panic paths. The close-confirm
/// handler unions this set with `command_running == true` so the prompt
/// fires for `start_command_on_app_open` profiles whose injection hasn't
/// flipped `command_running` yet (the `wait_for_login_shell_ready` +
/// `wait_until_broadcast_receiver_idle` pipeline can take several seconds).
#[cfg(not(mobile))]
struct StartupPendingGuard<'a> {
    state: &'a SharedState,
    id: String,
}

#[cfg(not(mobile))]
impl<'a> StartupPendingGuard<'a> {
    fn new(state: &'a SharedState, id: String) -> Self {
        state.startup_pending.lock().insert(id.clone());
        Self { state, id }
    }
}

#[cfg(not(mobile))]
impl<'a> Drop for StartupPendingGuard<'a> {
    fn drop(&mut self) {
        self.state.startup_pending.lock().remove(&self.id);
    }
}

/// Warm idle shells and/or run saved commands for profiles configured for app launch (desktop).
#[cfg(not(mobile))]
fn apply_startup_profile_actions(app: &AppHandle, state: &SharedState) {
    let plan: Vec<(String, bool)> = {
        let cfg = state.config.read();
        cfg.profiles
            .iter()
            .map(|p| (p.id.clone(), p.start_command_on_app_open))
            .collect()
    };
    for (id, run_command) in plan {
        if run_command {
            // Hold a startup-pending entry for the entirety of `start_profile_inner`
            // (which runs the shell-ready + broadcast-idle waits before flipping
            // `command_running`). Dropped automatically on success / `Err` / panic.
            let _pending = StartupPendingGuard::new(state, id.clone());
            if let Err(e) = start_profile_inner(app, state, &id) {
                tracing::warn!(
                    error = %e,
                    profile_id = %id,
                    "start-command-on-app-open: failed"
                );
            }
        } else {
            if let Err(e) = ensure_shell_session_impl(app, state, &id) {
                tracing::warn!(
                    error = %e,
                    profile_id = %id,
                    "startup-warm: failed to spawn shell session"
                );
            }
        }
    }
}

/// POSIX-safe single-quoted form of `s`: wraps in `'...'` and escapes embedded `'` as
/// `'"'"'`. Used to splice an assigned cwd into the `cd '<cwd>' && <command>` prefix that
/// `inject_profile_command` lays down so Start always lands in the configured folder.
fn shell_single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\"'\"'");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

fn inject_profile_command(
    state: &SharedState,
    profile_id: &str,
    cwd: Option<&str>,
    command: &str,
) -> Result<(), String> {
    let (ctl_tx, shell_kind) = {
        let g = state.sessions.lock();
        let rt = g.get(profile_id)
            .ok_or_else(|| format!("no shell session for {profile_id}"))?;
        (rt.ctl_tx.clone(), rt.shell_kind)
    };

    let mut payload: Vec<u8> = vec![0x03, b'\r', b'\n'];
    // Prefix `cd '<assigned cwd>' && ` so Start always runs the saved command from the
    // configured folder — the PTY is interactive, so the user may have `cd`'d away
    // between Starts. `cd` to the same dir is a harmless no-op. If `cd` fails (folder
    // gone), `&&` short-circuits so the user's command does NOT run in the wrong place.
    // `~/` is expanded before quoting because a quoted `~` is treated literally by POSIX.
    if let Some(raw) = cwd {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let expanded = expand_path(trimmed);
            let quoted = shell_single_quote(&expanded.display().to_string());
            payload.extend_from_slice(b"cd ");
            payload.extend_from_slice(quoted.as_bytes());
            payload.extend_from_slice(b" && ");
        }
    }
    payload.extend_from_slice(command.as_bytes());

    // For known shells (bash/zsh/fish) the exit code is captured by the shell
    // integration hook (`precmd` / `PROMPT_COMMAND` / `fish_postexec`) which emits
    // OSC 133;D after every command. No suffix needed and no echo to scrub.
    //
    // For unknown shells (ksh, dash, tcsh, …) we fall back to the APC printf suffix.
    // The `InjectedEchoScrubber` in the reader thread strips its visible echo. This
    // works reliably for non-zsh shells because they lack autosuggestions plugins that
    // would interleave bytes between the echoed characters.
    if shell_kind == ShellKind::Other {
        payload.extend_from_slice(INJECTED_ECHO_SUFFIX);
    }

    payload.extend_from_slice(b"\r\n");
    if lowcal_debug_bytes_enabled() {
        debug_writeln(&format!(
            "inject    profile={} shell={:?} payload_len={} payload={}",
            profile_id, shell_kind, payload.len(), escape_bytes_for_log(&payload)
        ));
    }
    ctl_tx
        .send(PtyCtl::Stdin(payload))
        .map_err(|_| "PTY writer closed".into())
}

fn destroy_shell_session(app: &AppHandle, state: &SharedState, profile_id: &str) -> Result<(), String> {
    let rt = state.sessions.lock().remove(profile_id);
    if let Some(rt) = rt {
        dispose_runtime_quiet(rt);
        emit_profiles(app, state);
    }
    Ok(())
}

fn start_profile_inner(app: &AppHandle, state: &SharedState, id: &str) -> Result<(), String> {
    ensure_shell_session_impl(app, state, id)?;
    let (command, cwd) = state
        .config_snapshot()
        .profiles
        .iter()
        .find(|p| p.id == id)
        .map(|p| (p.command.clone(), p.cwd.clone()))
        .ok_or_else(|| format!("unknown profile: {id}"))?;

    // Auto-stop a still-running Start-injected command so a second Start is "Restart"-y
    // by default: send Ctrl+C (and a second one if the foreground job is sticky), clear
    // `command_running` / `started_via_ui` / `last_exit_code`. The PTY foreground
    // ownership and quiet-window waits below then proceed against the just-stopped
    // shell. `prepare_tty_for_saved_command` (further down) is still the backstop that
    // kills any non-shell foreground that ignores Ctrl+C, so non-Start manual jobs the
    // user typed in the PTY are also wiped before the saved command runs.
    let was_running = state
        .sessions
        .lock()
        .get(id)
        .map(|rt| rt.command_running.load(Ordering::SeqCst))
        .unwrap_or(false);
    if was_running {
        let snap = state.sessions.lock().get(id).map(|rt| {
            (
                rt.ctl_tx.clone(),
                Arc::clone(&rt.master),
                rt.shell_pid,
                Arc::clone(&rt.command_running),
                Arc::clone(&rt.watch_gate),
                Arc::clone(&rt.started_via_ui),
                Arc::clone(&rt.last_exit_code),
            )
        });
        if let Some((ctl_tx, master, shell_pid, running_flag, gate, started, exit_code)) = snap {
            stop_session_foreground_interrupt(
                &ctl_tx,
                &master,
                shell_pid,
                &running_flag,
                &gate,
                &started,
                &exit_code,
            );
            emit_profiles(app, state);
        }
    }

    let (master, shell_pid) = {
        let g = state.sessions.lock();
        let Some(rt) = g.get(id) else {
            return Err("shell session missing".into());
        };
        (Arc::clone(&rt.master), rt.shell_pid)
    };

    if !wait_for_login_shell_ready(&master, shell_pid, Duration::from_secs(30)) {
        tracing::warn!(
            profile_id = %id,
            "login shell did not become TTY-ready before injecting Start command; continuing anyway"
        );
    }

    let mut output_rx = {
        let g = state.sessions.lock();
        let Some(rt) = g.get(id) else {
            return Err("shell session missing".into());
        };
        rt.output.subscribe()
    };

    const SHELL_OUTPUT_IDLE: Duration = Duration::from_secs(1);
    const SHELL_OUTPUT_IDLE_MAX_WAIT: Duration = Duration::from_secs(45);
    match broadcast_idle::wait_until_broadcast_receiver_idle(
        &mut output_rx,
        SHELL_OUTPUT_IDLE,
        SHELL_OUTPUT_IDLE_MAX_WAIT,
        false,
    ) {
        Err(broadcast_idle::BroadcastIdleWaitError::ChannelClosed) => {
            tracing::warn!(
                profile_id = %id,
                "PTY output broadcast closed before idle wait completed"
            );
        }
        Ok(broadcast_idle::BroadcastIdleOutcome::MaxWaitElapsed {
            received_any_message,
        }) => {
            tracing::warn!(
                profile_id = %id,
                received_any = received_any_message,
                "shell PTY output did not stay quiet for {:?} before Start; continuing",
                SHELL_OUTPUT_IDLE
            );
        }
        Ok(broadcast_idle::BroadcastIdleOutcome::Stabilized) => {}
    }

    {
        let g = state.sessions.lock();
        let Some(rt) = g.get(id) else {
            return Err("shell session missing".into());
        };
        prepare_tty_for_saved_command(rt);
    }

    inject_profile_command(state, id, cwd.as_deref(), &command)?;

    if let Some(rt) = state.sessions.lock().get(id) {
        *rt.watch_gate.lock() = Some(Instant::now());
        // Clear before flipping `command_running` true so the UI never sees a stale
        // previous exit code lingering at the start of a fresh run. `started_via_ui`
        // covers both **Start** from the UI and `start_command_on_app_open` at app open
        // (both paths land here via `start_profile_inner`).
        *rt.last_exit_code.lock() = None;
        rt.started_via_ui.store(true, Ordering::SeqCst);
        rt.command_running.store(true, Ordering::SeqCst);
    }
    emit_profiles(app, state);
    Ok(())
}

fn stop_profile_inner(app: &AppHandle, state: &SharedState, id: &str) -> Result<(), String> {
    let snap = state.sessions.lock().get(id).map(|rt| {
        (
            rt.ctl_tx.clone(),
            Arc::clone(&rt.master),
            rt.shell_pid,
            Arc::clone(&rt.command_running),
            Arc::clone(&rt.watch_gate),
            Arc::clone(&rt.started_via_ui),
            Arc::clone(&rt.last_exit_code),
        )
    });
    let Some((ctl_tx, master, shell_pid, running_flag, gate, started, exit_code)) = snap else {
        return Ok(());
    };
    stop_session_foreground_interrupt(
        &ctl_tx,
        &master,
        shell_pid,
        &running_flag,
        &gate,
        &started,
        &exit_code,
    );
    emit_profiles(app, state);
    Ok(())
}

#[tauri::command]
fn get_ws_origin(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let port = state.ws_port();
    if port == 0 {
        return Err("websocket server not ready".into());
    }
    Ok(format!("ws://127.0.0.1:{port}"))
}

#[tauri::command]
fn list_profiles(state: tauri::State<'_, SharedState>) -> Result<Vec<ProfileDto>, String> {
    Ok(state.list_dtos())
}

#[tauri::command]
fn reload_config_disk(state: tauri::State<'_, SharedState>, app: AppHandle) -> Result<(), String> {
    state.reload_config()?;
    emit_profiles(&app, &state);
    Ok(())
}

// Lifecycle commands are async + spawn_blocking so the blocking inner functions
// (PTY waits, foreground signals, broadcast idle) run on the async runtime's
// blocking pool instead of Tauri's main thread. On macOS, blocking the main
// thread also stalls the WebView compositor, so the spinner state set by JS
// before `await invoke(...)` cannot become visible until the command returns.
fn join_blocking_result(join: tauri::Result<Result<(), String>>) -> Result<(), String> {
    match join {
        Ok(inner) => inner,
        Err(e) => Err(format!("background task failed: {e}")),
    }
}

#[tauri::command]
async fn ensure_shell_session(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || ensure_shell_session_impl(&app, &state, &id))
            .await,
    )
}

#[tauri::command]
async fn start_profile(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || start_profile_inner(&app, &state, &id)).await,
    )
}

#[tauri::command]
async fn stop_profile(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || stop_profile_inner(&app, &state, &id)).await,
    )
}

#[tauri::command]
async fn restart_profile(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || {
            stop_profile_inner(&app, &state, &id)?;
            start_profile_inner(&app, &state, &id)
        })
        .await,
    )
}

#[tauri::command]
async fn start_tag(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    tag: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || {
            let ids = state.profile_ids_for_tag(&tag);
            for id in ids {
                let skip = state
                    .sessions
                    .lock()
                    .get(&id)
                    .map(|rt| rt.command_running.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if skip {
                    continue;
                }
                let _ = start_profile_inner(&app, &state, &id);
            }
            Ok(())
        })
        .await,
    )
}

#[tauri::command]
async fn stop_tag(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    tag: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || {
            let ids = state.profile_ids_for_tag(&tag);
            for id in ids {
                let _ = stop_profile_inner(&app, &state, &id);
            }
            Ok(())
        })
        .await,
    )
}

#[tauri::command]
async fn restart_tag(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    tag: String,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || {
            let ids = state.profile_ids_for_tag(&tag);
            for id in ids {
                let _ = stop_profile_inner(&app, &state, &id);
                let _ = start_profile_inner(&app, &state, &id);
            }
            Ok(())
        })
        .await,
    )
}

#[tauri::command]
async fn stop_all(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
) -> Result<(), String> {
    let state: SharedState = state.inner().clone();
    join_blocking_result(
        tauri::async_runtime::spawn_blocking(move || {
            let snaps: Vec<_> = {
                let g = state.sessions.lock();
                g.values()
                    .map(|rt| {
                        (
                            rt.ctl_tx.clone(),
                            Arc::clone(&rt.master),
                            rt.shell_pid,
                            Arc::clone(&rt.command_running),
                            Arc::clone(&rt.watch_gate),
                            Arc::clone(&rt.started_via_ui),
                            Arc::clone(&rt.last_exit_code),
                        )
                    })
                    .collect()
            };
            for (ctl_tx, master, shell_pid, flag, gate, started, exit_code) in snaps {
                stop_session_foreground_interrupt(
                    &ctl_tx, &master, shell_pid, &flag, &gate, &started, &exit_code,
                );
            }
            emit_profiles(&app, &state);
            Ok(())
        })
        .await,
    )
}

#[tauri::command]
fn create_profile(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    input: ProfileSaveInput,
) -> Result<ProfileDto, String> {
    let (display_name, command, cwd, tags, env, start_command_on_app_open) =
        normalized_profile_body(input)?;

    let new_id = {
        let cfg = state.config.read();
        let existing: HashSet<String> = cfg.profiles.iter().map(|p| p.id.clone()).collect();
        let base = slug_from_display(&display_name);
        unique_profile_id(&base, &existing)
    };

    let profile = Profile {
        id: new_id.clone(),
        display_name,
        command,
        cwd,
        env,
        tags,
        start_command_on_app_open,
    };

    state.write_cfg(|cfg| {
        cfg.profiles.push(profile);
        Ok(())
    })?;

    #[cfg(not(mobile))]
    {
        if start_command_on_app_open {
            if let Err(e) = start_profile_inner(&app, &state, &new_id) {
                tracing::warn!(
                    error = %e,
                    profile_id = %new_id,
                    "start-command-on-app-open: failed after create"
                );
            }
        }
    }

    emit_profiles(&app, &state);

    state
        .list_dtos()
        .into_iter()
        .find(|d| d.id == new_id)
        .ok_or_else(|| "failed to read profile after create".into())
}

#[tauri::command]
fn update_profile(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    payload: UpdateProfilePayload,
) -> Result<(), String> {
    let id = payload.id;
    let (display_name, command, cwd, tags, env, start_command_on_app_open) =
        normalized_profile_body(payload.body)?;

    state.write_cfg(|cfg| {
        let p = cfg
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("unknown profile: {id}"))?;
        p.display_name = display_name;
        p.command = command;
        p.cwd = cwd;
        p.tags = tags;
        p.env = env;
        p.start_command_on_app_open = start_command_on_app_open;
        Ok(())
    })?;

    #[cfg(not(mobile))]
    {
        if start_command_on_app_open {
            if let Err(e) = start_profile_inner(&app, &state, &id) {
                tracing::warn!(
                    error = %e,
                    profile_id = %id,
                    "start-command-on-app-open: failed after update"
                );
            }
        }
    }

    emit_profiles(&app, &state);
    Ok(())
}

#[tauri::command]
fn delete_profile(state: tauri::State<'_, SharedState>, app: AppHandle, id: String) -> Result<(), String> {
    destroy_shell_session(&app, &state, &id)?;
    state.write_cfg(|cfg| {
        let pos = cfg
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| format!("unknown profile: {id}"))?;
        cfg.profiles.remove(pos);
        Ok(())
    })?;
    emit_profiles(&app, &state);
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsClientMsg {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsServerMsg {
    Output { data: String },
    #[allow(dead_code)]
    Closed { code: Option<i32> },
    Error { message: String },
}

async fn handle_socket(socket: WebSocket, state: SharedState, profile_id: String) {
    let session = {
        let g = state.sessions.lock();
        g.get(&profile_id).map(|s| (s.ctl_tx.clone(), s.output.subscribe()))
    };

    let Some((ctl_tx, mut rx)) = session else {
        let msg = serde_json::to_string(&WsServerMsg::Error {
            message: "session not running".into(),
        })
        .unwrap_or_else(|_| "{}".into());
        let mut socket = socket;
        let _ = socket.send(Message::Text(msg)).await;
        let _ = socket.close().await;
        return;
    };

    let (mut sink, mut stream) = socket.split();

    let send_half = async move {
        loop {
            match rx.recv().await {
                Ok(chunk) => {
                    let payload = serde_json::to_string(&WsServerMsg::Output {
                        data: base64::engine::general_purpose::STANDARD.encode(&chunk),
                    })
                    .unwrap_or_else(|_| "{}".into());
                    if sink.send(Message::Text(payload)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    let recv_half = async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    match serde_json::from_str::<WsClientMsg>(&t) {
                        Ok(WsClientMsg::Input { data }) => {
                            if let Ok(bytes) =
                                base64::engine::general_purpose::STANDARD.decode(data)
                            {
                                let _ = ctl_tx.send(PtyCtl::Stdin(bytes));
                            }
                        }
                        Ok(WsClientMsg::Resize { cols, rows }) => {
                            let _ = ctl_tx.send(PtyCtl::Resize { cols, rows });
                        }
                        Err(_) => {}
                    }
                }
                Ok(Message::Binary(bin)) => {
                    let _ = ctl_tx.send(PtyCtl::Stdin(bin));
                }
                Ok(Message::Ping(_)) => {}
                Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_)) => break,
                Err(_) => break,
            }
        }
    };

    let mut send_fut = Box::pin(send_half);
    let mut recv_fut = Box::pin(recv_half);
    tokio::select! {
        _ = send_fut.as_mut() => {},
        _ = recv_fut.as_mut() => {},
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumPath(profile_id): AxumPath<String>,
    State(state): State<SharedState>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, profile_id))
}

async fn run_axum(state: SharedState) {
    let app = Router::new()
        .route("/ws/:profile_id", get(ws_handler))
        .with_state(state.clone())
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind PTY bridge");
    let port = listener.local_addr().expect("local addr").port();
    state.set_ws_port(port);

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("axum serve");
}

fn init_stdio_tracing() {
    #[cfg(debug_assertions)]
    {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| {
                        "info"
                            .parse::<tracing_subscriber::EnvFilter>()
                            .expect("static default filter")
                    }),
            )
            .init();
        return;
    }

    #[cfg(not(debug_assertions))]
    if std::env::var_os("RUST_LOG").is_some() {
        if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
            tracing_subscriber::fmt().with_env_filter(filter).init();
        }
    }
}

/// macOS-only: install **File → New Terminal** (Cmd+T), a Preferences… entry
/// (Cmd+,), and a **custom** Quit entry (Cmd+Q) into the default Tauri menu.
/// Mutates `Menu::default(...)` in place rather than rebuilding the whole bar
/// so we don't have to maintain Edit / View / Window / Help submenus by hand.
///
/// **Why a custom Quit?** The default `PredefinedMenuItem::quit(...)` is wired
/// to NSApp's `terminate:` selector. `terminate:` calls
/// `applicationShouldTerminate:` on the delegate, but Tao's macOS delegate
/// (`tao::platform_impl::macos::app_delegate`) only implements
/// `applicationWillTerminate:` — by the time that fires the decision to exit
/// has already been made. The result is that `WindowEvent::CloseRequested` and
/// `RunEvent::ExitRequested` both *fail to fire* for Cmd+Q / native-menu
/// Quit, so any close-confirmation logic on those events is silently
/// bypassed. By attaching a custom item with id `"quit"` and accelerator
/// `CmdOrCtrl+Q`, Cmd+Q routes through `on_menu_event` instead, where we can
/// run the same close-confirm logic and only call `app.exit(0)` when the
/// user has confirmed.
///
/// The File → New Terminal click — and the system-routed Cmd+T accelerator —
/// emit an `open-new-terminal` event the frontend listens for; the in-WebView
/// keydown handler in `App.tsx` is the cross-platform fallback (and still
/// handles the secondary Cmd+= shortcut).
///
/// The Preferences click — and the system-routed Cmd+, accelerator — emit an
/// `open-settings` event the frontend already listens for; the in-WebView
/// keydown handler in `App.tsx` is the cross-platform fallback.
#[cfg(target_os = "macos")]
fn install_macos_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{
        Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
    };

    let handle = app.handle();
    let menu = Menu::default(handle)?;

    let new_terminal = MenuItemBuilder::with_id("new-terminal", "New Terminal")
        .accelerator("CmdOrCtrl+T")
        .build(handle)?;
    let file_sep = PredefinedMenuItem::separator(handle)?;

    if let Some(file_submenu) = menu.items()?.into_iter().find_map(|kind| {
        match kind {
            MenuItemKind::Submenu(sub)
                if sub
                    .text()
                    .ok()
                    .map(|t| t == "File")
                    .unwrap_or(false) =>
            {
                Some(sub)
            }
            _ => None,
        }
    }) {
        file_submenu.insert(&new_terminal, 0)?;
        file_submenu.insert(&file_sep, 1)?;
    }

    let prefs = MenuItemBuilder::with_id("preferences", "Preferences…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    let sep = PredefinedMenuItem::separator(handle)?;
    // Title mirrors the predefined Quit item (`format!("Quit {}", app_name())`
    // — see muda's macOS impl). Hard-coded "Lowcal" because the in-window UI
    // already uses the lowercase-c branding for everything user-facing.
    let custom_quit = MenuItemBuilder::with_id("quit", "Quit Lowcal")
        .accelerator("CmdOrCtrl+Q")
        .build(handle)?;

    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        // Position 1 is right after "About <app>" in the default macOS app menu.
        app_submenu.insert(&prefs, 1)?;
        app_submenu.insert(&sep, 2)?;

        // Locate and remove the predefined Quit item (whose `text()` starts
        // with "Quit "). Iterate from the end because Quit is conventionally
        // the last item in the App submenu on macOS — this is robust to any
        // future shuffle as long as Quit stays the last predefined entry.
        let removed_quit = {
            let items = app_submenu.items()?;
            items.into_iter().rev().find_map(|kind| match kind {
                MenuItemKind::Predefined(p)
                    if p.text()
                        .ok()
                        .map(|t| t.starts_with("Quit "))
                        .unwrap_or(false) =>
                {
                    Some(p)
                }
                _ => None,
            })
        };
        if let Some(quit) = removed_quit {
            // `remove` takes `&dyn IsMenuItem`; PredefinedMenuItem implements it.
            let _ = app_submenu.remove(&quit);
        }
        // Append our custom Quit at the end (where the predefined one was).
        app_submenu.append(&custom_quit)?;
    } else {
        // Defensive: if the default layout ever changes shape, just append so
        // Preferences and Quit are both reachable from the menu bar.
        let app_submenu = tauri::menu::SubmenuBuilder::new(handle, "App")
            .item(&prefs)
            .item(&custom_quit)
            .build()?;
        menu.append(&app_submenu)?;
    }

    menu.set_as_app_menu()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_stdio_tracing();

    // Write a startup marker to the debug log so it's unambiguous that the
    // process restarted. Includes PID + wall-clock seconds since epoch.
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let pid = std::process::id();
        debug_writeln(&format!("=== PROCESS START pid={pid} epoch_secs={secs} ==="));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "new-terminal" => {
                    // Frontend (App.tsx) listens for `open-new-terminal` and
                    // opens the create-profile modal — same code path as the
                    // sidebar + button and the in-WebView Cmd+T / Cmd+= fallback.
                    let _ = app.emit("open-new-terminal", ());
                }
                "preferences" => {
                    // Frontend (App.tsx) listens for `open-settings` and toggles
                    // the settings modal — same code path as the gear button and
                    // the in-WebView Cmd+, fallback.
                    let _ = app.emit("open-settings", ());
                }
                "quit" => {
                    // Custom Quit menu item (see `install_macos_app_menu`).
                    // Cmd+Q + native-menu Quit click both land here, so we can
                    // run the same close-confirm flow as the red traffic light
                    // (`on_window_event`) before actually exiting.
                    let state_arc: SharedState = match app.try_state::<SharedState>() {
                        Some(s) => s.inner().clone(),
                        None => {
                            app.exit(0);
                            return;
                        }
                    };
                    if state_arc.close_confirmed.load(Ordering::SeqCst) {
                        app.exit(0);
                        return;
                    }
                    let running = running_profile_names(&state_arc);
                    if running.is_empty() {
                        // Nothing to confirm — exit immediately via the standard
                        // Tauri exit path (same `app.exit(0)` the modal's OK
                        // button triggers on confirm).
                        app.exit(0);
                        return;
                    }
                    emit_quit_confirmation(app, running);
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            // Catches the red traffic light path (and any explicit
            // `window.close()`). On macOS, **Cmd+Q / native-menu Quit / dock
            // Quit** do NOT fire `CloseRequested` — they go through the
            // `terminate:` selector which Tauri surfaces as
            // `RunEvent::ExitRequested` at the app level. That route is
            // handled in the `app.run(...)` callback below.
            let tauri::WindowEvent::CloseRequested { api, .. } = event else { return; };
            if window.label() != "main" {
                return;
            }

            let app = window.app_handle().clone();
            let state_arc: SharedState = {
                let Some(state) = app.try_state::<SharedState>() else { return; };
                state.inner().clone()
            };
            if state_arc.close_confirmed.load(Ordering::SeqCst) {
                return;
            }

            let running = running_profile_names(&state_arc);
            if running.is_empty() {
                return;
            }

            api.prevent_close();
            emit_quit_confirmation(&app, running);
        })
        .setup(|app| {
            let config_dir = resolved_app_config_dir(app.handle())?;
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
            let config_path = config_dir.join("terminals.yaml");

            let state = Arc::new(AppStateInner::new(config_path.clone()).map_err(|e| e.to_string())?);
            let shared = Arc::clone(&state);
            app.manage(shared.clone());

            tauri::async_runtime::spawn(run_axum(shared.clone()));

            #[cfg(target_os = "macos")]
            {
                if let Err(e) = install_macos_app_menu(app) {
                    tracing::warn!("failed to install macOS app menu: {e}");
                }
            }

            #[cfg(not(mobile))]
            {
                let app_handle = app.handle().clone();
                let state_for_launch = Arc::clone(&shared);
                std::thread::spawn(move || {
                    apply_startup_profile_actions(&app_handle, &state_for_launch);
                });
                spawn_config_file_watcher(app.handle().clone(), Arc::clone(&state), config_path);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_ws_origin,
            ensure_shell_session,
            list_profiles,
            reload_config_disk,
            start_profile,
            stop_profile,
            restart_profile,
            start_tag,
            stop_tag,
            restart_tag,
            stop_all,
            create_profile,
            update_profile,
            delete_profile,
            resolve_working_directory,
            user_home_directory,
            confirm_quit_proceed,
            app_settings::get_app_settings,
            app_settings::set_app_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Cmd+Q / native-menu Quit / dock right-click → Quit / any other
            // `terminate:`-style exit on macOS surfaces here as
            // `RunEvent::ExitRequested` at the app level — it never visits
            // `WindowEvent::CloseRequested`, which is why the window-level
            // handler alone wasn't catching Cmd+Q. We mirror the same
            // confirm-on-running logic here.
            let tauri::RunEvent::ExitRequested { api, code, .. } = &event else { return; };
            // `code: Some(_)` means the exit was requested programmatically
            // (our own `app.exit(0)` after the user confirmed). Pass through
            // so we don't show a second dialog.
            if code.is_some() {
                return;
            }
            let state_arc: SharedState = {
                let Some(state) = app_handle.try_state::<SharedState>() else { return; };
                state.inner().clone()
            };
            if state_arc.close_confirmed.load(Ordering::SeqCst) {
                return;
            }
            let running = running_profile_names(&state_arc);
            if running.is_empty() {
                return;
            }
            api.prevent_exit();
            emit_quit_confirmation(app_handle, running);
        });
}
