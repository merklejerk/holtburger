use crate::classification::{self, EntityClass};
use holtburger_core::world::properties::{
    EnchantmentTypeFlags, ObjectDescriptionFlag, PropertyInt, RadarColor,
};
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use holtburger_core::{ChatMessage, ClientState, MessageKind};
use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

// Layout constants
pub const STATUS_BAR_HEIGHT: u16 = 3;
pub const INPUT_AREA_HEIGHT: u16 = 3;
pub const MIN_MAIN_AREA_HEIGHT: u16 = 10;
pub const WIDTH_BREAKPOINT: u16 = 150;

pub const LAYOUT_WIDE_NEARBY_PCT: u16 = 25;
pub const LAYOUT_WIDE_CHAT_PCT: u16 = 50;
pub const LAYOUT_WIDE_CONTEXT_PCT: u16 = 25;

pub const LAYOUT_NARROW_TOP_ROW_PCT: u16 = 50;
pub const LAYOUT_NARROW_BOTTOM_ROW_PCT: u16 = 50;
pub const LAYOUT_NARROW_NEARBY_PCT: u16 = 50;
pub const LAYOUT_NARROW_CONTEXT_PCT: u16 = 50;

// Chat constants
pub const CHAT_HISTORY_WINDOW_SIZE: usize = 200;

// Interaction constants
pub const SCROLL_STEP: usize = 3;
pub const PAGE_SCROLL_STEP: usize = 10;

pub fn get_next_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow: Nearby -> Context -> Chat
        match current {
            FocusedPane::Nearby => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    } else {
        // Wide: Nearby -> Chat -> Context
        match current {
            FocusedPane::Nearby => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    }
}

pub fn get_prev_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow reverse: Nearby -> Chat -> Context
        match current {
            FocusedPane::Nearby => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    } else {
        // Wide reverse: Nearby -> Context -> Chat
        match current {
            FocusedPane::Nearby => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    }
}

pub fn get_layout(area: Rect) -> (Vec<Rect>, Vec<Rect>) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(STATUS_BAR_HEIGHT),
            Constraint::Min(MIN_MAIN_AREA_HEIGHT),
            Constraint::Length(INPUT_AREA_HEIGHT),
        ])
        .split(area);

    let main_chunks = if area.width < WIDTH_BREAKPOINT {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_TOP_ROW_PCT),
                Constraint::Percentage(LAYOUT_NARROW_BOTTOM_ROW_PCT),
            ])
            .split(chunks[1]);

        let top_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_NEARBY_PCT),
                Constraint::Percentage(LAYOUT_NARROW_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        vec![top_chunks[0], vertical_chunks[1], top_chunks[1]]
    } else {
        let horizontal_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_WIDE_NEARBY_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CHAT_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CONTEXT_PCT),
            ])
            .split(chunks[1]);
        vec![
            horizontal_chunks[0],
            horizontal_chunks[1],
            horizontal_chunks[2],
        ]
    };

    (chunks.to_vec(), main_chunks)
}

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
    Effects,
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
    pub player_enchantments: Vec<holtburger_core::protocol::messages::Enchantment>,
    pub entities: std::collections::HashMap<u32, holtburger_core::world::entity::Entity>,
    pub server_time: Option<(f64, std::time::Instant)>,
}

impl AppState {
    pub fn current_server_time(&self) -> f64 {
        match self.server_time {
            Some((server_val, local_then)) => {
                let elapsed = local_then.elapsed().as_secs_f64();
                server_val + elapsed
            }
            None => std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        }
    }
}

pub fn ui(f: &mut Frame, state: &mut AppState) {
    let (chunks, main_chunks_vec) = get_layout(f.size());
    let chunks = &chunks;

    let pos_info = if let Some(pos) = &state.player_pos {
        pos.to_world_coords().to_string_with_precision(2)
    } else {
        "0.00N, 0.00E".to_string()
    };

    let mut retry_info = String::new();
    let now = std::time::Instant::now();
    if let Some((current, max, next_time)) = state.logon_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Logon:{}/{} {}s] ", current, max, secs));
    }
    if let Some((current, max, next_time)) = state.enter_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Enter:{}/{} {}s] ", current, max, secs));
    }

    let status_emoji = match state.core_state {
        ClientState::Connected => "🔌",
        ClientState::CharacterSelection(_) => "👥",
        ClientState::EnteringWorld => "🚪",
        ClientState::InWorld => "🌍",
    };

    let current_char = state.character_name.as_deref().unwrap_or("Selecting...");
    let info_line = format!(
        "{}:{} <{}> {} {}",
        state.account_name, current_char, pos_info, status_emoji, retry_info
    );

    let status_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[0]);

    // Render Vitals (Left Half)
    let health = state
        .vitals
        .iter()
        .find(|v| v.vital_type == VitalType::Health);
    let stamina = state
        .vitals
        .iter()
        .find(|v| v.vital_type == VitalType::Stamina);
    let mana = state
        .vitals
        .iter()
        .find(|v| v.vital_type == VitalType::Mana);

    let health_str = if let Some(h) = health {
        format!("H {}/{}", h.current, h.base)
    } else {
        "H --/--".to_string()
    };
    let stamina_str = if let Some(s) = stamina {
        format!("S {}/{}", s.current, s.base)
    } else {
        "S --/--".to_string()
    };
    let mana_str = if let Some(m) = mana {
        format!("M {}/{}", m.current, m.base)
    } else {
        "M --/--".to_string()
    };

    let vitals_para = Paragraph::new(Line::from(vec![
        Span::styled(health_str, Style::default().fg(Color::Red)),
        Span::raw("  "),
        Span::styled(stamina_str, Style::default().fg(Color::Yellow)),
        Span::raw("  "),
        Span::styled(mana_str, Style::default().fg(Color::Blue)),
    ]))
    .block(Block::default().borders(Borders::ALL).title("Vitals"));
    f.render_widget(vitals_para, status_chunks[0]);

    // Render Info (Right Half)
    let info_para = Paragraph::new(info_line)
        .block(Block::default().borders(Borders::ALL).title("Status"))
        .alignment(ratatui::layout::Alignment::Right);
    f.render_widget(info_para, status_chunks[1]);

    // 2. Main Area
    match state.state {
        UIState::Chat => {
            let main_chunks = &main_chunks_vec;

            // --- Nearby Entities / Inventory / Effects Pane ---
            let mut nearby = Vec::new();
            let nearby_items: Vec<ListItem> = if state.nearby_tab == NearbyTab::Effects {
                // Clamp index for effects
                if state.selected_nearby_index >= state.player_enchantments.len()
                    && !state.player_enchantments.is_empty()
                {
                    state.selected_nearby_index = state.player_enchantments.len().saturating_sub(1);
                }

                state
                    .player_enchantments
                    .iter()
                    .enumerate()
                    .map(|(i, enchant)| {
                        let name = format!("Spell #{}", enchant.spell_id);
                        let beneficial =
                            (enchant.stat_mod_type & EnchantmentTypeFlags::BENEFICIAL.bits()) != 0;
                        let color = if beneficial { Color::Green } else { Color::Red };

                        let time_str = if enchant.duration < 0.0 {
                            "Inf".to_string()
                        } else {
                            let remain = enchant.start_time + enchant.duration;
                            if remain <= 0.0 {
                                "0s".to_string()
                            } else if remain > 60.0 {
                                format!("{}m", (remain / 60.0) as u32)
                            } else {
                                format!("{}s", remain as u32)
                            }
                        };

                        let mod_desc = if (enchant.stat_mod_type
                            & EnchantmentTypeFlags::ATTRIBUTE.bits())
                            != 0
                        {
                            AttributeType::from_repr(enchant.stat_mod_key)
                                .map(|a| a.to_string())
                                .unwrap_or_else(|| format!("Attr #{}", enchant.stat_mod_key))
                        } else if (enchant.stat_mod_type & EnchantmentTypeFlags::SKILL.bits()) != 0
                        {
                            SkillType::from_repr(enchant.stat_mod_key)
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("Skill #{}", enchant.stat_mod_key))
                        } else if (enchant.stat_mod_type & EnchantmentTypeFlags::SECOND_ATT.bits())
                            != 0
                        {
                            match enchant.stat_mod_key {
                                1 => "Health".to_string(),
                                3 => "Stamina".to_string(),
                                5 => "Mana".to_string(),
                                _ => format!("Vital #{}", enchant.stat_mod_key),
                            }
                        } else {
                            format!("Mod #{}", enchant.stat_mod_key)
                        };

                        let style = if i == state.selected_nearby_index {
                            Style::default().bg(Color::DarkGray)
                        } else {
                            Style::default()
                        };

                        let duration_color = if i == state.selected_nearby_index {
                            Color::White
                        } else {
                            Color::DarkGray
                        };

                        ListItem::new(Line::from(vec![
                            Span::styled(format!("{:<15} ", name), Style::default().fg(color)),
                            Span::raw(format!("(L{}) -> {} ", enchant.layer, mod_desc)),
                            Span::styled(
                                format!("{:+}", enchant.stat_mod_value),
                                Style::default().fg(Color::Cyan),
                            ),
                            Span::styled(
                                format!(" [{}]", time_str),
                                Style::default().fg(duration_color),
                            ),
                        ]))
                        .style(style)
                    })
                    .collect()
            } else {
                let nearby_filtered: Vec<_> = state
                    .entities
                    .values()
                    .filter(|e| {
                        if state.nearby_tab == NearbyTab::Entities {
                            classification::is_targetable(e) && e.position.landblock_id != 0
                        } else if state.nearby_tab == NearbyTab::Inventory {
                            // Inventory items or things without coordinates
                            e.position.landblock_id == 0 && !e.name.is_empty()
                        } else {
                            false
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

                nearby = nearby_filtered;
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

                nearby
                    .iter()
                    .enumerate()
                    .map(|(i, (e, _dist))| {
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
                            let dist = if let Some(p) = &state.player_pos {
                                e.position.distance_to(p)
                            } else {
                                0.0
                            };
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
                    .collect()
            };

            let nearby_style = if state.focused_pane == FocusedPane::Nearby {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            };

            let title = match state.nearby_tab {
                NearbyTab::Entities => " [1] Nearby |  2  Packs |  3  Stats |  4  Effects ",
                NearbyTab::Inventory => "  1  Nearby | [2] Packs |  3  Stats |  4  Effects ",
                NearbyTab::Character => "  1  Nearby |  2  Packs | [3] Stats |  4  Effects ",
                NearbyTab::Effects => "  1  Nearby |  2  Packs |  3  Stats | [4] Effects ",
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
            if state.nearby_tab == NearbyTab::Effects && !state.player_enchantments.is_empty() {
                let tools = vec![Span::raw("[D]ebug ")];
                let tools_para = Paragraph::new(Line::from(tools))
                    .block(Block::default().borders(Borders::NONE))
                    .alignment(ratatui::layout::Alignment::Center);
                f.render_widget(tools_para, nearby_inner_chunks[1]);
            } else if (state.nearby_tab == NearbyTab::Entities
                || state.nearby_tab == NearbyTab::Inventory)
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
            let window_size = CHAT_HISTORY_WINDOW_SIZE;
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
