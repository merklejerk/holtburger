use crate::classification::{self, EntityClass};
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
    Character,
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
    pub chat_total_lines: usize,
    pub nearby_tab: NearbyTab,
    pub context_buffer: Vec<String>,
    pub context_scroll_offset: usize,
    pub logon_retry: Option<(u32, u32, Option<std::time::Instant>)>,
    pub enter_retry: Option<(u32, u32, Option<std::time::Instant>)>,
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

    let mut retry_info = String::new();
    let now = std::time::Instant::now();
    if let Some((current, max, next_time)) = state.logon_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Logon Retry {}/{} ({}s)] ", current, max, secs));
    }
    if let Some((current, max, next_time)) = state.enter_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Enter Retry {}/{} ({}s)] ", current, max, secs));
    }

    let status_line = format!(
        " [Account: {}] [Char: {}] [Pos: {}] [State: {:?}] {}",
        state.account_name, char_info, pos_info, state.core_state, retry_info
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
                        classification::is_targetable(e) && e.position.landblock_id != 0
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

                    let type_marker = match classification::classify_entity(e) {
                        EntityClass::Player => "Player",
                        EntityClass::Npc => "NPC",
                        EntityClass::Monster => "Mob",
                        EntityClass::Weapon => "Weapon",
                        EntityClass::Armor => "Armor",
                        EntityClass::Jewelry => "Jewelry",
                        EntityClass::Apparel => "Apparel",
                        EntityClass::Door => "Door",
                        EntityClass::Portal => "Portal",
                        EntityClass::LifeStone => "LifeStone",
                        EntityClass::Chest => "Chest",
                        EntityClass::Tool => "Tool",
                        EntityClass::StaticObject => "Static",
                        EntityClass::Dynamic => "Dynamic",
                        EntityClass::Unknown => "?",
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
                NearbyTab::Entities => " [1] Nearby |  2  Packs |  3  Stats ",
                NearbyTab::Inventory => "  1  Nearby | [2] Packs |  3  Stats ",
                NearbyTab::Character => "  1  Nearby |  2  Packs | [3] Stats ",
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

            if state.nearby_tab == NearbyTab::Character {
                let mut lines = Vec::new();

                lines.push(Line::from(vec![Span::styled(
                    "--- Vitals ---",
                    Style::default().add_modifier(Modifier::BOLD),
                )]));
                for vital in &state.vitals {
                    lines.push(Line::from(format!(
                        "  {:<10} {:>3} / {:>3}",
                        vital.vital_type, vital.current, vital.base
                    )));
                }

                lines.push(Line::from(""));
                lines.push(Line::from(vec![Span::styled(
                    "--- Attributes ---",
                    Style::default().add_modifier(Modifier::BOLD),
                )]));
                let mut sorted_attrs = state.attributes.clone();
                sorted_attrs.sort_by_key(|a| a.attr_type as u32);
                for attr in sorted_attrs {
                    lines.push(Line::from(format!(
                        "  {:<10} {:>3}",
                        attr.attr_type, attr.base
                    )));
                }

                lines.push(Line::from(""));
                lines.push(Line::from(vec![Span::styled(
                    "--- Skills ---",
                    Style::default().add_modifier(Modifier::BOLD),
                )]));
                let mut sorted_skills = state.skills.clone();
                sorted_skills.sort_by_key(|s| s.skill_type as u32);
                for skill in sorted_skills {
                    if skill.skill_type.is_eor() {
                        lines.push(Line::from(format!(
                            "  {:<15} {:>3}",
                            skill.skill_type.to_string(),
                            skill.current
                        )));
                    }
                }

                let para = Paragraph::new(lines).block(Block::default());
                f.render_widget(para, nearby_inner_chunks[0]);
            } else {
                let nearby_list = List::new(nearby_items)
                    .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                    .highlight_symbol("> ");

                state
                    .nearby_list_state
                    .select(Some(state.selected_nearby_index));
                f.render_stateful_widget(
                    nearby_list,
                    nearby_inner_chunks[0],
                    &mut state.nearby_list_state,
                );
            }

            f.render_widget(nearby_block, main_chunks[0]);

            // Tooltip logic
            if state.nearby_tab != NearbyTab::Character
                && let Some((selected_e, _)) = nearby.get(state.selected_nearby_index)
            {
                let mut tools = vec![Span::raw("[A]ssess ")];
                let flags = selected_e.flags;

                // Interact logic: Vendor check or Pickable check
                let is_vendor = flags.intersects(ObjectDescriptionFlag::VENDOR);
                let is_pickable = selected_e
                    .int_properties
                    .get(&16)
                    .map(|&u| (u & 0x20) != 0)
                    .unwrap_or(false);

                if is_vendor {
                    tools.push(Span::raw("[V]endor "));
                }
                if is_pickable {
                    tools.push(Span::raw("[I]tem "));
                }

                if flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                    tools.push(Span::raw("[K]ill "));
                }

                tools.push(Span::raw("[D]ebug"));

                let tooltip =
                    Paragraph::new(Line::from(tools)).block(Block::default().borders(Borders::TOP));
                f.render_widget(tooltip, nearby_inner_chunks[1]);
            }

            // --- Chat Pane ---
            let width = main_chunks[1].width.saturating_sub(2) as usize;
            let height = main_chunks[1].height.saturating_sub(2) as usize;

            // Use a sliding window of recent messages for wrapping performance
            let window_size = 200;
            let m_len = state.messages.len();
            let window_start = m_len.saturating_sub(window_size);

            let mut all_lines = Vec::new();
            for m in &state.messages[window_start..] {
                let color = match m.kind {
                    MessageKind::Chat => Color::White,
                    MessageKind::Tell => Color::Magenta,
                    MessageKind::Emote => Color::Green,
                    MessageKind::Info => Color::Cyan,
                    MessageKind::System => Color::DarkGray,
                    MessageKind::Error => Color::Red,
                    MessageKind::Warning => Color::Yellow,
                };

                let wrapped = wrap_text(&m.text, width);
                for line in wrapped {
                    all_lines.push((line, color));
                }
            }

            let total_lines = all_lines.len();
            if state.chat_total_lines > 0
                && total_lines > state.chat_total_lines
                && state.scroll_offset > 0
            {
                state.scroll_offset += total_lines - state.chat_total_lines;
            }
            state.chat_total_lines = total_lines;
            let max_scroll = total_lines.saturating_sub(height);
            let effective_scroll = state.scroll_offset.min(max_scroll);

            let end = total_lines.saturating_sub(effective_scroll);
            let start = end.saturating_sub(height);

            let mut messages: Vec<ListItem> = all_lines[start..end]
                .iter()
                .map(|(text, color)| {
                    ListItem::new(Line::from(vec![Span::styled(
                        text,
                        Style::default().fg(*color),
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

            let chat_title = if state.scroll_offset > 0 {
                format!(" World Chat ({} lines up) [SCROLLED] ", state.scroll_offset)
            } else {
                " World Chat ".to_string()
            };

            let chat_list = List::new(messages).block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(chat_title)
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

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut result = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            result.push(String::new());
            continue;
        }
        let mut current_line = String::new();
        for word in line.split(' ') {
            if current_line.is_empty() {
                if word.len() > width {
                    let mut s = word;
                    while s.len() > width {
                        let (head, tail) = s.split_at(width);
                        result.push(head.to_string());
                        s = tail;
                    }
                    current_line = s.to_string();
                } else {
                    current_line.push_str(word);
                }
            } else if current_line.len() + 1 + word.len() <= width {
                current_line.push(' ');
                current_line.push_str(word);
            } else {
                result.push(current_line);
                if word.len() > width {
                    let mut s = word;
                    while s.len() > width {
                        let (head, tail) = s.split_at(width);
                        result.push(head.to_string());
                        s = tail;
                    }
                    current_line = s.to_string();
                } else {
                    current_line = word.to_string();
                }
            }
        }
        if !current_line.is_empty() {
            result.push(current_line);
        }
    }
    result
}
