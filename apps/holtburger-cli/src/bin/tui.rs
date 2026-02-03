use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, MouseButton, MouseEventKind,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use holtburger_cli::classification::{self};
use holtburger_cli::ui::{self, AppState};
use holtburger_core::protocol::properties::*;
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
    verbose_tui: bool,
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

            // Only send to TUI if verbose is enabled or it's a high level message
            if self.verbose_tui || record.level() <= log::Level::Info {
                let _ = self
                    .tx
                    .send(ClientEvent::Message(holtburger_core::ChatMessage {
                        kind: match record.level() {
                            log::Level::Error => holtburger_core::MessageKind::Error,
                            log::Level::Warn => holtburger_core::MessageKind::Warning,
                            _ => holtburger_core::MessageKind::System,
                        },
                        text: log_msg,
                    }));
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
    #[arg(short, long)]
    verbose: bool,
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

    if args.verbose || args.log.is_some() {
        let file = if let Some(path) = &args.log {
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
            file,
            verbose_tui: args.verbose,
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
        focused_pane: ui::FocusedPane::Nearby,
        previous_focused_pane: ui::FocusedPane::Nearby,
        selected_character_index: 0,
        selected_nearby_index: 0,
        nearby_list_state: ratatui::widgets::ListState::default().with_selected(Some(0)),
        scroll_offset: 0,
        chat_total_lines: 0,
        nearby_tab: ui::NearbyTab::Entities,
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
    };

    refresh_context_buffer(&mut app_state);

    if args.verbose {
        app_state.messages.push(holtburger_core::ChatMessage {
            kind: holtburger_core::MessageKind::System,
            text: "Verbose mode enabled. Logs will appear in chat.".to_string(),
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

        // Clamp nearby selection index before drawing
        let nearby_count = app_state.nearby_item_count();
        if app_state.selected_nearby_index >= nearby_count && nearby_count > 0 {
            app_state.selected_nearby_index = nearby_count - 1;
        } else if nearby_count == 0 {
            app_state.selected_nearby_index = 0;
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
                                    app_state.scroll_offset = 0;
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
                                    ui::FocusedPane::Nearby => {
                                        match c {
                                            '1' => {
                                                app_state.nearby_tab = ui::NearbyTab::Entities;
                                                app_state.selected_nearby_index = 0;
                                                continue;
                                            }
                                            '2' => {
                                                app_state.nearby_tab = ui::NearbyTab::Inventory;
                                                app_state.selected_nearby_index = 0;
                                                continue;
                                            }
                                            '3' => {
                                                app_state.nearby_tab = ui::NearbyTab::Character;
                                                app_state.selected_nearby_index = 0;
                                                continue;
                                            }
                                            '4' => {
                                                app_state.nearby_tab = ui::NearbyTab::Effects;
                                                app_state.selected_nearby_index = 0;
                                                continue;
                                            }
                                            'x' | 'X' => {
                                                app_state.context_view = ui::ContextView::Default;
                                                refresh_context_buffer(&mut app_state);
                                                continue;
                                            }
                                            _ => {}
                                        }

                                        if app_state.nearby_tab == ui::NearbyTab::Effects {
                                            let enchants =
                                                app_state.get_effects_list_enchantments();
                                            if let Some((enchant_ref, _)) =
                                                enchants.get(app_state.selected_nearby_index)
                                            {
                                                let enchant = (*enchant_ref).clone();
                                                match c {
                                                    'd' | 'D' => {
                                                        app_state.context_view =
                                                            ui::ContextView::Custom;
                                                        app_state.context_buffer.clear();
                                                        app_state.context_buffer.push(format!(
                                                            "DEBUG ENCHANTMENT: Spell #{}",
                                                            enchant.spell_id
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Layer:          {}",
                                                            enchant.layer
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Category:       {}",
                                                            enchant.spell_category
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Power Level:    {}",
                                                            enchant.power_level
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Duration:       {:.1}s",
                                                            enchant.duration
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Stat Mod Type:  0x{:08X}",
                                                            enchant.stat_mod_type
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Stat Mod Key:   {}",
                                                            enchant.stat_mod_key
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Stat Mod Value: {:.2}",
                                                            enchant.stat_mod_value
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Caster GUID:    {:08X}",
                                                            enchant.caster_guid
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Degrade Limit:  {:.2}",
                                                            enchant.degrade_limit
                                                        ));
                                                        app_state.context_buffer.push(format!(
                                                            "Last Degraded:  {:.1}",
                                                            enchant.last_time_degraded
                                                        ));
                                                        app_state.context_scroll_offset = 0;
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            continue;
                                        }

                                        let guid = {
                                            let nearby = app_state.get_filtered_nearby_entities();
                                            nearby
                                                .get(app_state.selected_nearby_index)
                                                .map(|(e, _, _)| e.guid)
                                        };

                                        if let Some(guid) = guid {
                                            match c {
                                                'a' | 'A' => {
                                                    let _ = command_tx
                                                        .send(ClientCommand::Identify(guid));
                                                }
                                                'i' | 'I' => {
                                                    let _ =
                                                        command_tx.send(ClientCommand::Use(guid));
                                                }
                                                'k' | 'K' => {
                                                    let _ = command_tx
                                                        .send(ClientCommand::Attack(guid));
                                                }
                                                'd' | 'D' => {
                                                    let mut lines = Vec::new();
                                                    if let Some(e) = app_state.entities.get(&guid) {
                                                        lines.push(format!(
                                                            "DEBUG INFO: {}",
                                                            e.name
                                                        ));
                                                        lines.push(format!(
                                                            "GUID:   {:08X}",
                                                            e.guid
                                                        ));
                                                        let class =
                                                            classification::classify_entity(e);
                                                        lines.push(format!(
                                                            "Class:  {} ({:?})",
                                                            class.label(),
                                                            class
                                                        ));

                                                        if let Some(parent_id) = e.physics_parent_id
                                                        {
                                                            let parent_name = if let Some(p) =
                                                                app_state.entities.get(&parent_id)
                                                            {
                                                                p.name.clone()
                                                            } else if Some(parent_id)
                                                                == app_state.player_guid
                                                            {
                                                                "You".to_string()
                                                            } else {
                                                                "Unknown".to_string()
                                                            };
                                                            lines.push(format!(
                                                                "Phys Parent: {:08X} ({})",
                                                                parent_id, parent_name
                                                            ));
                                                        }

                                                        if let Some(container_id) = e.container_id {
                                                            let container_name = if let Some(p) =
                                                                app_state
                                                                    .entities
                                                                    .get(&container_id)
                                                            {
                                                                p.name.clone()
                                                            } else if Some(container_id)
                                                                == app_state.player_guid
                                                            {
                                                                "You".to_string()
                                                            } else {
                                                                "Unknown".to_string()
                                                            };
                                                            lines.push(format!(
                                                                "Container:   {:08X} ({})",
                                                                container_id, container_name
                                                            ));
                                                        }

                                                        if let Some(wielder_id) = e.wielder_id {
                                                            let wielder_name = if let Some(p) =
                                                                app_state.entities.get(&wielder_id)
                                                            {
                                                                p.name.clone()
                                                            } else if Some(wielder_id)
                                                                == app_state.player_guid
                                                            {
                                                                "You".to_string()
                                                            } else {
                                                                "Unknown".to_string()
                                                            };
                                                            lines.push(format!(
                                                                "Wielder:     {:08X} ({})",
                                                                wielder_id, wielder_name
                                                            ));
                                                        }

                                                        lines.push(format!("WCID:   {:?}", e.wcid));
                                                        lines.push(format!(
                                                            "Class:  {:?}",
                                                            classification::classify_entity(e)
                                                        ));
                                                        lines.push(format!(
                                                            "GfxID:  {:?}",
                                                            e.gfx_id
                                                        ));
                                                        lines.push(format!(
                                                            "Vel:    {:?}",
                                                            e.velocity
                                                        ));
                                                        lines.push(format!(
                                                            "Flags:  {:08X}",
                                                            e.flags.bits()
                                                        ));
                                                        for (name, _) in e.flags.iter_names() {
                                                            lines.push(format!("  [X] {}", name));
                                                        }

                                                        lines.push(format!(
                                                            "Phys:   {:08X}",
                                                            e.physics_state.bits()
                                                        ));
                                                        for (name, _) in
                                                            e.physics_state.iter_names()
                                                        {
                                                            lines.push(format!("  [X] {}", name));
                                                        }

                                                        if let Some(it) = e.item_type {
                                                            lines.push(format!(
                                                                "IType:  {:08X}",
                                                                it.bits()
                                                            ));
                                                            for (name, _) in it.iter_names() {
                                                                lines.push(format!(
                                                                    "  [X] {}",
                                                                    name
                                                                ));
                                                            }
                                                        }
                                                        lines.push(format!(
                                                            "Pos:    {}",
                                                            e.position.to_world_coords()
                                                        ));
                                                        lines.push(format!(
                                                            "LB:     {:08X}",
                                                            e.position.landblock_id
                                                        ));
                                                        lines.push(format!(
                                                            "Coords: {:?}",
                                                            e.position.coords
                                                        ));

                                                        if !e.int_properties.is_empty() {
                                                            lines.push(
                                                                "-- Int Properties --".to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> =
                                                                e.int_properties.keys().collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyInt::from_repr(k)
                                                                        .map(|p| p.to_string())
                                                                        .unwrap_or_else(|| {
                                                                            k.to_string()
                                                                        });
                                                                lines.push(format!(
                                                                    "  {}: {}",
                                                                    name, e.int_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                        if !e.bool_properties.is_empty() {
                                                            lines.push(
                                                                "-- Bool Properties --".to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> =
                                                                e.bool_properties.keys().collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyBool::from_repr(k)
                                                                        .map(|p| p.to_string())
                                                                        .unwrap_or_else(|| {
                                                                            k.to_string()
                                                                        });
                                                                lines.push(format!(
                                                                    "  {}: {}",
                                                                    name, e.bool_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                        if !e.float_properties.is_empty() {
                                                            lines.push(
                                                                "-- Float Properties --"
                                                                    .to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> =
                                                                e.float_properties.keys().collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyFloat::from_repr(k)
                                                                        .map(|p| p.to_string())
                                                                        .unwrap_or_else(|| {
                                                                            k.to_string()
                                                                        });
                                                                lines.push(format!(
                                                                    "  {}: {:.4}",
                                                                    name, e.float_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                        if !e.string_properties.is_empty() {
                                                            lines.push(
                                                                "-- String Properties --"
                                                                    .to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> = e
                                                                .string_properties
                                                                .keys()
                                                                .collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyString::from_repr(k)
                                                                        .map(|p| p.to_string())
                                                                        .unwrap_or_else(|| {
                                                                            k.to_string()
                                                                        });
                                                                lines.push(format!(
                                                                    "  {}: {}",
                                                                    name, e.string_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                        if !e.did_properties.is_empty() {
                                                            lines.push(
                                                                "-- DataID Properties --"
                                                                    .to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> =
                                                                e.did_properties.keys().collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyDataId::from_repr(k)
                                                                        .map(|p| p.to_string())
                                                                        .unwrap_or_else(|| {
                                                                            k.to_string()
                                                                        });
                                                                lines.push(format!(
                                                                    "  {}: {:08X}",
                                                                    name, e.did_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                        if !e.iid_properties.is_empty() {
                                                            lines.push(
                                                                "-- InstanceID Properties --"
                                                                    .to_string(),
                                                            );
                                                            let mut sorted_keys: Vec<_> =
                                                                e.iid_properties.keys().collect();
                                                            sorted_keys.sort();
                                                            for &k in sorted_keys {
                                                                let name =
                                                                    PropertyInstanceId::from_repr(
                                                                        k,
                                                                    )
                                                                    .map(|p| p.to_string())
                                                                    .unwrap_or_else(|| {
                                                                        k.to_string()
                                                                    });
                                                                lines.push(format!(
                                                                    "  {}: {:08X}",
                                                                    name, e.iid_properties[&k]
                                                                ));
                                                            }
                                                        }
                                                    }
                                                    app_state.context_view =
                                                        ui::ContextView::Custom;
                                                    app_state.context_buffer = lines;
                                                    app_state.context_scroll_offset = 0;
                                                }
                                                _ => {}
                                            }
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
                                ui::FocusedPane::Nearby => {
                                    if app_state.selected_nearby_index > 0 {
                                        app_state.selected_nearby_index -= 1;
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
                                ui::FocusedPane::Nearby => {
                                    let nearby_count = app_state.nearby_item_count();
                                    if nearby_count > 0
                                        && app_state.selected_nearby_index + 1 < nearby_count
                                    {
                                        app_state.selected_nearby_index += 1;
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
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => {
                                        app_state.scroll_offset = app_state
                                            .scroll_offset
                                            .saturating_add(ui::PAGE_SCROLL_STEP);
                                    }
                                    ui::FocusedPane::Context => {
                                        app_state.context_scroll_offset = app_state
                                            .context_scroll_offset
                                            .saturating_add(ui::PAGE_SCROLL_STEP);
                                    }
                                    ui::FocusedPane::Nearby => {
                                        app_state.selected_nearby_index = app_state
                                            .selected_nearby_index
                                            .saturating_sub(ui::PAGE_SCROLL_STEP);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        KeyCode::PageDown => {
                            if let ui::UIState::Chat = app_state.state {
                                match app_state.focused_pane {
                                    ui::FocusedPane::Chat => {
                                        app_state.scroll_offset = app_state
                                            .scroll_offset
                                            .saturating_sub(ui::PAGE_SCROLL_STEP);
                                    }
                                    ui::FocusedPane::Context => {
                                        app_state.context_scroll_offset = app_state
                                            .context_scroll_offset
                                            .saturating_sub(ui::PAGE_SCROLL_STEP);
                                    }
                                    ui::FocusedPane::Nearby => {
                                        let nearby_count = app_state.nearby_item_count();
                                        app_state.selected_nearby_index = (app_state
                                            .selected_nearby_index
                                            + ui::PAGE_SCROLL_STEP)
                                            .min(nearby_count.saturating_sub(1));
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
                                    ui::FocusedPane::Nearby => {
                                        app_state.selected_nearby_index = 0;
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
                                    ui::FocusedPane::Nearby => {
                                        let nearby_count = app_state.nearby_item_count();
                                        app_state.selected_nearby_index =
                                            nearby_count.saturating_sub(1);
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
                                app_state.focused_pane = ui::FocusedPane::Nearby;
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
                                app_state.selected_nearby_index =
                                    app_state.selected_nearby_index.saturating_sub(1);
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
                                app_state.selected_nearby_index =
                                    app_state.selected_nearby_index.saturating_add(1);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            match event {
                ClientEvent::Message(msg) => {
                    app_state.messages.push(msg);
                    // Only auto-scroll to bottom if we are already at the bottom.
                    // If we are scrolled up, we stay at the current scroll_offset.
                    // Note: This still causes text to slide up because scroll_offset is from the bottom.
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
