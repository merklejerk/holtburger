use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use directories::ProjectDirs;
use holtburger_cli::ui::{
    self, AppState, ChatMessageKind, ChatState, NetStats, Page, SelectionState,
};
use holtburger_core::{Client, ClientCommand, ClientState, ClientViewEvent, RetryState};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::fs::File;
use std::io::{self, Write};
use std::sync::Mutex;
use std::time::Instant;
use tokio::sync::mpsc;

struct TuiLogger {
    tx: mpsc::UnboundedSender<holtburger_core::ClientViewEvent>,
    file: Option<Mutex<File>>,
    verbosity: u8,
}

impl log::Log for TuiLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        let level = metadata.level();
        let should_send_to_tui = match level {
            log::Level::Error => true,
            log::Level::Warn => self.verbosity >= 1,
            log::Level::Info => self.verbosity >= 2,
            log::Level::Debug => self.verbosity >= 3,
            log::Level::Trace => self.verbosity >= 4,
        };
        should_send_to_tui || self.file.is_some()
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            let log_msg = format!("[{}] {}", record.level(), record.args());

            if let Some(file_mutex) = &self.file
                && let Ok(mut file) = file_mutex.lock()
            {
                let _ = writeln!(file, "{}", log_msg);
                let _ = file.flush();
            }

            // Only send to TUI if verbose is high enough or it's a high level message
            let should_send = match record.level() {
                log::Level::Error => true,
                log::Level::Warn => self.verbosity >= 1,
                log::Level::Info => self.verbosity >= 2,
                log::Level::Debug => self.verbosity >= 3,
                log::Level::Trace => self.verbosity >= 4,
            };

            if should_send {
                let _ = self.tx.send(ClientViewEvent::LogMessage(log_msg));
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
#[command(author, version, about, long_about = None, disable_help_flag = true)]
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
    #[arg(short, long)]
    log: Option<String>,
    #[arg(long)]
    debug_log: Option<String>,
    #[arg(short, long, action = clap::ArgAction::Count)]
    verbose: u8,
    #[arg(short, long)]
    dats: Option<String>,
    #[arg(long, action = clap::ArgAction::Help)]
    help: Option<bool>,
}

#[tokio::main]
async fn main() -> Result<()> {
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

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

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
            tx: event_tx.clone(),
            file: log_file,
            verbosity: args.verbose,
        };
        log::set_boxed_logger(Box::new(logger)).ok();
        log::set_max_level(log::LevelFilter::Trace);
    }

    println!("Initializing HoltBurger client (parsing DAT files & connecting)...");
    let mut client = match Client::new(
        &host,
        port,
        &args.account,
        args.character.clone(),
        dats_path.clone(),
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to initialize client: {}", e);
            return Ok(());
        }
    };

    if let Some(mut capture_path) = args.capture.clone() {
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

    client.set_command_rx(command_rx);
    let mut view_event_rx = client.subscribe_client_view_events();

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app_state = AppState {
        account_name: args.account.clone(),
        account_password: args.password.clone(),
        page: Page::Selection(SelectionState::default()),
        modal: None,
        chat: ChatState::new(chat_log),
        input: String::new(),
        input_history: Vec::new(),
        history_index: None,
        logon_retry: RetryState::new(5),
        enter_retry: RetryState::new(5),
        core_state: ClientState::Connected,
        verbosity: args.verbose,
        net_stats: NetStats::default(),
        world_name: String::new(),
    };

    app_state.refresh_context_buffer();

    if args.verbose > 0 {
        app_state.chat.log(
            ChatMessageKind::System,
            format!("Verbosity level {} enabled.", args.verbose),
        );
    }

    let client_task_handle = tokio::spawn(async move {
        let _ = client.run().await;
    });

    let _ = command_tx.send(ClientCommand::Login(args.password.clone()));

    let mut last_tick = Instant::now();
    let tick_rate = std::time::Duration::from_millis(100);
    let frame_rate = std::time::Duration::from_millis(16); // ~60 FPS
    let mut last_draw = Instant::now();
    let mut needs_redraw = true;

    loop {
        // 1. Process Network Events (Drain batch)
        while let Ok(event) = event_rx.try_recv() {
            let res = app_state.handle_action(ui::AppAction::ReceivedViewEvent(event));
            needs_redraw |= res.needs_redraw;
            for cmd in res.commands {
                let _ = command_tx.send(cmd);
            }
        }

        while let Ok(event) = view_event_rx.try_recv() {
            let res = app_state.handle_action(ui::AppAction::ReceivedViewEvent(event));
            needs_redraw |= res.needs_redraw;
            for cmd in res.commands {
                let _ = command_tx.send(cmd);
            }
        }

        // 2. Poll Input (Short timeout, drain batch)
        let mut should_quit = false;
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

                        let size = terminal.size()?;
                        let (_, main_chunks, dynamic_chunk) = ui::get_layout(size);
                        let res = app_state.handle_action(ui::AppAction::KeyPress(
                            key,
                            size.width,
                            size.height,
                            main_chunks,
                            dynamic_chunk,
                        ));
                        needs_redraw |= res.needs_redraw;
                        for cmd in res.commands {
                            if let ClientCommand::Quit = cmd {
                                should_quit = true;
                            }
                            let _ = command_tx.send(cmd);
                        }
                    }
                    Event::Mouse(mouse) => {
                        let size = terminal.size()?;
                        let (chunks, main_chunks, dynamic_chunk) = ui::get_layout(size);
                        let res = app_state.handle_action(ui::AppAction::Mouse(
                            mouse,
                            chunks.to_vec(),
                            main_chunks.to_vec(),
                            dynamic_chunk,
                        ));
                        needs_redraw |= res.needs_redraw;
                        for cmd in res.commands {
                            let _ = command_tx.send(cmd);
                        }
                    }
                    _ => {}
                }
            }
        }
        if should_quit {
            break;
        }

        // 3. Tick
        let elapsed = last_tick.elapsed().as_secs_f64();
        if last_tick.elapsed() >= tick_rate {
            let res = app_state.handle_action(ui::AppAction::Tick(elapsed));
            needs_redraw |= res.needs_redraw;
            for cmd in res.commands {
                let _ = command_tx.send(cmd);
            }
            last_tick = Instant::now();
        }

        // 4. Draw (If needed and frame budget allows)
        if needs_redraw {
            let now = Instant::now();
            if now.duration_since(last_draw) >= frame_rate {
                terminal.draw(|f| ui::ui(f, &mut app_state))?;
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

    let _ = client_task_handle.await;
    Ok(())
}
