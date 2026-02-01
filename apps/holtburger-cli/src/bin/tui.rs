use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use holtburger_cli::ui::{self, AppState};
use holtburger_core::{Client, ClientCommand, ClientEvent, ClientState};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::io;
use tokio::sync::mpsc;

struct TuiLogger {
    tx: mpsc::UnboundedSender<ClientEvent>,
}

impl log::Log for TuiLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Debug
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            let _ = self
                .tx
                .send(ClientEvent::Message(holtburger_core::ChatMessage {
                    kind: match record.level() {
                        log::Level::Error => holtburger_core::MessageKind::Error,
                        log::Level::Warn => holtburger_core::MessageKind::Warning,
                        _ => holtburger_core::MessageKind::System,
                    },
                    text: format!("[{}] {}", record.level(), record.args()),
                }));
        }
    }

    fn flush(&self) {}
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
    verbose: bool,
}

fn refresh_context_buffer(state: &mut AppState) {
    state.context_buffer.clear();

    if state.attributes.is_empty() && state.skills.is_empty() && state.vitals.is_empty() {
        state
            .context_buffer
            .push("--- Context Information ---".to_string());
        state
            .context_buffer
            .push("This pane will show entity details,".to_string());
        state
            .context_buffer
            .push("attributes, vitals, and skills.".to_string());
        state
            .context_buffer
            .push("---------------------------".to_string());
        return;
    }

    state
        .context_buffer
        .push("--- Character Stats ---".to_string());
    state.context_buffer.push("Vitals:".to_string());
    for vital in &state.vitals {
        state.context_buffer.push(format!(
            "  {}: {} / {}",
            vital.vital_type, vital.current, vital.base
        ));
    }
    state.context_buffer.push("".to_string());

    state.context_buffer.push("Attributes:".to_string());

    // Sort attributes by enum value for consistent UI
    let mut sorted_attrs = state.attributes.clone();
    sorted_attrs.sort_by_key(|a| a.attr_type as u32);

    for attr in sorted_attrs {
        state
            .context_buffer
            .push(format!("  {}: {}", attr.attr_type, attr.base));
    }
    state.context_buffer.push("".to_string());
    state.context_buffer.push("Skills:".to_string());

    let mut sorted_skills = state.skills.clone();
    sorted_skills.sort_by_key(|s| s.skill_type as u32);

    for skill in sorted_skills {
        if skill.skill_type.is_eor() {
            state.context_buffer.push(format!(
                "  {}: {} ({})",
                skill.skill_type, skill.current, skill.training
            ));
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    if args.verbose {
        let logger = TuiLogger {
            tx: event_tx.clone(),
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
        nearby_tab: ui::NearbyTab::Entities,
        context_buffer: Vec::new(),
        context_scroll_offset: 0,
        client_status: None,
        retry_status: None,
        core_state: ClientState::Connected,
        player_pos: None,
        entities: std::collections::HashMap::new(),
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

    loop {
        // Clamp nearby selection index before drawing
        let nearby_count = app_state
            .entities
            .values()
            .filter(|e| e.is_targetable())
            .count();
        if app_state.selected_nearby_index >= nearby_count && nearby_count > 0 {
            app_state.selected_nearby_index = nearby_count - 1;
        } else if nearby_count == 0 {
            app_state.selected_nearby_index = 0;
        }

        terminal.draw(|f| ui::ui(f, &mut app_state))?;

        if event::poll(std::time::Duration::from_millis(100))?
            && let Event::Key(key) = event::read()?
        {
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
                    use ui::FocusedPane;
                    if key
                        .modifiers
                        .contains(crossterm::event::KeyModifiers::CONTROL)
                        || key.code == KeyCode::BackTab
                    {
                        // Cycle back
                        app_state.focused_pane = match app_state.focused_pane {
                            FocusedPane::Input => FocusedPane::Context,
                            FocusedPane::Context => FocusedPane::Chat,
                            FocusedPane::Chat => FocusedPane::Nearby,
                            FocusedPane::Nearby => FocusedPane::Context,
                        };
                    } else {
                        // Cycle forward
                        app_state.focused_pane = match app_state.focused_pane {
                            FocusedPane::Input => FocusedPane::Nearby,
                            FocusedPane::Nearby => FocusedPane::Chat,
                            FocusedPane::Chat => FocusedPane::Context,
                            FocusedPane::Context => FocusedPane::Nearby,
                        };
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
                            if input == "/nearby" || input == "/l" || input == "/nearby -a" {
                                let show_all = input == "/nearby -a";
                                app_state.messages.push(holtburger_core::ChatMessage {
                                    kind: holtburger_core::MessageKind::System,
                                    text: if show_all {
                                        "--- All Nearby Entities ---"
                                    } else {
                                        "--- Nearby Entities (Interactable) ---"
                                    }
                                    .to_string(),
                                });
                                let mut count = 0;
                                for entity in app_state.entities.values() {
                                    if !show_all && !entity.is_targetable() {
                                        continue;
                                    }
                                    let class = entity.classification();
                                    use holtburger_core::world::entity::EntityClass;
                                    let class_str = match class {
                                        EntityClass::Player => "Player",
                                        EntityClass::Npc => "NPC",
                                        EntityClass::Monster => "Monster",
                                        EntityClass::Weapon => "Weapon",
                                        EntityClass::Armor => "Armor",
                                        EntityClass::Jewelry => "Jewelry",
                                        EntityClass::Apparel => "Apparel",
                                        EntityClass::Door => "Door",
                                        EntityClass::Portal => "Portal",
                                        EntityClass::LifeStone => "LifeStone",
                                        EntityClass::Chest => "Chest",
                                        EntityClass::Tool => "Tool",
                                        EntityClass::Dynamic => "Dynamic",
                                        EntityClass::StaticObject => "Static",
                                        EntityClass::Unknown => "Unknown",
                                    };
                                    app_state.messages.push(holtburger_core::ChatMessage {
                                        kind: holtburger_core::MessageKind::Info,
                                        text: format!(
                                            "[{:08X}] ({}) {}",
                                            entity.guid, class_str, entity.name
                                        ),
                                    });
                                    count += 1;
                                }
                                if count == 0 {
                                    app_state.messages.push(holtburger_core::ChatMessage {
                                        kind: holtburger_core::MessageKind::Info,
                                        text: "No entities nearby.".to_string(),
                                    });
                                }
                                app_state.focused_pane = app_state.previous_focused_pane;
                                continue;
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
                                    _ => {}
                                }

                                let mut nearby: Vec<_> = app_state
                                    .entities
                                    .values()
                                    .filter(|e| {
                                        if app_state.nearby_tab == ui::NearbyTab::Entities {
                                            e.is_targetable() && e.position.landblock_id != 0
                                        } else {
                                            e.position.landblock_id == 0 && !e.name.is_empty()
                                        }
                                    })
                                    .map(|e| {
                                        let dist = if let Some(p) = &app_state.player_pos {
                                            e.position.distance_to(p)
                                        } else {
                                            0.0
                                        };
                                        (e, dist)
                                    })
                                    .collect();

                                nearby.sort_by(|a, b| {
                                    if app_state.nearby_tab == ui::NearbyTab::Entities {
                                        a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                                    } else {
                                        a.0.name.cmp(&b.0.name)
                                    }
                                });

                                if let Some((e, _)) = nearby.get(app_state.selected_nearby_index) {
                                    match c {
                                        'a' | 'A' => {
                                            let _ =
                                                command_tx.send(ClientCommand::Identify(e.guid));
                                        }
                                        'i' | 'I' => {
                                            let _ = command_tx.send(ClientCommand::Use(e.guid));
                                        }
                                        'k' | 'K' => {
                                            let _ = command_tx.send(ClientCommand::Attack(e.guid));
                                        }
                                        'd' | 'D' => {
                                            app_state.context_buffer.clear();
                                            app_state
                                                .context_buffer
                                                .push(format!("DEBUG INFO: {}", e.name));
                                            app_state
                                                .context_buffer
                                                .push(format!("GUID:  {:08X}", e.guid));
                                            app_state
                                                .context_buffer
                                                .push(format!("WCID:  {:?}", e.wcid));
                                            app_state
                                                .context_buffer
                                                .push(format!("Class: {:?}", e.classification()));
                                            app_state
                                                .context_buffer
                                                .push(format!("Flags: {:?}", e.flags));
                                            if let Some(it) = e.item_type {
                                                app_state
                                                    .context_buffer
                                                    .push(format!("IType: {:?}", it));
                                            }
                                            app_state.context_buffer.push(format!(
                                                "Pos:   {}",
                                                e.position.to_world_coords()
                                            ));
                                            app_state.context_buffer.push(format!(
                                                "LB:    {:08X}",
                                                e.position.landblock_id
                                            ));
                                            app_state
                                                .context_buffer
                                                .push(format!("Coords: {:?}", e.position.coords));

                                            if !e.int_properties.is_empty() {
                                                app_state
                                                    .context_buffer
                                                    .push("-- Int Properties --".to_string());
                                                let mut sorted_keys: Vec<_> =
                                                    e.int_properties.keys().collect();
                                                sorted_keys.sort();
                                                for k in sorted_keys {
                                                    app_state.context_buffer.push(format!(
                                                        "  {}: {}",
                                                        k, e.int_properties[k]
                                                    ));
                                                }
                                            }
                                            if !e.bool_properties.is_empty() {
                                                app_state
                                                    .context_buffer
                                                    .push("-- Bool Properties --".to_string());
                                                let mut sorted_keys: Vec<_> =
                                                    e.bool_properties.keys().collect();
                                                sorted_keys.sort();
                                                for k in sorted_keys {
                                                    app_state.context_buffer.push(format!(
                                                        "  {}: {}",
                                                        k, e.bool_properties[k]
                                                    ));
                                                }
                                            }
                                            if !e.string_properties.is_empty() {
                                                app_state
                                                    .context_buffer
                                                    .push("-- String Properties --".to_string());
                                                let mut sorted_keys: Vec<_> =
                                                    e.string_properties.keys().collect();
                                                sorted_keys.sort();
                                                for k in sorted_keys {
                                                    app_state.context_buffer.push(format!(
                                                        "  {}: {}",
                                                        k, e.string_properties[k]
                                                    ));
                                                }
                                            }
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
                            app_state.scroll_offset = app_state.scroll_offset.saturating_add(1);
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
                            app_state.scroll_offset = app_state.scroll_offset.saturating_sub(1);
                        }
                        ui::FocusedPane::Context => {
                            app_state.context_scroll_offset =
                                app_state.context_scroll_offset.saturating_sub(1);
                        }
                        ui::FocusedPane::Nearby => {
                            let nearby_count = app_state
                                .entities
                                .values()
                                .filter(|e| {
                                    if app_state.nearby_tab == ui::NearbyTab::Entities {
                                        e.is_targetable() && e.position.landblock_id != 0
                                    } else {
                                        e.position.landblock_id == 0 && !e.name.is_empty()
                                    }
                                })
                                .count();
                            if nearby_count > 0
                                && app_state.selected_nearby_index + 1 < nearby_count
                            {
                                app_state.selected_nearby_index += 1;
                            }
                        }
                    },
                    ui::UIState::CharacterSelection => {
                        if !app_state.characters.is_empty()
                            && app_state.selected_character_index + 1 < app_state.characters.len()
                        {
                            app_state.selected_character_index += 1;
                        }
                    }
                },
                KeyCode::PageUp => {
                    if let ui::UIState::Chat = app_state.state {
                        match app_state.focused_pane {
                            ui::FocusedPane::Chat => {
                                app_state.scroll_offset =
                                    app_state.scroll_offset.saturating_add(10);
                                let max_scroll = app_state.messages.len().saturating_sub(1);
                                if app_state.scroll_offset > max_scroll {
                                    app_state.scroll_offset = max_scroll;
                                }
                            }
                            ui::FocusedPane::Context => {
                                app_state.context_scroll_offset =
                                    app_state.context_scroll_offset.saturating_add(10);
                                let max_scroll = app_state.context_buffer.len().saturating_sub(1);
                                if app_state.context_scroll_offset > max_scroll {
                                    app_state.context_scroll_offset = max_scroll;
                                }
                            }
                            ui::FocusedPane::Nearby => {
                                app_state.selected_nearby_index =
                                    app_state.selected_nearby_index.saturating_sub(10);
                            }
                            _ => {}
                        }
                    }
                }
                KeyCode::PageDown => {
                    if let ui::UIState::Chat = app_state.state {
                        match app_state.focused_pane {
                            ui::FocusedPane::Chat => {
                                app_state.scroll_offset =
                                    app_state.scroll_offset.saturating_sub(10);
                            }
                            ui::FocusedPane::Context => {
                                app_state.context_scroll_offset =
                                    app_state.context_scroll_offset.saturating_sub(10);
                            }
                            ui::FocusedPane::Nearby => {
                                let nearby_count = app_state
                                    .entities
                                    .values()
                                    .filter(|e| {
                                        if app_state.nearby_tab == ui::NearbyTab::Entities {
                                            e.is_targetable() && e.position.landblock_id != 0
                                        } else {
                                            e.position.landblock_id == 0 && !e.name.is_empty()
                                        }
                                    })
                                    .count();
                                app_state.selected_nearby_index = (app_state.selected_nearby_index
                                    + 10)
                                    .min(nearby_count.saturating_sub(1));
                            }
                            _ => {}
                        }
                    }
                }
                KeyCode::Home => {
                    if let ui::UIState::Chat = app_state.state {
                        match app_state.focused_pane {
                            ui::FocusedPane::Chat => app_state.scroll_offset = 0,
                            ui::FocusedPane::Context => app_state.context_scroll_offset = 0,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            match event {
                ClientEvent::Message(msg) => {
                    app_state.messages.push(msg);
                    // auto-scroll when new messages arrive if we're near the bottom
                    if app_state.scroll_offset < 5 {
                        app_state.scroll_offset = 0;
                    }
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
                        } => {
                            app_state.player_guid = Some(guid);
                            app_state.character_name = Some(name);
                            if let Some(p) = pos {
                                app_state.player_pos = Some(p);
                            }
                            app_state.attributes = attributes;
                            app_state.vitals = vitals;
                            app_state.skills = skills;
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
                            guid,
                            property_type,
                            property_id,
                            value,
                        } => {
                            use holtburger_core::protocol::properties::*;

                            let target_name = if let Some(entity) = app_state.entities.get(&guid) {
                                entity.name.clone()
                            } else if Some(guid) == app_state.player_guid {
                                "You".to_string()
                            } else if guid == 0 {
                                "Self".to_string()
                            } else {
                                format!("{:08X}", guid)
                            };

                            let name = match property_type.as_str() {
                                "Int" => PropertyInt::from_repr(property_id).map(|p| p.to_string()),
                                "Bool" => {
                                    PropertyBool::from_repr(property_id).map(|p| p.to_string())
                                }
                                "Int64" => {
                                    PropertyInt64::from_repr(property_id).map(|p| p.to_string())
                                }
                                "Float" => {
                                    PropertyFloat::from_repr(property_id).map(|p| p.to_string())
                                }
                                "String" => {
                                    PropertyString::from_repr(property_id).map(|p| p.to_string())
                                }
                                "DID" => {
                                    PropertyDataId::from_repr(property_id).map(|p| p.to_string())
                                }
                                "IID" => PropertyInstanceId::from_repr(property_id)
                                    .map(|p| p.to_string()),
                                _ => None,
                            }
                            .unwrap_or_else(|| format!("#{}", property_id));

                            app_state.messages.push(holtburger_core::ChatMessage {
                                kind: holtburger_core::MessageKind::Info,
                                text: format!("[Update] {} {}: {}", target_name, name, value),
                            });
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
                    }
                }
                ClientEvent::StatusUpdate {
                    state,
                    logon_retry,
                    enter_retry,
                } => {
                    app_state.core_state = state;
                    let mut retry_parts = Vec::new();
                    if let Some((current, max)) = logon_retry {
                        retry_parts.push(format!("[Logon Retry {}/{}]", current, max));
                    }
                    if let Some((current, max)) = enter_retry {
                        retry_parts.push(format!("[Enter Retry {}/{}]", current, max));
                    }
                    app_state.retry_status = if retry_parts.is_empty() {
                        None
                    } else {
                        Some(retry_parts.join(" "))
                    };
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
