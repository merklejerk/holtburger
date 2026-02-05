use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, MouseButton, MouseEventKind,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use holtburger_cli::actions::{self, ActionHandler, ActionTarget};
use holtburger_cli::ui::{self, AppState};
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
        metadata.level() <= log::Level::Debug
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
                log::Level::Error | log::Level::Warn | log::Level::Info => true,
                log::Level::Debug => self.verbosity >= 4,
                log::Level::Trace => self.verbosity >= 5,
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
    debug_file: Option<String>,
    #[arg(short, long, action = clap::ArgAction::Count)]
    verbose: u8,
    #[arg(long)]
    no_emojis: bool,
}

fn refresh_context_buffer(state: &mut AppState) {
    if state.context_view == ui::ContextView::Custom {
        return;
    }
    state.context_buffer.clear();
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    let debug_file = if let Some(path) = &args.debug_file {
        match File::create(path) {
            Ok(f) => Some(Mutex::new(f)),
            Err(e) => {
                eprintln!("Failed to create debug file: {}", e);
                None
            }
        }
    } else {
        None
    };

    if args.verbose > 0 || args.log.is_some() {
        let log_file = if let Some(path) = &args.log {
            match File::create(path) {
                Ok(f) => Some(Mutex::new(f)),
                Err(e) => {
                    eprintln!("Failed to create log file: {}", e);
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
        log::set_max_level(log::LevelFilter::Debug);
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
        attributes: Vec::new(),
        vitals: Vec::new(),
        skills: Vec::new(),
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
        context_total_lines: 0,
        dashboard_tab: ui::DashboardTab::Entities,
        context_buffer: Vec::new(),
        context_scroll_offset: 0,
        context_view: ui::ContextView::Default,
        logon_retry: None,
        enter_retry: None,
        core_state: ClientState::Connected,
        player_pos: None,
        player_enchantments: Vec::new(),
        entities: std::collections::HashMap::new(),
        server_time: None,
        use_emojis: !args.no_emojis,
        chat_cache: Vec::new(),
        last_rendered_width: 0,
    };

    refresh_context_buffer(&mut app_state);

    if args.verbose > 0 {
        app_state.messages.push(holtburger_core::ChatMessage {
            kind: holtburger_core::MessageKind::System,
            text: format!("Verbosity level {} enabled.", args.verbose),
        });
    }

    let password = args.password.clone();
    let client_handle = tokio::spawn(async move {
        let _ = client.run(&password).await;
    });

    let mut last_tick = Instant::now();
    loop {
        let elapsed = last_tick.elapsed().as_secs_f64();
        last_tick = Instant::now();

        // Clamp dashboard selection index before drawing
        let dashboard_count = app_state.dashboard_item_count();
        if app_state.selected_dashboard_index >= dashboard_count && dashboard_count > 0 {
            app_state.selected_dashboard_index = dashboard_count - 1;
        } else if dashboard_count == 0 {
            app_state.selected_dashboard_index = 0;
        }

        // Proactive enchantment purge
        app_state.player_enchantments.retain(|e| {
            if e.duration < 0.0 {
                return true;
            }
            let expires_at = e.start_time + e.duration;
            expires_at > 0.0
        });

        // Update enchantment timers locally (interpolate)
        // Since the server decrements start_time by roughly heartbeatInterval every ~5s,
        // we can simulate this by decrementing locally.
        for enchant in &mut app_state.player_enchantments {
            if enchant.duration >= 0.0 {
                enchant.start_time -= elapsed;
            }
        }

        terminal.draw(|f| ui::ui(f, &mut app_state))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(key) => {
                    if key
                        .modifiers
                        .contains(crossterm::event::KeyModifiers::CONTROL)
                    {
                        match key.code {
                            KeyCode::Char('q') | KeyCode::Char('Q') => {
                                let _ = command_tx.send(ClientCommand::Quit);
                                break;
                            }
                            _ => {}
                        }
                    }

                    match key.code {
                        KeyCode::Tab | KeyCode::BackTab => {
                            let width = terminal.size()?.width;
                            if key
                                .modifiers
                                .contains(crossterm::event::KeyModifiers::CONTROL)
                                || key.code == KeyCode::BackTab
                            {
                                // Cycle back
                                app_state.focused_pane =
                                    ui::get_prev_pane(app_state.focused_pane, width);
                            } else {
                                // Cycle forward
                                app_state.focused_pane =
                                    ui::get_next_pane(app_state.focused_pane, width);
                            }
                        }
                        KeyCode::Esc => {
                            if app_state.focused_pane == ui::FocusedPane::Input {
                                app_state.focused_pane = app_state.previous_focused_pane;
                            } else if app_state.state == ui::UIState::CharacterSelection {
                                app_state.state = ui::UIState::Chat;
                            }
                        }
                        KeyCode::Enter => match app_state.state {
                            ui::UIState::Chat => {
                                if app_state.focused_pane == ui::FocusedPane::Input {
                                    let input = app_state.input.drain(..).collect::<String>();
                                    if input.is_empty() {
                                        app_state.focused_pane = app_state.previous_focused_pane;
                                        continue;
                                    }
                                    if input == "/quit" || input == "/exit" {
                                        let _ = command_tx.send(ClientCommand::Quit);
                                        break;
                                    }
                                    app_state.input_history.push(input.clone());
                                    app_state.history_index = None;
                                    let _ = command_tx.send(ClientCommand::Talk(input));
                                    app_state.focused_pane = app_state.previous_focused_pane;
                                } else {
                                    app_state.previous_focused_pane = app_state.focused_pane;
                                    app_state.focused_pane = ui::FocusedPane::Input;
                                }
                            }
                            ui::UIState::CharacterSelection => {
                                if !app_state.characters.is_empty() {
                                    let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(
                                        app_state.selected_character_index + 1,
                                    ));
                                    app_state.state = ui::UIState::Chat;
                                }
                            }
                        },
                        KeyCode::Char(c) => {
                            if let ui::UIState::Chat = app_state.state {
                                match app_state.focused_pane {
                                    ui::FocusedPane::Input => {
                                        app_state.input.push(c);
                                    }
                                    ui::FocusedPane::Dashboard => {
                                        match c {
                                            '1' => {
                                                app_state.dashboard_tab =
                                                    ui::DashboardTab::Entities;
                                                app_state.selected_dashboard_index = 0;
                                                continue;
                                            }
                                            '2' => {
                                                app_state.dashboard_tab =
                                                    ui::DashboardTab::Inventory;
                                                app_state.selected_dashboard_index = 0;
                                                continue;
                                            }
                                            '3' => {
                                                app_state.dashboard_tab =
                                                    ui::DashboardTab::Character;
                                                app_state.selected_dashboard_index = 0;
                                                continue;
                                            }
                                            '4' => {
                                                app_state.dashboard_tab = ui::DashboardTab::Effects;
                                                app_state.selected_dashboard_index = 0;
                                                continue;
                                            }
                                            'x' | 'X' => {
                                                app_state.context_view = ui::ContextView::Default;
                                                refresh_context_buffer(&mut app_state);
                                                continue;
                                            }
                                            _ => {}
                                        }

                                        let mut command_to_send = None;
                                        let mut debug_to_show = None;

                                        {
                                            let target = match app_state.dashboard_tab {
                                                ui::DashboardTab::Entities
                                                | ui::DashboardTab::Inventory => {
                                                    let entities =
                                                        app_state.get_filtered_nearby_tab();
                                                    entities
                                                        .get(app_state.selected_dashboard_index)
                                                        .map(|(e, _, _)| ActionTarget::Entity(e))
                                                        .unwrap_or(ActionTarget::None)
                                                }
                                                ui::DashboardTab::Effects => {
                                                    let enchants =
                                                        app_state.get_effects_list_enchantments();
                                                    enchants
                                                        .get(app_state.selected_dashboard_index)
                                                        .map(|(e, _)| ActionTarget::Enchantment(e))
                                                        .unwrap_or(ActionTarget::None)
                                                }
                                                ui::DashboardTab::Character => ActionTarget::None,
                                            };

                                            let actions = actions::get_actions_for_target(
                                                &target,
                                                &app_state.entities,
                                                app_state.player_guid,
                                            );
                                            if let Some(handler) = actions
                                                .iter()
                                                .find(|a| {
                                                    a.shortcut_char() == c.to_ascii_lowercase()
                                                })
                                                .and_then(|action| {
                                                    action.handler(&target, app_state.player_guid)
                                                })
                                            {
                                                match handler {
                                                    ActionHandler::Command(cmd) => {
                                                        command_to_send = Some(cmd);
                                                    }
                                                    ActionHandler::ToggleDebug => {
                                                        debug_to_show =
                                                            Some(actions::get_debug_info(
                                                                &target,
                                                                |id| {
                                                                    app_state
                                                                        .entities
                                                                        .get(&id)
                                                                        .map(|e| e.name.clone())
                                                                        .or_else(|| {
                                                                            if Some(id)
                                                                                == app_state
                                                                                    .player_guid
                                                                            {
                                                                                Some(
                                                                                    "You"
                                                                                        .to_string(
                                                                                        ),
                                                                                )
                                                                            } else {
                                                                                None
                                                                            }
                                                                        })
                                                                },
                                                            ));
                                                    }
                                                }
                                            }
                                        }

                                        if let Some(cmd) = command_to_send {
                                            let _ = command_tx.send(cmd);
                                        }
                                        if let Some(lines) = debug_to_show {
                                            app_state.context_view = ui::ContextView::Custom;
                                            app_state.context_buffer = lines;
                                            app_state.context_scroll_offset = 0;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        KeyCode::Backspace => {
                            if app_state.state == ui::UIState::Chat
                                && app_state.focused_pane == ui::FocusedPane::Input
                            {
                                app_state.input.pop();
                            }
                        }
                        KeyCode::Up => match app_state.state {
                            ui::UIState::Chat => match app_state.focused_pane {
                                ui::FocusedPane::Input => {
                                    if !app_state.input_history.is_empty() {
                                        let idx = app_state
                                            .history_index
                                            .map(|i| i.saturating_sub(1))
                                            .unwrap_or(app_state.input_history.len() - 1);
                                        app_state.history_index = Some(idx);
                                        app_state.input = app_state.input_history[idx].clone();
                                    }
                                }
                                ui::FocusedPane::Chat => {
                                    app_state.scroll_offset =
                                        app_state.scroll_offset.saturating_add(1);
                                }
                                ui::FocusedPane::Context => {
                                    app_state.context_scroll_offset =
                                        app_state.context_scroll_offset.saturating_add(1);
                                }
                                ui::FocusedPane::Dashboard => {
                                    if app_state.selected_dashboard_index > 0 {
                                        app_state.selected_dashboard_index -= 1;
                                    }
                                }
                            },
                            ui::UIState::CharacterSelection => {
                                if app_state.selected_character_index > 0 {
                                    app_state.selected_character_index -= 1;
                                }
                            }
                        },
                        KeyCode::Down => match app_state.state {
                            ui::UIState::Chat => match app_state.focused_pane {
                                ui::FocusedPane::Input => {
                                    if let Some(idx) = app_state.history_index {
                                        if idx + 1 < app_state.input_history.len() {
                                            let next = idx + 1;
                                            app_state.history_index = Some(next);
                                            app_state.input = app_state.input_history[next].clone();
                                        } else {
                                            app_state.history_index = None;
                                            app_state.input.clear();
                                        }
                                    }
                                }
                                ui::FocusedPane::Chat => {
                                    app_state.scroll_offset =
                                        app_state.scroll_offset.saturating_sub(1);
                                }
                                ui::FocusedPane::Context => {
                                    app_state.context_scroll_offset =
                                        app_state.context_scroll_offset.saturating_sub(1);
                                }
                                ui::FocusedPane::Dashboard => {
                                    let dashboard_count = app_state.dashboard_item_count();
                                    if dashboard_count > 0
                                        && app_state.selected_dashboard_index + 1 < dashboard_count
                                    {
                                        app_state.selected_dashboard_index += 1;
                                    }
                                }
                            },
                            ui::UIState::CharacterSelection => {
                                if !app_state.characters.is_empty()
                                    && app_state.selected_character_index + 1
                                        < app_state.characters.len()
                                {
                                    app_state.selected_character_index += 1;
                                }
                            }
                        },
                        KeyCode::PageUp => {
                            if let ui::UIState::Chat = app_state.state {
                                let (_, main_chunks) = ui::get_layout(terminal.size()?);
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => {
                                        let h = main_chunks[1].height.saturating_sub(2) as usize;
                                        let step = (h / 2) + 1;
                                        app_state.scroll_offset =
                                            app_state.scroll_offset.saturating_add(step);
                                    }
                                    ui::FocusedPane::Context => {
                                        let h = main_chunks[2].height.saturating_sub(2) as usize;
                                        let step = (h / 2) + 1;
                                        app_state.context_scroll_offset =
                                            app_state.context_scroll_offset.saturating_add(step);
                                    }
                                    ui::FocusedPane::Dashboard => {
                                        let h = app_state.last_dashboard_height;
                                        let step = (h / 2) + 1;
                                        app_state.selected_dashboard_index = app_state
                                            .selected_dashboard_index
                                            .saturating_sub(step);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        KeyCode::PageDown => {
                            if let ui::UIState::Chat = app_state.state {
                                let (_, main_chunks) = ui::get_layout(terminal.size()?);
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => {
                                        let h = main_chunks[1].height.saturating_sub(2) as usize;
                                        let step = (h / 2) + 1;
                                        app_state.scroll_offset =
                                            app_state.scroll_offset.saturating_sub(step);
                                    }
                                    ui::FocusedPane::Context => {
                                        let h = main_chunks[2].height.saturating_sub(2) as usize;
                                        let step = (h / 2) + 1;
                                        app_state.context_scroll_offset =
                                            app_state.context_scroll_offset.saturating_sub(step);
                                    }
                                    ui::FocusedPane::Dashboard => {
                                        let dashboard_count = app_state.dashboard_item_count();
                                        let h = app_state.last_dashboard_height;
                                        let step = (h / 2) + 1;
                                        app_state.selected_dashboard_index = (app_state
                                            .selected_dashboard_index
                                            + step)
                                            .min(dashboard_count.saturating_sub(1));
                                    }
                                    _ => {}
                                }
                            }
                        }
                        KeyCode::Home => {
                            if let ui::UIState::Chat = app_state.state {
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => {
                                        let max_scroll =
                                            app_state.chat_total_lines.saturating_sub(1);
                                        app_state.scroll_offset = max_scroll;
                                    }
                                    ui::FocusedPane::Context => {
                                        let max_scroll =
                                            app_state.context_buffer.len().saturating_sub(1);
                                        app_state.context_scroll_offset = max_scroll;
                                    }
                                    ui::FocusedPane::Dashboard => {
                                        app_state.selected_dashboard_index = 0;
                                    }
                                    _ => {}
                                }
                            }
                        }
                        KeyCode::End => {
                            if let ui::UIState::Chat = app_state.state {
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => app_state.scroll_offset = 0,
                                    ui::FocusedPane::Context => app_state.context_scroll_offset = 0,
                                    ui::FocusedPane::Dashboard => {
                                        let dashboard_count = app_state.dashboard_item_count();
                                        app_state.selected_dashboard_index =
                                            dashboard_count.saturating_sub(1);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Event::Mouse(mouse) => {
                    let size = terminal.size()?;
                    let (chunks, main_chunks) = ui::get_layout(size);

                    match mouse.kind {
                        MouseEventKind::Down(MouseButton::Left) => {
                            if mouse.row >= chunks[2].y
                                && mouse.row < chunks[2].y + chunks[2].height
                                && mouse.column >= chunks[2].x
                                && mouse.column < chunks[2].x + chunks[2].width
                            {
                                app_state.focused_pane = ui::FocusedPane::Input;
                            } else if mouse.row >= main_chunks[0].y
                                && mouse.row < main_chunks[0].y + main_chunks[0].height
                                && mouse.column >= main_chunks[0].x
                                && mouse.column < main_chunks[0].x + main_chunks[0].width
                            {
                                app_state.focused_pane = ui::FocusedPane::Dashboard;
                            } else if mouse.row >= main_chunks[1].y
                                && mouse.row < main_chunks[1].y + main_chunks[1].height
                                && mouse.column >= main_chunks[1].x
                                && mouse.column < main_chunks[1].x + main_chunks[1].width
                            {
                                app_state.focused_pane = ui::FocusedPane::Chat;
                            } else if mouse.row >= main_chunks[2].y
                                && mouse.row < main_chunks[2].y + main_chunks[2].height
                                && mouse.column >= main_chunks[2].x
                                && mouse.column < main_chunks[2].x + main_chunks[2].width
                            {
                                app_state.focused_pane = ui::FocusedPane::Context;
                            }
                        }
                        MouseEventKind::ScrollUp => {
                            if mouse.row >= main_chunks[1].y
                                && mouse.row < main_chunks[1].y + main_chunks[1].height
                                && mouse.column >= main_chunks[1].x
                                && mouse.column < main_chunks[1].x + main_chunks[1].width
                            {
                                app_state.scroll_offset =
                                    app_state.scroll_offset.saturating_add(ui::SCROLL_STEP);
                            } else if mouse.row >= main_chunks[2].y
                                && mouse.row < main_chunks[2].y + main_chunks[2].height
                                && mouse.column >= main_chunks[2].x
                                && mouse.column < main_chunks[2].x + main_chunks[2].width
                            {
                                app_state.context_scroll_offset = app_state
                                    .context_scroll_offset
                                    .saturating_add(ui::SCROLL_STEP);
                            } else if mouse.row >= main_chunks[0].y
                                && mouse.row < main_chunks[0].y + main_chunks[0].height
                                && mouse.column >= main_chunks[0].x
                                && mouse.column < main_chunks[0].x + main_chunks[0].width
                            {
                                app_state.selected_dashboard_index =
                                    app_state.selected_dashboard_index.saturating_sub(1);
                            }
                        }
                        MouseEventKind::ScrollDown => {
                            if mouse.row >= main_chunks[1].y
                                && mouse.row < main_chunks[1].y + main_chunks[1].height
                                && mouse.column >= main_chunks[1].x
                                && mouse.column < main_chunks[1].x + main_chunks[1].width
                            {
                                app_state.scroll_offset =
                                    app_state.scroll_offset.saturating_sub(ui::SCROLL_STEP);
                            } else if mouse.row >= main_chunks[2].y
                                && mouse.row < main_chunks[2].y + main_chunks[2].height
                                && mouse.column >= main_chunks[2].x
                                && mouse.column < main_chunks[2].x + main_chunks[2].width
                            {
                                app_state.context_scroll_offset = app_state
                                    .context_scroll_offset
                                    .saturating_sub(ui::SCROLL_STEP);
                            } else if mouse.row >= main_chunks[0].y
                                && mouse.row < main_chunks[0].y + main_chunks[0].height
                                && mouse.column >= main_chunks[0].x
                                && mouse.column < main_chunks[0].x + main_chunks[0].width
                            {
                                app_state.selected_dashboard_index =
                                    app_state.selected_dashboard_index.saturating_add(1);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            let mut log_text = None;
            match &event {
                ClientEvent::LogMessage(msg) => {
                    log_text = Some(msg.clone());
                }
                ClientEvent::CharacterList(_)
                | ClientEvent::PlayerEntered { .. }
                | ClientEvent::StatusUpdate { .. } => {
                    if args.verbose >= 1 {
                        log_text = Some(format!("ClientEvent: {:?}", event));
                    }
                }
                ClientEvent::World(world_event) => {
                    if args.verbose >= 2 {
                        log_text = Some(format!("WorldEvent: {:?}", world_event));
                    }
                }
                ClientEvent::GameMessage(msg) => {
                    if args.verbose >= 3 {
                        log_text = Some(format!("GameMessage: {:?}", msg));
                    }
                }
                ClientEvent::RawMessage(data) => {
                    if args.verbose >= 4 {
                        log_text = Some(format!("RawPacket ({} bytes): {:02X?}", data.len(), data));
                    }
                }
                _ => {}
            }

            if let Some(text) = log_text {
                if let Some(file_mutex) = &debug_file {
                    if let Ok(mut file) = file_mutex.lock() {
                        let _ = writeln!(file, "{}", text);
                        let _ = file.flush();
                    }
                } else {
                    app_state.messages.push(holtburger_core::ChatMessage {
                        kind: holtburger_core::MessageKind::System,
                        text: text.clone(),
                    });
                }
            }

            match event {
                ClientEvent::LogMessage(_) => {}
                ClientEvent::Message(msg) => {
                    app_state.messages.push(msg);
                }
                ClientEvent::CharacterList(chars) => {
                    app_state.characters = chars;
                    app_state.state = ui::UIState::CharacterSelection;
                }
                ClientEvent::PlayerEntered { guid, name } => {
                    app_state.player_guid = Some(guid);
                    app_state.character_name = Some(name);
                }
                ClientEvent::World(world_event) => {
                    use holtburger_core::world::WorldEvent;
                    match *world_event {
                        WorldEvent::PlayerInfo {
                            guid,
                            name,
                            pos,
                            attributes,
                            vitals,
                            skills,
                            enchantments,
                        } => {
                            app_state.player_guid = Some(guid);
                            app_state.character_name = Some(name);
                            if let Some(p) = pos {
                                app_state.player_pos = Some(p);
                            }
                            app_state.attributes = attributes;
                            app_state.vitals = vitals;
                            app_state.skills = skills;
                            app_state.player_enchantments = enchantments;
                            refresh_context_buffer(&mut app_state);
                        }
                        WorldEvent::AttributeUpdated(attr) => {
                            if let Some(existing) = app_state
                                .attributes
                                .iter_mut()
                                .find(|a| a.attr_type == attr.attr_type)
                            {
                                *existing = attr;
                            } else {
                                app_state.attributes.push(attr);
                            }
                            refresh_context_buffer(&mut app_state);
                        }
                        WorldEvent::VitalUpdated(vital) => {
                            if let Some(existing) = app_state
                                .vitals
                                .iter_mut()
                                .find(|v| v.vital_type == vital.vital_type)
                            {
                                *existing = vital;
                            } else {
                                app_state.vitals.push(vital);
                            }
                            refresh_context_buffer(&mut app_state);
                        }
                        WorldEvent::SkillUpdated(skill) => {
                            if let Some(existing) = app_state
                                .skills
                                .iter_mut()
                                .find(|s| s.skill_type == skill.skill_type)
                            {
                                *existing = skill;
                            } else {
                                app_state.skills.push(skill);
                            }
                            refresh_context_buffer(&mut app_state);
                        }
                        WorldEvent::PropertyUpdated {
                            guid: _,
                            property_id: _,
                            value: _,
                        } => {
                            // Currently we don't do anything with property updates in the TUI,
                            // we just ignore them to keep the chat clean.
                        }
                        WorldEvent::EntitySpawned(entity) => {
                            let name = entity.name.clone();
                            let guid = entity.guid;

                            // If this is the player being spawned, update our player-specific state
                            if Some(guid) == app_state.player_guid {
                                if name != "Unknown" {
                                    app_state.character_name = Some(name.clone());
                                }
                                app_state.player_pos = Some(entity.position);
                            }

                            app_state.entities.insert(guid, *entity);
                        }
                        WorldEvent::EntityDespawned(guid) => {
                            app_state.entities.remove(&guid);
                        }
                        WorldEvent::EntityMoved { guid, pos } => {
                            if let Some(entity) = app_state.entities.get_mut(&guid) {
                                entity.position = pos;
                            }
                            // Also update player_pos if it was us
                            if Some(guid) == app_state.player_guid {
                                app_state.player_pos = Some(pos);
                            }
                        }
                        WorldEvent::EnchantmentUpdated(enchantment) => {
                            if let Some(existing) =
                                app_state.player_enchantments.iter_mut().find(|e| {
                                    e.spell_id == enchantment.spell_id
                                        && e.layer == enchantment.layer
                                })
                            {
                                *existing = enchantment;
                            } else {
                                app_state.player_enchantments.push(enchantment);
                            }
                        }
                        WorldEvent::EnchantmentRemoved { spell_id, layer } => {
                            app_state
                                .player_enchantments
                                .retain(|e| e.spell_id != spell_id || e.layer != layer);
                        }
                        WorldEvent::EnchantmentsPurged => {
                            app_state.player_enchantments.clear();
                        }
                        WorldEvent::DerivedStatsUpdated {
                            attributes,
                            vitals,
                            skills,
                        } => {
                            app_state.attributes = attributes;
                            app_state.vitals = vitals;
                            app_state.skills = skills;
                            refresh_context_buffer(&mut app_state);
                        }
                        WorldEvent::ServerTimeUpdate(t) => {
                            app_state.server_time = Some((t, std::time::Instant::now()));
                        }
                    }
                }
                ClientEvent::StatusUpdate {
                    state,
                    logon_retry,
                    enter_retry,
                } => {
                    app_state.core_state = state;
                    app_state.logon_retry = logon_retry;
                    app_state.enter_retry = enter_retry;
                }
                ClientEvent::GameMessage(_) | ClientEvent::RawMessage(_) => {}
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

    let _ = client_handle.await;
    Ok(())
}
