use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use holtburger_cli::ui::{self, AppState, ChatMessageKind};
use holtburger_core::{Client, ClientCommand, ClientEvent, ClientState};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::fs::File;
use std::io::{self, Write};
use std::sync::Mutex;
use std::time::Instant;
use tokio::sync::mpsc;

struct TuiLogger {
    tx: mpsc::UnboundedSender<ClientEvent>,
    file: Option<Mutex<File>>,
    verbosity: u8,
}

impl log::Log for TuiLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Trace
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
                log::Level::Error | log::Level::Warn => true,
                log::Level::Info => self.verbosity >= 2,
                log::Level::Debug => self.verbosity >= 3,
                log::Level::Trace => self.verbosity >= 4,
            };

            if should_send {
                let _ = self.tx.send(ClientEvent::LogMessage(log_msg));
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
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,
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
    #[arg(long)]
    no_emojis: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

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

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut client = Client::new(
        &args.server,
        args.port,
        &args.account,
        args.character.clone(),
    )
    .await?;

    if let Some(mut capture_path) = args.capture {
        // Ensure caps directory exists
        let caps_dir = std::path::Path::new("caps");
        if !caps_dir.exists() {
            std::fs::create_dir_all(caps_dir)?;
        }

        // If it's just a filename, put it in caps/
        let path = std::path::Path::new(&capture_path);
        if path.parent() == Some(std::path::Path::new("")) {
            capture_path = format!("caps/{}", capture_path);
        }

        client.session.set_capture(&capture_path)?;
    }
    client.set_event_tx(event_tx);
    client.set_command_rx(command_rx);

    let mut app_state = AppState {
        account_name: args.account.clone(),
        character_name: None,
        player_guid: None,
        attributes: std::collections::HashMap::new(),
        vitals: std::collections::HashMap::new(),
        skills: std::collections::HashMap::new(),
        messages: Vec::new(),
        input: String::new(),
        input_history: Vec::new(),
        history_index: None,
        characters: Vec::new(),
        state: ui::UIState::Chat,
        focused_pane: ui::FocusedPane::Dashboard,
        previous_focused_pane: ui::FocusedPane::Dashboard,
        selected_character_index: 0,
        selected_dashboard_index: 0,
        dashboard_list_state: ratatui::widgets::ListState::default().with_selected(Some(0)),
        last_dashboard_height: 0,
        scroll_offset: 0,
        chat_total_lines: 0,
        chat_last_total_lines: 0,
        context_total_lines: 0,
        context_last_total_lines: 0,
        dashboard_tab: ui::DashboardTab::Entities,
        context_buffer: Vec::new(),
        context_scroll_offset: 0,
        context_view: ui::ContextView::Default,
        account_password: args.password.clone(),
        logon_retry: holtburger_core::RetryState::new(5),
        enter_retry: holtburger_core::RetryState::new(5),
        core_state: ClientState::Connected,
        player_pos: None,
        player_enchantments: Vec::new(),
        entities: std::collections::HashMap::new(),
        inventory_entities: std::collections::HashMap::new(),
        server_time: None,
        chat_log,
        use_emojis: !args.no_emojis,
        verbosity: args.verbose,
    };

    app_state.refresh_context_buffer();

    if args.verbose > 0 {
        app_state.log_chat(
            ChatMessageKind::System,
            format!("Verbosity level {} enabled.", args.verbose),
        );
    }

    let _ = command_tx.send(ClientCommand::Login(args.password.clone()));
    let client_handle = tokio::spawn(async move {
        let _ = client.run().await;
    });

    let mut last_tick = Instant::now();
    loop {
        let elapsed = last_tick.elapsed().as_secs_f64();
        last_tick = Instant::now();

        let actions = app_state.handle_action(ui::AppAction::Tick(elapsed));
        for action in actions {
            let _ = command_tx.send(action);
        }

        terminal.draw(|f| ui::ui(f, &mut app_state))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(key) => {
                    let size = terminal.size()?;
                    let (_, main_chunks) = ui::get_layout(size);
                    let actions = app_state.handle_action(ui::AppAction::KeyPress(
                        key,
                        size.width,
                        size.height,
                        main_chunks,
                    ));
                    let mut should_quit = false;
                    for action in actions {
                        if let ClientCommand::Quit = action {
                            should_quit = true;
                        }
                        let _ = command_tx.send(action);
                    }
                    if should_quit {
                        break;
                    }
                }
                Event::Mouse(mouse) => {
                    let size = terminal.size()?;
                    let (chunks, main_chunks) = ui::get_layout(size);
                    let actions = app_state.handle_action(ui::AppAction::Mouse(
                        mouse,
                        chunks.to_vec(),
                        main_chunks.to_vec(),
                    ));
                    for action in actions {
                        let _ = command_tx.send(action);
                    }
                }
                _ => {}
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            match &event {
                ClientEvent::CharacterList(_)
                | ClientEvent::PlayerEntered { .. }
                | ClientEvent::StatusUpdate { .. } => {
                    if args.verbose >= 2 {
                        log::info!("ClientEvent: {:?}", event);
                    }
                }
                ClientEvent::World(world_event) => {
                    if args.verbose >= 2 {
                        log::info!("WorldEvent: {:?}", world_event);
                    }
                }
                ClientEvent::GameMessage(msg) => {
                    if args.verbose >= 3 {
                        log::debug!("GameMessage: {:?}", msg);
                    }
                }
                ClientEvent::RawMessage(data) => {
                    if args.verbose >= 4 {
                        log::trace!("RawPacket ({} bytes): {:02X?}", data.len(), data);
                    }
                }
                _ => {}
            }

            app_state.handle_action(ui::AppAction::ReceivedEvent(event));
        }
    }

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    let _ = client_handle.await;
    Ok(())
}
