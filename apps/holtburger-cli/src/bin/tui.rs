use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use directories::ProjectDirs;
use holtburger_cli::pages;
use holtburger_cli::pages::selection::SelectionState;
use holtburger_cli::state::AppState;
use holtburger_cli::state::NetStats;
use holtburger_cli::types::{AppEvent, ChatMessageKind, Page};
use holtburger_core::{ClientBuilder, ClientCommand, ClientState, ClientViewEvent, ErrorReason};
use holtburger_protocol::errors::CharacterError;
use holtburger_world::BasicSpatialPhysics;
use holtburger_world::RuntimeBodyResetCause;
use ratatui::{Terminal, backend::CrosstermBackend};
use std::fs::File;
use std::io::{self, Write};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const PRE_WORLD_RETRY_DELAY: Duration = Duration::from_secs(3);

struct BootstrappedClient {
    server_cmd_tx: mpsc::UnboundedSender<ClientCommand>,
    server_event_rx: tokio::sync::broadcast::Receiver<ClientViewEvent>,
    client_task_handle: tokio::task::JoinHandle<Result<()>>,
    initial_events: Vec<ClientViewEvent>,
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
    kind: ChatMessageKind,
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
                    kind: ChatMessageKind::System,
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
    version,
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

fn classify_pre_world_error(reason: &ErrorReason, message: String) -> BootstrapEventOutcome {
    match reason {
        ErrorReason::Character(error) if is_retryable_pre_world_character_error(*error) => {
            BootstrapEventOutcome::Retry { message }
        }
        ErrorReason::Character(_) | ErrorReason::General(_) | ErrorReason::Weenie(_, _) => {
            BootstrapEventOutcome::Fatal { message }
        }
        ErrorReason::Transport(_) => BootstrapEventOutcome::Fatal { message },
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

fn apply_capture_path(client: &mut holtburger_core::Client, capture: Option<&String>) {
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
        ClientViewEvent::ErrorRaised {
            reason, message, ..
        } => Some(classify_pre_world_error(&reason, message)),
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
) -> BootstrapOutcome {
    match outcome {
        BootstrapEventOutcome::Ready { initial_events } => {
            BootstrapOutcome::Ready(BootstrappedClient {
                server_cmd_tx,
                server_event_rx,
                client_task_handle,
                initial_events,
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
    let mut client = ClientBuilder::new(args.account.clone())
        .server(host.to_string(), port)
        .dats_path(dats_path.to_path_buf())
        .spatial_physics(Arc::new(BasicSpatialPhysics))
        .connect()
        .await?;

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
                            ));
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = server_cmd_tx.send(ClientCommand::RequestInitialViewState);
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
        page: Page::Selection(SelectionState::default()),
        client_state: ClientState::Connected,
        verbosity: args.verbose,
        net_stats: NetStats::default(),
        world_name: String::new(),
        server_time: None,
        quit_on_disconnect: args.quit_on_disconnect,
        disconnect_reason: None,
        pending_exit_message: None,
    };

    if args.verbose > 0 {
        app_state.log(
            ChatMessageKind::System,
            format!("Verbosity level {} enabled.", args.verbose),
        );
    }

    let mut client_task_handle = Some(client_task_handle);

    let mut last_tick = Instant::now();
    let tick_rate = std::time::Duration::from_millis(100);
    let frame_rate = std::time::Duration::from_millis(16); // ~60 FPS
    let mut last_draw = Instant::now();
    let mut needs_redraw = true;

    let update_state = |res: holtburger_cli::types::UpdateResult,
                        needs_redraw: &mut bool,
                        server_cmd_tx: &mpsc::UnboundedSender<ClientCommand>,
                        should_quit: &mut bool| {
        *needs_redraw |= res.needs_redraw;
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
        update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
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

                if app_state.should_exit_on_disconnect() {
                    app_state.request_disconnect_exit();
                    should_quit |= app_state.has_pending_exit();
                } else {
                    app_state.client_state = ClientState::Disconnected;
                    app_state.log(
                        ChatMessageKind::Error,
                        app_state.current_disconnect_chat_message(),
                    );
                    needs_redraw = true;
                }
            }
        }

        // 1. Process Logger Events
        while let Ok(log) = local_log_rx.try_recv() {
            let res = app_state.handle_app_action(holtburger_cli::types::AppAction::Log {
                kind: log.kind,
                message: log.text,
            });
            update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
        }

        // 2. Process Network Events (Drain batch)
        loop {
            match server_event_rx.try_recv() {
                Ok(event) => {
                    let res = app_state.handle_app_event(AppEvent::ReceivedViewEvent(event));
                    update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
                    should_quit |= app_state.has_pending_exit();
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                    let reset = app_state.handle_app_event(AppEvent::ReceivedViewEvent(
                        ClientViewEvent::RuntimeBodiesReset {
                            cause: RuntimeBodyResetCause::Resync,
                        },
                    ));
                    update_state(reset, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
                    let _ = server_cmd_tx.send(ClientCommand::RequestInitialViewState);
                    break;
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Closed) => {
                    should_quit = true;
                    break;
                }
            }
        }

        // 3. Poll Input (Short timeout, drain batch)
        let poll_timeout = if needs_redraw {
            frame_rate.saturating_sub(last_draw.elapsed())
        } else {
            std::time::Duration::from_millis(10)
        };

        if event::poll(poll_timeout)? {
            while event::poll(std::time::Duration::from_millis(0))? {
                match event::read()? {
                    Event::Key(key) => {
                        if key.kind != KeyEventKind::Press {
                            continue;
                        }

                        let res = app_state.handle_app_event(AppEvent::KeyPress(key));
                        update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
                    }
                    Event::Mouse(mouse) => {
                        let res = app_state.handle_app_event(AppEvent::Mouse(mouse));
                        update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
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
            update_state(res, &mut needs_redraw, &server_cmd_tx, &mut should_quit);
            should_quit |= app_state.has_pending_exit();
            last_tick = Instant::now();
        }

        if should_quit {
            break;
        }

        // 4. Draw (If needed and frame budget allows)
        if needs_redraw {
            let now = Instant::now();
            if now.duration_since(last_draw) >= frame_rate {
                let size = terminal.size()?;
                app_state.page.update_layout(size.into());
                terminal.draw(|f| pages::render_app(f, &mut app_state))?;
                last_draw = now;
                needs_redraw = false;
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
    use holtburger_core::client::types::ErrorSource;

    #[test]
    fn debug_verbosity_requires_debug_log() {
        let result = Args::try_parse_from(["tui", "--account", "acct", "-V"]);

        assert!(result.is_err());
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
    fn retryable_pre_world_character_errors_are_classified_for_retry() {
        let outcome = process_bootstrap_event(
            ClientViewEvent::ErrorRaised {
                source: ErrorSource::Wire,
                reason: ErrorReason::Character(CharacterError::LogonServerFull),
                message: "Character error: LogonServerFull".to_string(),
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
            ClientViewEvent::ErrorRaised {
                source: ErrorSource::Wire,
                reason: ErrorReason::Character(CharacterError::AccountInvalid),
                message: "Character error: AccountInvalid".to_string(),
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
