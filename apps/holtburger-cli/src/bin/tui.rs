use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use directories::ProjectDirs;
use holtburger_cli::pages;
use holtburger_cli::state::{AppState, NetStats, QueuedScriptStartup};
use holtburger_cli::types::{AppEvent, ChatMessageTags, Page, RedrawPriority, UpdateResult};
use holtburger_cli::utils::format_action_result_message;
use holtburger_content::ContentRepository;
use holtburger_core::errors::is_actually_weenie_error;
use holtburger_core::{
    ActionResultReason, ClientCommand, ClientRuntime, ClientRuntimeBuilder, ClientState,
    ClientViewEvent,
};
use holtburger_dat::file_type::SkillTable;
use holtburger_protocol::errors::CharacterError;
use holtburger_scripting::{ScriptFetchAllowedHost, ScriptFetchPolicy, ScriptHostConfig};
use holtburger_world::BasicSpatialPhysics;
use holtburger_world::RuntimeBodyResetCause;
use holtburger_world::spell::SpellCatalog;
use ratatui::{Terminal, backend::CrosstermBackend};
use std::fs::File;
use std::io::{self, Write};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const PRE_WORLD_RETRY_DELAY: Duration = Duration::from_secs(3);
const DEFAULT_SCRIPT_FETCH_ALLOWED_HOST: &str = "localhost:9999";

struct BootstrappedClient {
    server_cmd_tx: mpsc::UnboundedSender<ClientCommand>,
    server_event_rx: tokio::sync::broadcast::Receiver<ClientViewEvent>,
    client_task_handle: tokio::task::JoinHandle<Result<()>>,
    initial_events: Vec<ClientViewEvent>,
    content: Arc<ContentRepository>,
    spell_catalog: Arc<SpellCatalog>,
    skill_table: Arc<SkillTable>,
}

enum BootstrapOutcome {
    Ready(BootstrappedClient),
    Retry { message: String },
    Fatal { message: String },
}

enum BootstrapEventOutcome {
    Ready {
        initial_events: Vec<ClientViewEvent>,
    },
    Retry {
        message: String,
    },
    Fatal {
        message: String,
    },
}

struct CapturedLog {
    chat_tags: ChatMessageTags,
    text: String,
}

struct TuiLogger {
    tx: mpsc::UnboundedSender<CapturedLog>,
    file: Option<Mutex<File>>,
    file_level: log::LevelFilter,
    verbosity: u8,
}

fn tui_level_filter(verbosity: u8) -> log::LevelFilter {
    match verbosity {
        0 => log::LevelFilter::Error,
        1 => log::LevelFilter::Warn,
        2 => log::LevelFilter::Info,
        3 => log::LevelFilter::Debug,
        _ => log::LevelFilter::Trace,
    }
}

fn debug_file_level_filter(verbosity: u8) -> log::LevelFilter {
    tui_level_filter(verbosity)
}

fn level_enabled(filter: log::LevelFilter, level: log::Level) -> bool {
    match filter {
        log::LevelFilter::Off => false,
        log::LevelFilter::Error => matches!(level, log::Level::Error),
        log::LevelFilter::Warn => matches!(level, log::Level::Error | log::Level::Warn),
        log::LevelFilter::Info => {
            matches!(
                level,
                log::Level::Error | log::Level::Warn | log::Level::Info
            )
        }
        log::LevelFilter::Debug => !matches!(level, log::Level::Trace),
        log::LevelFilter::Trace => true,
    }
}

fn max_level_filter(a: log::LevelFilter, b: log::LevelFilter) -> log::LevelFilter {
    use log::LevelFilter;

    fn rank(level: LevelFilter) -> u8 {
        match level {
            LevelFilter::Off => 0,
            LevelFilter::Error => 1,
            LevelFilter::Warn => 2,
            LevelFilter::Info => 3,
            LevelFilter::Debug => 4,
            LevelFilter::Trace => 5,
        }
    }

    if rank(a) >= rank(b) { a } else { b }
}

impl log::Log for TuiLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        let level = metadata.level();
        let should_send_to_tui = level_enabled(tui_level_filter(self.verbosity), level);
        let should_write_to_file = self.file.is_some() && level_enabled(self.file_level, level);
        should_send_to_tui || should_write_to_file
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            let log_msg = format!("[{}] {}", record.level(), record.args());

            if self.file.is_some()
                && level_enabled(self.file_level, record.level())
                && let Some(file_mutex) = &self.file
                && let Ok(mut file) = file_mutex.lock()
            {
                let _ = writeln!(file, "{}", log_msg);
                let _ = file.flush();
            }

            // Only send to TUI if verbose is high enough or it's a high level message
            let should_send = level_enabled(tui_level_filter(self.verbosity), record.level());

            if should_send {
                let _ = self.tx.send(CapturedLog {
                    chat_tags: ChatMessageTags::system(),
                    text: log_msg,
                });
            }
        }
    }

    fn flush(&self) {
        if let Some(file_mutex) = &self.file
            && let Ok(mut file) = file_mutex.lock()
        {
            let _ = file.flush();
        }
    }
}

#[derive(Parser, Debug)]
#[command(
    author,
    version = holtburger_cli::version::BUILD_VERSION,
    about,
    long_about = None,
    disable_help_flag = true,
    disable_version_flag = true
)]
struct Args {
    #[arg(short, long)]
    server: Option<String>,
    #[arg(short = 'h', long, default_value = "127.0.0.1")]
    host: String,
    #[arg(short, long, default_value_t = 9000)]
    port: u16,
    #[arg(short, long)]
    account: String,
    #[arg(short = 'P', long, default_value = "")]
    password: String,
    #[arg(short, long)]
    character: Option<String>,
    #[arg(
        long,
        value_name = "SCRIPT_NAME",
        help = "Queue a script to start as soon as the client is ready"
    )]
    run: Option<String>,
    #[arg(
        long = "run-args",
        value_name = "SCRIPT_ARGS",
        requires = "run",
        help = "Arguments passed to the queued script's Started lifecycle event"
    )]
    run_args: Option<String>,
    #[arg(long)]
    capture: Option<String>,
    #[arg(short, long, help = "Write chat and in-game system messages to a file")]
    log: Option<String>,
    #[arg(long, help = "Write Rust log output to a debug log file")]
    debug_log: Option<String>,
    #[arg(short, long, action = clap::ArgAction::Count, help = "Increase log messages shown inside the TUI (-v warn, -vv info, -vvv debug, -vvvv trace)")]
    verbose: u8,
    #[arg(short = 'V', long = "debug-verbose", action = clap::ArgAction::Count, requires = "debug_log", help = "Increase log messages written to --debug-log (-V warn, -VV info, -VVV debug, -VVVV trace)")]
    debug_verbosity: u8,
    #[arg(short, long)]
    dats: Option<String>,
    #[arg(
        short = 'Q',
        long = "auto-quit",
        help = "Exit the TUI immediately when the client disconnects"
    )]
    quit_on_disconnect: bool,
    #[arg(
        long = "script-fetch-allow-host",
        value_name = "HOST:PORT|http(s)://HOST[:PORT]",
        value_parser = parse_script_fetch_allowed_host,
        help = "Allow HB.postJson to call an exact host and port; repeat to allow multiple hosts. Accepts HOST:PORT or http(s)://HOST[:PORT]."
    )]
    script_fetch_allow_host: Vec<ScriptFetchAllowedHost>,
    #[arg(
        long = "script-fetch-timeout-ms",
        value_name = "MILLISECONDS",
        default_value_t = ScriptFetchPolicy::DEFAULT_TIMEOUT_MS,
        value_parser = parse_script_fetch_timeout_ms,
        help = "Default timeout for HB.postJson requests in milliseconds"
    )]
    script_fetch_timeout_ms: u64,
    #[arg(
        long = "script-fetch-max-response-bytes",
        value_name = "BYTES",
        default_value_t = ScriptFetchPolicy::DEFAULT_MAX_RESPONSE_BYTES,
        value_parser = parse_script_fetch_max_response_bytes,
        help = "Maximum HB.postJson response body size in bytes"
    )]
    script_fetch_max_response_bytes: usize,
    #[arg(long, action = clap::ArgAction::Help)]
    help: Option<bool>,
    #[arg(long, action = clap::ArgAction::Version)]
    version: Option<bool>,
}

fn is_retryable_pre_world_character_error(error: CharacterError) -> bool {
    matches!(
        error,
        CharacterError::Logon
            | CharacterError::ServerDown1
            | CharacterError::ServerCrash1
            | CharacterError::ServerCrash2
            | CharacterError::EnterGameCharacterInWorld
            | CharacterError::EnterGameCharacterInWorldServer
            | CharacterError::EnterGameStartServerDown
            | CharacterError::EnterGameCharacterLocked
            | CharacterError::LogonServerFull
    )
}

fn classify_pre_world_action_result(reason: &ActionResultReason) -> Option<BootstrapEventOutcome> {
    let message = format_action_result_message(reason);

    match reason {
        ActionResultReason::Character(error) if is_retryable_pre_world_character_error(*error) => {
            Some(BootstrapEventOutcome::Retry { message })
        }
        ActionResultReason::Character(_) | ActionResultReason::General(_) => {
            Some(BootstrapEventOutcome::Fatal { message })
        }
        ActionResultReason::InventoryServerSaveFailed { .. } => {
            Some(BootstrapEventOutcome::Fatal { message })
        }
        ActionResultReason::Weenie(error, _) if is_actually_weenie_error(*error) => {
            Some(BootstrapEventOutcome::Fatal { message })
        }
        ActionResultReason::Weenie(_, _) => None,
        ActionResultReason::Transport(_) => Some(BootstrapEventOutcome::Fatal { message }),
    }
}

fn format_boot_account_message(reason: &str) -> String {
    if reason.trim().is_empty() {
        "Booted from server.".to_string()
    } else {
        format!("Booted from server: {}", reason)
    }
}

fn clear_captured_logs(local_log_rx: &mut mpsc::UnboundedReceiver<CapturedLog>) {
    while local_log_rx.try_recv().is_ok() {}
}

fn parse_script_fetch_allowed_host(
    raw: &str,
) -> std::result::Result<ScriptFetchAllowedHost, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("script fetch host cannot be empty".to_string());
    }

    if trimmed.contains("://") {
        let parsed = reqwest::Url::parse(trimmed).map_err(|_| {
            "script fetch host must be HOST:PORT or http(s)://HOST[:PORT]".to_string()
        })?;
        let default_port = match parsed.scheme() {
            "http" => 80,
            "https" => 443,
            _ => {
                return Err(
                    "script fetch host must use http or https when a scheme is present".to_string(),
                );
            }
        };

        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("script fetch host must not include user info".to_string());
        }

        let host = parsed
            .host_str()
            .ok_or_else(|| "script fetch host must include a hostname".to_string())?;
        let port = parsed.port().unwrap_or(default_port);

        return Ok(ScriptFetchAllowedHost::new(host, port));
    }

    let (host, port) = trimmed
        .rsplit_once(':')
        .ok_or_else(|| "script fetch host must be in HOST:PORT form".to_string())?;
    if host.trim().is_empty() {
        return Err("script fetch host must include a hostname".to_string());
    }

    let port = port
        .parse::<u16>()
        .map_err(|_| format!("invalid script fetch port in {trimmed}"))?;

    Ok(ScriptFetchAllowedHost::new(host, port))
}

fn parse_script_fetch_timeout_ms(raw: &str) -> std::result::Result<u64, String> {
    let value = raw
        .parse::<u64>()
        .map_err(|_| format!("invalid script fetch timeout: {raw}"))?;
    if value == 0 {
        return Err("script fetch timeout must be greater than zero".to_string());
    }

    Ok(value)
}

fn parse_script_fetch_max_response_bytes(raw: &str) -> std::result::Result<usize, String> {
    let value = raw
        .parse::<usize>()
        .map_err(|_| format!("invalid script fetch max response size: {raw}"))?;
    if value == 0 {
        return Err("script fetch max response size must be greater than zero".to_string());
    }

    Ok(value)
}

fn default_script_fetch_allowed_hosts() -> Vec<ScriptFetchAllowedHost> {
    vec![
        parse_script_fetch_allowed_host(DEFAULT_SCRIPT_FETCH_ALLOWED_HOST)
            .expect("default script fetch host should parse"),
    ]
}

fn script_host_config_from_args(args: &Args) -> ScriptHostConfig {
    let allowed_hosts = if args.script_fetch_allow_host.is_empty() {
        default_script_fetch_allowed_hosts()
    } else {
        args.script_fetch_allow_host.clone()
    };

    ScriptHostConfig {
        fetch_policy: ScriptFetchPolicy {
            allowed_hosts,
            timeout_ms: args.script_fetch_timeout_ms,
            max_response_bytes: args.script_fetch_max_response_bytes,
        },
    }
}

fn queued_script_startup_from_args(args: &Args) -> Option<QueuedScriptStartup> {
    let basename = args.run.as_ref()?;
    let script_args = args
        .run_args
        .as_deref()
        .unwrap_or_default()
        .trim_start()
        .to_string();

    Some(QueuedScriptStartup::new(basename.clone(), script_args))
}

#[derive(Default)]
struct PendingRedraw {
    immediate: bool,
    motion: bool,
}

impl PendingRedraw {
    fn request(&mut self, priority: RedrawPriority) {
        match priority {
            RedrawPriority::None => {}
            RedrawPriority::Motion => self.motion = true,
            RedrawPriority::Immediate => self.immediate = true,
        }
    }

    fn any(&self) -> bool {
        self.immediate || self.motion
    }

    fn priority(&self) -> RedrawPriority {
        if self.immediate {
            RedrawPriority::Immediate
        } else if self.motion {
            RedrawPriority::Motion
        } else {
            RedrawPriority::None
        }
    }

    fn clear(&mut self) {
        self.immediate = false;
        self.motion = false;
    }
}

fn apply_capture_path(client: &mut ClientRuntime, capture: Option<&String>) {
    let Some(mut capture_path) = capture.cloned() else {
        return;
    };

    let caps_dir = std::path::Path::new("caps");
    if !caps_dir.exists() {
        let _ = std::fs::create_dir_all(caps_dir);
    }

    let path = std::path::Path::new(&capture_path);
    if path.parent() == Some(std::path::Path::new("")) {
        capture_path = format!("caps/{}", capture_path);
    }

    let _ = client.session.set_capture(&capture_path);
}

fn bootstrap_ready_events(
    latest_status: &Option<ClientState>,
    latest_world_name: &Option<String>,
    latest_server_time: &Option<f64>,
    characters: Vec<holtburger_protocol::messages::CharacterEntry>,
) -> Vec<ClientViewEvent> {
    let mut initial_events = Vec::new();

    if let Some(state) = latest_status.clone() {
        initial_events.push(ClientViewEvent::StatusUpdate { state });
    }

    if let Some(name) = latest_world_name.clone() {
        initial_events.push(ClientViewEvent::WorldNameUpdated(name));
    }

    if let Some(time) = latest_server_time {
        initial_events.push(ClientViewEvent::ServerTimeUpdated { time: *time });
    }

    initial_events.push(ClientViewEvent::CharacterList(characters));
    initial_events
}

fn process_bootstrap_event(
    event: ClientViewEvent,
    latest_status: &mut Option<ClientState>,
    latest_world_name: &mut Option<String>,
    latest_server_time: &mut Option<f64>,
) -> Option<BootstrapEventOutcome> {
    match event {
        ClientViewEvent::StatusUpdate { state } => {
            *latest_status = Some(state);
            None
        }
        ClientViewEvent::WorldNameUpdated(name) => {
            *latest_world_name = Some(name);
            None
        }
        ClientViewEvent::ServerTimeUpdated { time } => {
            *latest_server_time = Some(time);
            None
        }
        ClientViewEvent::CharacterList(characters) => Some(BootstrapEventOutcome::Ready {
            initial_events: bootstrap_ready_events(
                latest_status,
                latest_world_name,
                latest_server_time,
                characters,
            ),
        }),
        ClientViewEvent::ActionResult { reason, .. } => classify_pre_world_action_result(&reason),
        ClientViewEvent::BootAccount(reason) => Some(BootstrapEventOutcome::Fatal {
            message: format_boot_account_message(&reason),
        }),
        ClientViewEvent::Disconnected => Some(BootstrapEventOutcome::Fatal {
            message: AppState::DEFAULT_DISCONNECT_MESSAGE.to_string(),
        }),
        _ => None,
    }
}

fn finalize_bootstrap_outcome(
    outcome: BootstrapEventOutcome,
    server_cmd_tx: mpsc::UnboundedSender<ClientCommand>,
    server_event_rx: tokio::sync::broadcast::Receiver<ClientViewEvent>,
    client_task_handle: tokio::task::JoinHandle<Result<()>>,
    content: Arc<ContentRepository>,
    spell_catalog: Arc<SpellCatalog>,
    skill_table: Arc<SkillTable>,
) -> BootstrapOutcome {
    match outcome {
        BootstrapEventOutcome::Ready { initial_events } => {
            BootstrapOutcome::Ready(BootstrappedClient {
                server_cmd_tx,
                server_event_rx,
                client_task_handle,
                initial_events,
                content,
                spell_catalog,
                skill_table,
            })
        }
        BootstrapEventOutcome::Retry { message } => BootstrapOutcome::Retry { message },
        BootstrapEventOutcome::Fatal { message } => BootstrapOutcome::Fatal { message },
    }
}

async fn bootstrap_once(
    args: &Args,
    host: &str,
    port: u16,
    dats_path: &std::path::Path,
) -> Result<BootstrapOutcome> {
    let content = Arc::new(if dats_path.is_dir() {
        ContentRepository::from_hba_dir(dats_path)?
    } else {
        ContentRepository::from_hba_path(dats_path)?
    });
    let mut builder = ClientRuntimeBuilder::new(args.account.clone())
        .server(host.to_string(), port)
        .spatial_physics(Arc::new(BasicSpatialPhysics));
    builder.load_assets(content.as_ref())?;

    let mut client = builder.connect().await?;
    let spell_catalog = Arc::clone(&client.world.spell_catalog);
    let skill_table = Arc::clone(&client.world.skill_table);

    apply_capture_path(&mut client, args.capture.as_ref());

    let (server_cmd_tx, server_cmd_rx) = mpsc::unbounded_channel();
    client.set_command_rx(server_cmd_rx);
    let mut server_event_rx = client.subscribe_client_view_events();
    let mut client_task_handle = tokio::spawn(async move { client.run().await });

    let _ = server_cmd_tx.send(ClientCommand::RequestInitialViewState);
    let _ = server_cmd_tx.send(ClientCommand::Login(args.password.clone()));

    let mut latest_status = Some(ClientState::Connected);
    let mut latest_world_name = None;
    let mut latest_server_time = None;
    let mut requested_initial_view_state = false;

    loop {
        tokio::select! {
            result = &mut client_task_handle => {
                let client_result = match result {
                    Ok(inner) => inner,
                    Err(error) => Err(anyhow::anyhow!("Client task failed: {}", error)),
                };

                while let Ok(event) = server_event_rx.try_recv() {
                    if let Some(outcome) = process_bootstrap_event(
                        event,
                        &mut latest_status,
                        &mut latest_world_name,
                        &mut latest_server_time,
                    ) {
                        return Ok(finalize_bootstrap_outcome(
                            outcome,
                            server_cmd_tx,
                            server_event_rx,
                            client_task_handle,
                            Arc::clone(&content),
                            Arc::clone(&spell_catalog),
                            Arc::clone(&skill_table),
                        ));
                    }
                }

                return Ok(match client_result {
                    Ok(()) => BootstrapOutcome::Fatal {
                        message: "Disconnected before receiving character list.".to_string(),
                    },
                    Err(error) => BootstrapOutcome::Fatal {
                        message: error.to_string(),
                    },
                });
            }
            event = server_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        requested_initial_view_state = false;
                        if let Some(outcome) = process_bootstrap_event(
                            event,
                            &mut latest_status,
                            &mut latest_world_name,
                            &mut latest_server_time,
                        ) {
                            return Ok(finalize_bootstrap_outcome(
                                outcome,
                                server_cmd_tx,
                                server_event_rx,
                                client_task_handle,
                                Arc::clone(&content),
                                Arc::clone(&spell_catalog),
                                Arc::clone(&skill_table),
                            ));
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if !requested_initial_view_state {
                            requested_initial_view_state = true;
                            let _ = server_cmd_tx.send(ClientCommand::RequestInitialViewState);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        return Ok(BootstrapOutcome::Fatal {
                            message: "Client event stream closed before receiving character list.".to_string(),
                        });
                    }
                }
            }
        }
    }
}

async fn bootstrap_client(
    args: &Args,
    host: &str,
    port: u16,
    dats_path: &std::path::Path,
    local_log_rx: &mut mpsc::UnboundedReceiver<CapturedLog>,
) -> Result<BootstrappedClient> {
    let mut attempt = 1usize;

    loop {
        println!("Initializing HoltBurger client (parsing DAT files & connecting)...");

        match bootstrap_once(args, host, port, dats_path).await? {
            BootstrapOutcome::Ready(ready) => return Ok(ready),
            BootstrapOutcome::Retry { message } => {
                eprintln!(
                    "{} Retrying in {} seconds (attempt {}).",
                    message,
                    PRE_WORLD_RETRY_DELAY.as_secs(),
                    attempt + 1
                );
                clear_captured_logs(local_log_rx);
                tokio::time::sleep(PRE_WORLD_RETRY_DELAY).await;
                attempt += 1;
            }
            BootstrapOutcome::Fatal { message } => anyhow::bail!(message),
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}", error);
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<()> {
    let args = Args::parse();

    let (host, port) = if let Some(server) = &args.server {
        if let Some((h, p)) = server.split_once(':') {
            (
                h.to_string(),
                p.parse::<u16>().unwrap_or_else(|_| {
                    eprintln!(
                        "Invalid port in server string, using default: {}",
                        args.port
                    );
                    args.port
                }),
            )
        } else {
            (server.clone(), args.port)
        }
    } else {
        (args.host.clone(), args.port)
    };

    let dats_path = args
        .dats
        .clone()
        .or_else(|| std::env::var("HOLTBURGER_DATS").ok())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            // Priority:
            // 1. Current directory ./dats (typical for portable/zip installs)
            // 2. Standard project data directory (typical for system installs)
            let local_dats = std::path::PathBuf::from("./dats");
            if local_dats.exists() {
                return local_dats;
            }

            ProjectDirs::from("io.github", "merklejerk", "holtburger")
                .map(|dirs| dirs.data_dir().join("dats"))
                .unwrap_or_else(|| local_dats)
        });

    let (local_log_tx, mut local_log_rx) = mpsc::unbounded_channel::<CapturedLog>();

    let chat_log = if let Some(path) = &args.log {
        match File::create(path) {
            Ok(f) => Some(Mutex::new(f)),
            Err(e) => {
                eprintln!("Failed to create chat log file: {}", e);
                None
            }
        }
    } else {
        None
    };

    if args.verbose > 0 || args.debug_log.is_some() {
        let file_level = if args.debug_log.is_some() {
            debug_file_level_filter(args.debug_verbosity)
        } else {
            log::LevelFilter::Off
        };
        let log_file = if let Some(path) = &args.debug_log {
            match File::create(path) {
                Ok(f) => Some(Mutex::new(f)),
                Err(e) => {
                    eprintln!("Failed to create debug log file: {}", e);
                    None
                }
            }
        } else {
            None
        };

        let logger = TuiLogger {
            tx: local_log_tx.clone(),
            file: log_file,
            file_level,
            verbosity: args.verbose,
        };
        log::set_boxed_logger(Box::new(logger)).ok();
        log::set_max_level(max_level_filter(tui_level_filter(args.verbose), file_level));
    }

    let BootstrappedClient {
        server_cmd_tx,
        mut server_event_rx,
        client_task_handle,
        initial_events,
        content,
        spell_catalog,
        skill_table,
    } = match bootstrap_client(&args, &host, port, &dats_path, &mut local_log_rx).await {
        Ok(ready) => ready,
        Err(e) => {
            eprintln!("Failed to initialize client: {}", e);
            return Ok(());
        }
    };

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app_state = AppState {
        account_name: args.account.clone(),
        account_password: args.password.clone(),
        character_preference: args.character.clone(),
        chat_log,
        page: Page::Selection(Box::default()),
        client_state: ClientState::Connected,
        verbosity: args.verbose,
        net_stats: NetStats::default(),
        world_name: String::new(),
        server_time: None,
        content: Some(content),
        spell_catalog: Some(spell_catalog),
        skill_table: Some(skill_table),
        quit_on_disconnect: args.quit_on_disconnect,
        disconnect_reason: None,
        pending_exit_message: None,
        queued_script_startup: queued_script_startup_from_args(&args),
        script_host_config: script_host_config_from_args(&args),
    };

    if args.verbose > 0 {
        app_state.log(
            ChatMessageTags::system(),
            format!("Verbosity level {} enabled.", args.verbose),
        );
    }

    let mut client_task_handle = Some(client_task_handle);

    let mut last_tick = Instant::now();
    let tick_rate = std::time::Duration::from_millis(100);
    let immediate_frame_rate = std::time::Duration::from_millis(1000 / 24);
    let motion_frame_rate = std::time::Duration::from_millis(1000);
    let event_poll_interval = std::time::Duration::from_millis(1000 / 30);
    let mut last_draw = Instant::now();
    let mut pending_redraw = PendingRedraw {
        immediate: true,
        motion: false,
    };
    let mut requested_initial_view_state = false;

    let update_state = |res: UpdateResult,
                        pending_redraw: &mut PendingRedraw,
                        server_cmd_tx: &mpsc::UnboundedSender<ClientCommand>,
                        should_quit: &mut bool| {
        pending_redraw.request(res.effective_redraw_priority());
        for cmd in res.commands {
            if let ClientCommand::Quit = cmd {
                *should_quit = true;
            }
            let _ = server_cmd_tx.send(cmd);
        }
    };

    for event in initial_events {
        let res = app_state.handle_app_event(AppEvent::ReceivedViewEvent(event));
        let mut should_quit = false;
        update_state(res, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
        if should_quit {
            break;
        }
    }

    loop {
        let mut should_quit = false;

        if client_task_handle
            .as_ref()
            .is_some_and(|handle| handle.is_finished())
        {
            let handle = client_task_handle
                .take()
                .expect("finished client task should still be present");
            let client_result = match handle.await {
                Ok(result) => result,
                Err(error) => Err(anyhow::anyhow!("Client task failed: {}", error)),
            };

            if let Err(error) = client_result {
                let message = error.to_string();
                if app_state.disconnect_reason.is_none() {
                    app_state.remember_disconnect_reason(message.clone());
                }

                app_state.log(ChatMessageTags::error(), format!("[!] {}", message));

                if app_state.should_exit_on_disconnect() {
                    app_state.request_disconnect_exit();
                    should_quit |= app_state.has_pending_exit();
                } else {
                    app_state.client_state = ClientState::Disconnected;
                    app_state.log(
                        ChatMessageTags::error(),
                        app_state.current_disconnect_chat_message(),
                    );
                    pending_redraw.request(RedrawPriority::Immediate);
                }
            }
        }

        // 1. Process Logger Events
        while let Ok(log) = local_log_rx.try_recv() {
            app_state.capture_log(log.chat_tags, log.text);
            pending_redraw.request(RedrawPriority::Immediate);
        }

        // 2. Process Network Events (Drain batch)
        loop {
            match server_event_rx.try_recv() {
                Ok(event) => {
                    requested_initial_view_state = false;

                    let res = app_state.handle_app_event(AppEvent::ReceivedViewEvent(event));
                    update_state(res, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
                    should_quit |= app_state.has_pending_exit();
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                    let reset = app_state.handle_app_event(AppEvent::ReceivedViewEvent(
                        ClientViewEvent::RuntimeBodiesReset {
                            cause: RuntimeBodyResetCause::Resync,
                        },
                    ));
                    update_state(reset, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
                    if !requested_initial_view_state {
                        requested_initial_view_state = true;
                        let _ = server_cmd_tx.send(ClientCommand::RequestInitialViewState);
                    }
                    break;
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Closed) => {
                    should_quit = true;
                    break;
                }
            }
        }

        // 3. Poll Input
        // Keep frontend-owned state updates responsive regardless of draw throttling.
        // Only the actual draw call is rate-limited.
        let poll_timeout = event_poll_interval.min(tick_rate.saturating_sub(last_tick.elapsed()));

        if event::poll(poll_timeout)? {
            while event::poll(std::time::Duration::from_millis(0))? {
                match event::read()? {
                    Event::Key(key) => {
                        if key.kind != KeyEventKind::Press {
                            continue;
                        }

                        let res = app_state.handle_app_event(AppEvent::KeyPress(key));
                        update_state(res, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
                    }
                    Event::Mouse(mouse) => {
                        let res = app_state.handle_app_event(AppEvent::Mouse(mouse));
                        update_state(res, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
                    }
                    _ => {}
                }
            }
        }
        if should_quit {
            break;
        }

        // 4. Tick
        let elapsed = last_tick.elapsed().as_secs_f64();
        if last_tick.elapsed() >= tick_rate {
            let res = app_state.handle_app_event(AppEvent::Tick(elapsed));
            update_state(res, &mut pending_redraw, &server_cmd_tx, &mut should_quit);
            should_quit |= app_state.has_pending_exit();
            last_tick = Instant::now();
        }

        if should_quit {
            break;
        }

        // 4. Draw (If needed and frame budget allows)
        if pending_redraw.any() {
            let now = Instant::now();
            let frame_rate = match pending_redraw.priority() {
                RedrawPriority::Immediate => immediate_frame_rate,
                RedrawPriority::Motion => motion_frame_rate,
                RedrawPriority::None => event_poll_interval,
            };
            if now.duration_since(last_draw) >= frame_rate {
                let size = terminal.size()?;
                app_state.page.update_layout(size.into());
                terminal.draw(|f| pages::render_app(f, &mut app_state))?;
                last_draw = now;
                pending_redraw.clear();
            }
        }
    }

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    let pending_exit_message = app_state.take_pending_exit_message();
    if let Some(message) = pending_exit_message {
        if let Some(handle) = client_task_handle.take() {
            handle.abort();
        }
        anyhow::bail!(message);
    }

    if let Some(handle) = client_task_handle {
        let client_result = match handle.await {
            Ok(result) => result,
            Err(error) => Err(anyhow::anyhow!("Client task failed: {}", error)),
        };

        client_result?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use clap::error::ErrorKind;
    use holtburger_core::client::types::ActionResultSource;

    #[test]
    fn debug_verbosity_requires_debug_log() {
        let result = Args::try_parse_from(["tui", "--account", "acct", "-V"]);

        assert!(result.is_err());
    }

    #[test]
    fn version_flag_parses_and_exits() {
        let error = Args::try_parse_from(["tui", "--version"])
            .expect_err("--version should short-circuit parsing");

        assert_eq!(error.kind(), ErrorKind::DisplayVersion);
    }

    #[test]
    fn debug_verbosity_parses_and_maps() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--debug-log",
            "debug.log",
            "-VV",
        ])
        .expect("debug log args should parse");

        assert_eq!(args.debug_verbosity, 2);
        assert_eq!(
            debug_file_level_filter(args.debug_verbosity),
            log::LevelFilter::Info
        );
    }

    #[test]
    fn global_max_level_keeps_file_and_tui_thresholds() {
        assert_eq!(
            max_level_filter(log::LevelFilter::Warn, log::LevelFilter::Debug),
            log::LevelFilter::Debug
        );
        assert_eq!(
            max_level_filter(log::LevelFilter::Trace, log::LevelFilter::Info),
            log::LevelFilter::Trace
        );
    }

    #[test]
    fn zero_verbosity_still_includes_errors() {
        assert_eq!(tui_level_filter(0), log::LevelFilter::Error);
        assert!(level_enabled(log::LevelFilter::Error, log::Level::Error));
        assert!(!level_enabled(log::LevelFilter::Error, log::Level::Warn));
    }

    #[test]
    fn quit_on_disconnect_flag_parses() {
        let args = Args::try_parse_from(["tui", "--account", "acct", "--auto-quit"])
            .expect("auto-quit args should parse");

        assert!(args.quit_on_disconnect);
    }

    #[test]
    fn run_flags_parse_and_seed_queued_script_startup() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--run",
            "fighter",
            "--run-args",
            "pick up loot",
        ])
        .expect("run args should parse");

        assert_eq!(args.run.as_deref(), Some("fighter"));
        assert_eq!(args.run_args.as_deref(), Some("pick up loot"));

        let queued = queued_script_startup_from_args(&args).expect("queued startup should exist");
        assert_eq!(queued.basename, "fighter");
        assert_eq!(queued.args, "pick up loot");
    }

    #[test]
    fn script_fetch_policy_defaults_to_localhost_9999() {
        let args = Args::try_parse_from(["tui", "--account", "acct"])
            .expect("default script fetch args should parse");

        let config = script_host_config_from_args(&args);

        assert_eq!(
            config.fetch_policy.allowed_hosts,
            vec![ScriptFetchAllowedHost::new("localhost", 9999)]
        );
        assert_eq!(
            config.fetch_policy.timeout_ms,
            ScriptFetchPolicy::DEFAULT_TIMEOUT_MS
        );
        assert_eq!(
            config.fetch_policy.max_response_bytes,
            ScriptFetchPolicy::DEFAULT_MAX_RESPONSE_BYTES
        );
    }

    #[test]
    fn script_fetch_policy_overrides_default_hosts_and_limits() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--script-fetch-allow-host",
            "https://example.com",
            "--script-fetch-allow-host",
            "localhost:8080",
            "--script-fetch-timeout-ms",
            "2500",
            "--script-fetch-max-response-bytes",
            "8192",
        ])
        .expect("script fetch override args should parse");

        let config = script_host_config_from_args(&args);

        assert_eq!(
            config.fetch_policy.allowed_hosts,
            vec![
                ScriptFetchAllowedHost::new("example.com", 443),
                ScriptFetchAllowedHost::new("localhost", 8080),
            ]
        );
        assert_eq!(config.fetch_policy.timeout_ms, 2500);
        assert_eq!(config.fetch_policy.max_response_bytes, 8192);
    }

    #[test]
    fn script_fetch_policy_accepts_http_scheme_with_default_port() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--script-fetch-allow-host",
            "http://example.org",
        ])
        .expect("http allow-host args should parse");

        let config = script_host_config_from_args(&args);

        assert_eq!(
            config.fetch_policy.allowed_hosts,
            vec![ScriptFetchAllowedHost::new("example.org", 80)]
        );
    }

    #[test]
    fn script_fetch_policy_accepts_https_ipv6_authority() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--script-fetch-allow-host",
            "https://[::1]:8443/path",
        ])
        .expect("ipv6 allow-host args should parse");

        let config = script_host_config_from_args(&args);

        assert_eq!(
            config.fetch_policy.allowed_hosts,
            vec![ScriptFetchAllowedHost::new("::1", 8443)]
        );
    }

    #[test]
    fn script_fetch_policy_rejects_url_user_info() {
        let args = Args::try_parse_from([
            "tui",
            "--account",
            "acct",
            "--script-fetch-allow-host",
            "https://user@example.org",
        ]);

        assert!(args.is_err());
    }

    #[test]
    fn retryable_pre_world_character_errors_are_classified_for_retry() {
        let outcome = process_bootstrap_event(
            ClientViewEvent::ActionResult {
                source: ActionResultSource::Wire,
                reason: ActionResultReason::Character(CharacterError::LogonServerFull),
            },
            &mut Some(ClientState::Connected),
            &mut None,
            &mut None,
        );

        assert!(matches!(outcome, Some(BootstrapEventOutcome::Retry { .. })));
    }

    #[test]
    fn fatal_pre_world_character_errors_do_not_retry() {
        let outcome = process_bootstrap_event(
            ClientViewEvent::ActionResult {
                source: ActionResultSource::Wire,
                reason: ActionResultReason::Character(CharacterError::AccountInvalid),
            },
            &mut Some(ClientState::Connected),
            &mut None,
            &mut None,
        );

        assert!(matches!(outcome, Some(BootstrapEventOutcome::Fatal { .. })));
    }

    #[test]
    fn bootstrap_preserves_server_time_before_character_list() {
        let mut latest_status = Some(ClientState::Connected);
        let mut latest_world_name = Some("ACEmulator".to_string());
        let mut latest_server_time = None;

        let outcome = process_bootstrap_event(
            ClientViewEvent::ServerTimeUpdated { time: 1234.5 },
            &mut latest_status,
            &mut latest_world_name,
            &mut latest_server_time,
        );

        assert!(outcome.is_none());
        assert_eq!(latest_server_time, Some(1234.5));

        let outcome = process_bootstrap_event(
            ClientViewEvent::CharacterList(Vec::new()),
            &mut latest_status,
            &mut latest_world_name,
            &mut latest_server_time,
        );

        let Some(BootstrapEventOutcome::Ready { initial_events }) = outcome else {
            panic!("expected bootstrap ready outcome");
        };

        assert!(initial_events.iter().any(|event| matches!(
            event,
            ClientViewEvent::ServerTimeUpdated { time } if *time == 1234.5
        )));
    }

    #[test]
    fn boot_account_message_uses_default_when_reason_empty() {
        assert_eq!(format_boot_account_message(""), "Booted from server.");
    }
}
