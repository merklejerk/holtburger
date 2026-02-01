use holtburger_core::world::properties::{ObjectDescriptionFlag, PropertyInt, RadarColor};
use holtburger_core::{ChatMessage, ClientState, MessageKind};
use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

#[derive(PartialEq, Debug)]
pub enum UIState {
    Chat,
    CharacterSelection,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum NearbyTab {
    Entities,
    Inventory,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum FocusedPane {
    Chat,
    Context,
    Input,
    Nearby,
}

pub struct AppState {
    pub account_name: String,
    pub character_name: Option<String>,
    pub player_guid: Option<u32>,
    pub attributes: Vec<holtburger_core::world::stats::Attribute>,
    pub vitals: Vec<holtburger_core::world::stats::Vital>,
    pub skills: Vec<holtburger_core::world::stats::Skill>,
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub characters: Vec<(u32, String)>,
    pub state: UIState,
    pub focused_pane: FocusedPane,
    pub previous_focused_pane: FocusedPane,
    pub selected_character_index: usize,
    pub selected_nearby_index: usize,
    pub nearby_list_state: ratatui::widgets::ListState,
    pub scroll_offset: usize,
    pub nearby_tab: NearbyTab,
    pub context_buffer: Vec<String>,
    pub context_scroll_offset: usize,
    pub client_status: Option<String>,
    pub retry_status: Option<String>,
    pub core_state: ClientState,
    pub player_pos: Option<holtburger_core::world::position::WorldPosition>,
    pub entities: std::collections::HashMap<u32, holtburger_core::world::entity::Entity>,
}

pub fn ui(f: &mut Frame, state: &mut AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Status bar
            Constraint::Min(10),   // Main area
            Constraint::Length(3), // Input area
        ])
        .split(f.size());

    let char_info = if let Some(name) = &state.character_name {
        if let Some(guid) = state.player_guid {
            format!("{} [{:08X}]", name, guid)
        } else {
            name.clone()
        }
    } else {
        "Selecting Character...".to_string()
    };

    let pos_info = if let Some(pos) = &state.player_pos {
        pos.to_world_coords()
    } else {
        "No Pos".to_string()
    };

    let status_line = format!(
        " [Account: {}] [Char: {}] [Pos: {}] [State: {:?}] {}",
        state.account_name,
        char_info,
        pos_info,
        state.core_state,
        state.retry_status.as_deref().unwrap_or("")
    );

    let status_block = Block::default().borders(Borders::ALL).title("Status");
    let status_para = Paragraph::new(status_line).block(status_block);
    f.render_widget(status_para, chunks[0]);

    // 2. Main Area
    match state.state {
        UIState::Chat => {
            let main_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(25), // Nearby Entities
                    Constraint::Percentage(50), // Chat
                    Constraint::Percentage(25), // Context
                ])
                .split(chunks[1]);

            // --- Nearby Entities / Inventory Pane ---
            let nearby_filtered: Vec<_> = state
                .entities
                .values()
                .filter(|e| {
                    if state.nearby_tab == NearbyTab::Entities {
                        e.is_targetable() && e.position.landblock_id != 0
                    } else {
                        // Inventory items or things without coordinates
                        e.position.landblock_id == 0 && !e.name.is_empty()
                    }
                })
                .map(|e| {
                    let dist = if let Some(p) = &state.player_pos {
                        e.position.distance_to(p)
                    } else {
                        0.0
                    };
                    (e, dist)
                })
                .collect();

            let mut nearby = nearby_filtered;
            nearby.sort_by(|a, b| {
                if state.nearby_tab == NearbyTab::Entities {
                    a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                } else {
                    a.0.name.cmp(&b.0.name)
                }
            });

            // Clamp index
            if state.selected_nearby_index >= nearby.len() && !nearby.is_empty() {
                state.selected_nearby_index = nearby.len().saturating_sub(1);
            }

            let _nearby_height = main_chunks[0].height.saturating_sub(4) as usize; // Sub for block + tooltip
            let nearby_items: Vec<ListItem> = nearby
                .iter()
                .enumerate()
                .map(|(i, (e, dist))| {
                    let color_val = e
                        .int_properties
                        .get(&(PropertyInt::RadarBlipColor as u32))
                        .cloned()
                        .unwrap_or(0);
                    let color = match color_val as u8 {
                        c if c == RadarColor::Blue as u8 => Color::Blue,
                        c if c == RadarColor::Gold as u8 => Color::Yellow,
                        c if c == RadarColor::Purple as u8 => Color::Magenta,
                        c if c == RadarColor::Red as u8 => Color::Red,
                        c if c == RadarColor::Green as u8 => Color::Green,
                        c if c == RadarColor::Yellow as u8 => Color::Yellow,
                        _ => Color::White,
                    };

                    let style = if i == state.selected_nearby_index {
                        Style::default().bg(Color::DarkGray).fg(color)
                    } else {
                        Style::default().fg(color)
                    };

                    let type_marker = match e.classification() {
                        holtburger_core::world::entity::EntityClass::Player => "Player",
                        holtburger_core::world::entity::EntityClass::Npc => "NPC",
                        holtburger_core::world::entity::EntityClass::Monster => "Mob",
                        holtburger_core::world::entity::EntityClass::Weapon => "Weapon",
                        holtburger_core::world::entity::EntityClass::Armor => "Armor",
                        holtburger_core::world::entity::EntityClass::Jewelry => "Jewelry",
                        holtburger_core::world::entity::EntityClass::Apparel => "Apparel",
                        holtburger_core::world::entity::EntityClass::Door => "Door",
                        holtburger_core::world::entity::EntityClass::Portal => "Portal",
                        holtburger_core::world::entity::EntityClass::LifeStone => "LifeStone",
                        holtburger_core::world::entity::EntityClass::Chest => "Chest",
                        holtburger_core::world::entity::EntityClass::Tool => "Tool",
                        holtburger_core::world::entity::EntityClass::StaticObject => "Static",
                        holtburger_core::world::entity::EntityClass::Dynamic => "Dynamic",
                        holtburger_core::world::entity::EntityClass::Unknown => "?",
                    };

                    let display_name = if e.name.trim().is_empty() {
                        format!("<{:08X}>", e.guid)
                    } else {
                        e.name.clone()
                    };
                    if state.nearby_tab == NearbyTab::Entities {
                        ListItem::new(format!(
                            "[{}] {:<15} [{:.1}m]",
                            type_marker, display_name, dist
                        ))
                        .style(style)
                    } else {
                        ListItem::new(format!("[{}] {:<15}", type_marker, display_name))
                            .style(style)
                    }
                })
                .collect();

            let nearby_style = if state.focused_pane == FocusedPane::Nearby {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            };

            let title = match state.nearby_tab {
                NearbyTab::Entities => " [1] Nearby |  2  Inventory ",
                NearbyTab::Inventory => "  1  Nearby | [2] Inventory ",
            };

            let nearby_block = Block::default()
                .borders(Borders::ALL)
                .title(title)
                .border_style(nearby_style);

            // Layout for nearby pane to include tooltip
            let nearby_inner_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Min(1),
                    Constraint::Length(2), // Tooltip area
                ])
                .split(nearby_block.inner(main_chunks[0]));

            let nearby_list = List::new(nearby_items)
                .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                .highlight_symbol("> ");

            f.render_widget(nearby_block, main_chunks[0]);
            state
                .nearby_list_state
                .select(Some(state.selected_nearby_index));
            f.render_stateful_widget(
                nearby_list,
                nearby_inner_chunks[0],
                &mut state.nearby_list_state,
            );

            // Tooltip logic
            if let Some((selected_e, _)) = nearby.get(state.selected_nearby_index) {
                let mut tools = vec![Span::raw("[A]ssess ")];
                let flags = selected_e.flags;

                // Interact logic: Vendor check or Pickable check
                let is_vendor = flags.intersects(ObjectDescriptionFlag::VENDOR);
                let is_pickable = selected_e
                    .int_properties
                    .get(&16)
                    .map(|&u| (u & 0x20) != 0)
                    .unwrap_or(false); // Usable.Remote

                if is_vendor || is_pickable {
                    tools.push(Span::styled(
                        "[I]nteract ",
                        Style::default().fg(Color::Cyan),
                    ));
                }

                if flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                    tools.push(Span::raw("Attac[k] "));
                }

                tools.push(Span::styled("[D]ebug", Style::default().fg(Color::Yellow)));

                let tooltip =
                    Paragraph::new(Line::from(tools)).block(Block::default().borders(Borders::TOP));
                f.render_widget(tooltip, nearby_inner_chunks[1]);
            }

            // --- Chat Pane ---
            let height = main_chunks[1].height.saturating_sub(2) as usize;
            let total_messages = state.messages.len();

            // Constraint scroll offset to prevent clipping and empty screens
            let max_scroll = total_messages.saturating_sub(height);
            let effective_scroll = state.scroll_offset.min(max_scroll);

            let end = total_messages.saturating_sub(effective_scroll);
            let start = end.saturating_sub(height);

            let mut messages: Vec<ListItem> = state.messages[start..end]
                .iter()
                .map(|m| {
                    let color = match m.kind {
                        MessageKind::Chat => Color::White,
                        MessageKind::Tell => Color::Magenta,
                        MessageKind::Emote => Color::Green,
                        MessageKind::Info => Color::Cyan,
                        MessageKind::System => Color::DarkGray,
                        MessageKind::Error => Color::Red,
                        MessageKind::Warning => Color::Yellow,
                    };
                    ListItem::new(Line::from(vec![Span::styled(
                        &m.text,
                        Style::default().fg(color),
                    )]))
                })
                .collect();

            // Pad with empty items to keep it bottom-aligned if it doesn't fill height
            if messages.len() < height && effective_scroll == 0 {
                let pad_count = height - messages.len();
                let mut padding: Vec<ListItem> =
                    (0..pad_count).map(|_| ListItem::new(" ")).collect();
                padding.append(&mut messages);
                messages = padding;
            }

            let chat_style = if state.focused_pane == FocusedPane::Chat {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            };

            let chat_list = List::new(messages).block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("World Chat")
                    .border_style(chat_style),
            );
            f.render_widget(chat_list, main_chunks[1]);

            // --- Context Pane ---
            let ctx_height = main_chunks[2].height.saturating_sub(2) as usize;
            let total_ctx = state.context_buffer.len();

            let max_ctx_scroll = total_ctx.saturating_sub(ctx_height);
            let effective_ctx_scroll = state.context_scroll_offset.min(max_ctx_scroll);

            let ctx_end = total_ctx.saturating_sub(effective_ctx_scroll);
            let ctx_start = ctx_end.saturating_sub(ctx_height);

            let mut ctx_items: Vec<ListItem> = state.context_buffer[ctx_start..ctx_end]
                .iter()
                .map(|s| ListItem::new(s.clone()))
                .collect();

            // Pad context buffer too
            if ctx_items.len() < ctx_height && effective_ctx_scroll == 0 {
                let pad_count = ctx_height - ctx_items.len();
                let mut padding: Vec<ListItem> =
                    (0..pad_count).map(|_| ListItem::new(" ")).collect();
                padding.append(&mut ctx_items);
                ctx_items = padding;
            }

            let ctx_style = if state.focused_pane == FocusedPane::Context {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            };

            let ctx_list = List::new(ctx_items).block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Context Information")
                    .border_style(ctx_style),
            );
            f.render_widget(ctx_list, main_chunks[2]);
        }
        UIState::CharacterSelection => {
            let items: Vec<ListItem> = state
                .characters
                .iter()
                .enumerate()
                .map(|(i, (_id, name))| {
                    let style = if i == state.selected_character_index {
                        Style::default().fg(Color::Yellow)
                    } else {
                        Style::default().fg(Color::White)
                    };
                    ListItem::new(format!("{}. {}", i + 1, name)).style(style)
                })
                .collect();

            let char_list = List::new(items).block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Character Selection (↑/↓ to select, Enter to play)"),
            );
            f.render_widget(char_list, chunks[1]);
        }
    }

    // 3. Input Area
    let input_style = if state.focused_pane == FocusedPane::Input {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let input_title = "Input ('/quit' to exit)";
    let input_block = Block::default()
        .borders(Borders::ALL)
        .title(input_title)
        .border_style(input_style);
    let input_para = Paragraph::new(state.input.as_str()).block(input_block);
    f.render_widget(input_para, chunks[2]);
}
