use crate::pages::game::combat::AttackActivity;
use crate::pages::game::{GameData, ViewState};
use crate::theme::{pane_block, pane_title_style};
use crate::types::{FocusedPane, Interaction};
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_world::crafting::salvage::{SalvagePreviewBag, get_material_name};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use unicode_width::UnicodeWidthStr;

const TARGET_HEALTH_BAR_WIDTH: usize = 12;

pub fn render_dynamic_pane(f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
    let combat_color = match data.combat_mode {
        CombatMode::Melee => Some(Color::LightRed),
        CombatMode::Missile => Some(Color::LightRed),
        CombatMode::Magic => Some(Color::Cyan),
        _ => None,
    };

    let is_focused = view.focused_pane == FocusedPane::Dynamic;
    let mut block = pane_block(is_focused);

    if let Some(color) = combat_color {
        block = block.border_style(Style::default().fg(color).add_modifier(Modifier::BOLD));
    }

    // Left title: Interaction Info / World Name (if needed)
    if let Some(interaction) = view.active_interaction {
        let title_text = format!(
            " {} | [ESC] to cancel ",
            match interaction {
                Interaction::Targeting { .. } => "Targeting",
                Interaction::Approaching { .. } => "Approaching",
                Interaction::Following { .. } => "Following",
                Interaction::Moving { .. } => "Moving",
                Interaction::Combining { .. } => "Combining",
                Interaction::Salvaging => "Salvaging",
            }
        );

        block = block.title_top(
            Line::from(Span::styled(title_text, pane_title_style(is_focused))).left_aligned(),
        );
    }

    if view.active_busy_operation.is_some() {
        block = block.title_top(
            Line::from(Span::styled(
                busy_title(),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK),
            ))
            .centered(),
        );
    }

    // Right title: Combat Mode
    block = block.title_top(
        Line::from(Span::styled(
            format!(" [`] Combat mode: {} ", combat_mode_label(data.combat_mode)),
            Style::default().add_modifier(Modifier::BOLD),
        ))
        .right_aligned(),
    );

    let inner = block.inner(area);
    f.render_widget(block, area);

    let control_line = combat_controls_line(data, view);
    let max_control_width = inner.width.saturating_sub(1);
    let control_width = control_line
        .as_ref()
        .map(|line| line.to_string().width() as u16 + 1)
        .unwrap_or(0)
        .min(max_control_width);

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Fill(1), Constraint::Length(control_width)])
        .split(inner);

    // --- 1. Interaction Info / World Name ---
    if let Some(interaction) = view.active_interaction {
        if interaction == Interaction::Salvaging {
            let preview = view
                .salvaging
                .as_ref()
                .map(|session| data.salvage_preview(&session.queued_items))
                .unwrap_or_else(|| data.salvage_preview(&[]));

            let mut line_spans = vec![
                Span::raw("  "),
                Span::styled(
                    format!("{} items", preview.item_count),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::raw(" for "),
            ];
            line_spans.extend(format_salvage_results(&preview.bags).spans);

            let line = Line::from(line_spans);

            f.render_widget(Paragraph::new(line), chunks[0]);
            return;
        }

        let target_guid = match interaction {
            Interaction::Moving { item_guid } => item_guid,
            Interaction::Targeting { target_guid } => target_guid,
            Interaction::Approaching { target_guid } => target_guid,
            Interaction::Following { target_guid } => target_guid,
            Interaction::Combining { item_guid } => item_guid,
            Interaction::Salvaging => unreachable!(),
        };

        let (name, guid, health_fraction) = if let Some(entity) = data.entities.get(&target_guid) {
            (entity.name(), entity.guid.0, entity.health_fraction)
        } else {
            ("Unknown Entity", target_guid.0, None)
        };

        let line = format_target_line(name, Guid(guid), health_fraction);

        f.render_widget(Paragraph::new(line), chunks[0]);
    } else {
        let info = format_world_info(data);
        f.render_widget(Paragraph::new(info), chunks[0]);
    }

    if let Some(control_line) = control_line
        && control_width > 0
    {
        f.render_widget(Paragraph::new(control_line).right_aligned(), chunks[1]);
    }
}

fn combat_mode_label(mode: CombatMode) -> &'static str {
    match mode {
        CombatMode::Undef => "PEACE",
        CombatMode::NonCombat => "🕊️ PEACE",
        CombatMode::Melee => "🔪 MELEE",
        CombatMode::Missile => "🏹 MISSILE",
        CombatMode::Magic => "✨ MAGIC",
    }
}

fn busy_title() -> &'static str {
    " (BUSY...) "
}

fn format_world_info(data: &GameData) -> String {
    let current_char = data.character_name.as_deref().unwrap_or("In World");
    let server = if data.world_name.is_empty() {
        "Unknown Server"
    } else {
        &data.world_name
    };

    let account_name = if data.account_name.is_empty() {
        "Unknown Account"
    } else {
        data.account_name.as_str()
    };

    let mut info = format!(" {}:{} on {} ", account_name, current_char, server);

    if let Some(party) = data.party.as_ref() {
        let party_name = if party.name.trim().is_empty() {
            "(unnamed)"
        } else {
            party.name.trim()
        };
        info.push_str(&format!("| Party: {} ", party_name));
    }

    info
}

fn format_target_line(name: &str, guid: Guid, health_fraction: Option<f32>) -> Line<'static> {
    let mut spans = vec![
        Span::raw("  "),
        Span::styled(
            name.to_string(),
            Style::default()
                .add_modifier(Modifier::BOLD)
                .fg(Color::Yellow),
        ),
        Span::styled(
            format!(" ({:#010X})", guid.0),
            Style::default().fg(Color::Gray),
        ),
    ];

    if let Some(health_fraction) = health_fraction {
        spans.push(Span::raw(" "));
        spans.extend(health_bar_spans(health_fraction));
    }

    Line::from(spans)
}

fn health_bar_spans(health_fraction: f32) -> Vec<Span<'static>> {
    let health_fraction = health_fraction.clamp(0.0, 1.0);
    let filled_width = (health_fraction * TARGET_HEALTH_BAR_WIDTH as f32).round() as usize;
    let label = format!("{:>3}%", (health_fraction * 100.0).round() as u32);
    let label_chars: Vec<char> = label.chars().collect();
    let label_start = (TARGET_HEALTH_BAR_WIDTH.saturating_sub(label_chars.len())) / 2;

    let mut cells = vec![' '; TARGET_HEALTH_BAR_WIDTH];
    for (idx, ch) in label_chars.into_iter().enumerate() {
        if let Some(cell) = cells.get_mut(label_start + idx) {
            *cell = ch;
        }
    }

    let mut spans = Vec::with_capacity(TARGET_HEALTH_BAR_WIDTH + 2);
    spans.push(Span::styled("[", Style::default().fg(Color::DarkGray)));

    for (idx, ch) in cells.into_iter().enumerate() {
        let filled = idx < filled_width;
        let bg = if filled { Color::Green } else { Color::Red };
        let fg = if filled { Color::Black } else { Color::White };
        spans.push(Span::styled(
            ch.to_string(),
            Style::default().fg(fg).bg(bg).add_modifier(Modifier::BOLD),
        ));
    }

    spans.push(Span::styled("]", Style::default().fg(Color::DarkGray)));
    spans
}

fn combat_controls_line(data: &GameData, _view: &ViewState) -> Option<Line<'static>> {
    let profile_label = match data.combat_controls.profile_level {
        crate::pages::game::data::CombatProfileLevel::Low => "Low",
        crate::pages::game::data::CombatProfileLevel::Medium => "Medium",
        crate::pages::game::data::CombatProfileLevel::High => "High",
    };

    let height_label = match data.combat_controls.attack_height {
        AttackHeight::High => "High",
        AttackHeight::Medium => "Medium",
        AttackHeight::Low => "Low",
    };

    let attack_activity = data.combat_runtime.attack_activity(data.combat_mode);

    match data.combat_mode {
        CombatMode::Melee | CombatMode::Missile => {
            let mut spans = Vec::new();

            if let Some(activity) = attack_activity {
                spans.push(attack_indicator_span(activity));
                spans.push(Span::raw("  "));
            }

            let profile_name = match data.combat_mode {
                CombatMode::Melee => "Powe[r]",
                _ => "Accu[r]acy",
            };

            spans.push(Span::styled(
                format!(
                    "{}: {}  [H]eight: {} ",
                    profile_name, profile_label, height_label
                ),
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ));

            Some(Line::from(spans))
        }
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
    }
}

fn attack_indicator_span(activity: AttackActivity) -> Span<'static> {
    let (marker, style) = match activity {
        AttackActivity::Ready => (
            " 😠 ",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK),
        ),
        AttackActivity::Active => (
            " 😡 ",
            Style::default()
                .fg(Color::LightRed)
                .add_modifier(Modifier::BOLD | Modifier::RAPID_BLINK),
        ),
    };

    Span::styled(marker.to_string(), style)
}

fn format_salvage_results(bags: &[SalvagePreviewBag]) -> Line<'static> {
    if bags.is_empty() {
        return Line::from("no salvage");
    }

    let mut spans = Vec::new();
    for (i, bag) in bags.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw(", "));
        }
        spans.push(Span::styled(
            format!("{} ", get_material_name(bag.material_type)),
            Style::default()
                .add_modifier(Modifier::BOLD)
                .fg(Color::Yellow),
        ));
        spans.push(Span::styled(
            format!("{}u", bag.units),
            Style::default().add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::raw(" @ "));
        spans.push(Span::styled(
            format!("{:.2} WS", bag.workmanship),
            Style::default().add_modifier(Modifier::BOLD),
        ));
    }

    Line::from(spans)
}

#[cfg(test)]
mod tests {
    use super::{
        TARGET_HEALTH_BAR_WIDTH, attack_indicator_span, busy_title, combat_controls_line,
        format_target_line, format_world_info, health_bar_spans, render_dynamic_pane,
    };
    use crate::pages::game::combat::{AttackActivity, CombatIssueState};
    use crate::pages::game::{GameData, ViewState};
    use crate::types::Interaction;
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_core::BusyOperationKind;
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
    use holtburger_world::entity::Entity;
    use holtburger_world::state::FellowshipState;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::style::Color;

    #[test]
    fn melee_controls_use_full_labels_and_tiny_indicator() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::Melee;
        let view = ViewState::default();

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.contains("Powe[r]: Medium"));
        assert!(text.contains("[H]eight: Medium"));
        assert!(!text.ends_with("||"));
        assert!(!text.ends_with("||||"));
    }

    #[test]
    fn missile_controls_show_ready_indicator_with_target() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::Missile;
        data.combat_runtime.issue_state = CombatIssueState::Ready;
        data.combat_controls.attack_height = AttackHeight::High;
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting {
                target_guid: Default::default(),
            }),
            ..ViewState::default()
        };

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.contains("Accu[r]acy: Medium"));
        assert!(text.contains("[H]eight: High"));
        assert!(text.contains(" 😠 "));
    }

    #[test]
    fn peace_mode_has_no_attack_indicator_line() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::NonCombat;
        let view = ViewState::default();

        assert!(combat_controls_line(&data, &view).is_none());
    }

    #[test]
    fn magic_mode_has_no_attack_indicator_line() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::Magic;
        let view = ViewState::default();

        assert!(combat_controls_line(&data, &view).is_none());
    }

    #[test]
    fn combat_controls_show_active_indicator_while_attack_is_in_flight() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::Melee;
        data.combat_runtime.issue_state = CombatIssueState::InFlight;
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting {
                target_guid: Default::default(),
            }),
            ..ViewState::default()
        };

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.contains(" 😡 "));
    }

    #[test]
    fn ready_indicator_uses_short_bar() {
        assert_eq!(attack_indicator_span(AttackActivity::Ready).content, " 😠 ");
    }

    #[test]
    fn active_indicator_uses_shared_bar() {
        assert_eq!(
            attack_indicator_span(AttackActivity::Active).content,
            " 😡 "
        );
    }

    #[test]
    fn targeting_without_ready_issue_state_shows_no_indicator() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.combat_mode = CombatMode::Missile;
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting {
                target_guid: Default::default(),
            }),
            ..ViewState::default()
        };

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(!text.contains(" 😠 "));
        assert!(!text.contains(" 😡 "));
    }

    #[test]
    fn world_info_includes_party_name_when_in_party() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.account_name = "acct".to_string();
        data.party = Some(FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x50000001),
            share_xp: true,
            even_share: false,
            open: false,
            is_locked: false,
            members: Vec::new(),
            departed_members: Vec::new(),
            locks: Vec::new(),
        });

        assert_eq!(
            format_world_info(&data),
            " acct:Player on World | Party: Raid Bus "
        );
    }

    #[test]
    fn world_info_uses_unnamed_party_fallback() {
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        data.account_name = "acct".to_string();
        data.party = Some(FellowshipState {
            name: "   ".to_string(),
            leader_guid: Guid(0x50000001),
            share_xp: true,
            even_share: false,
            open: false,
            is_locked: false,
            members: Vec::new(),
            departed_members: Vec::new(),
            locks: Vec::new(),
        });

        assert_eq!(
            format_world_info(&data),
            " acct:Player on World | Party: (unnamed) "
        );
    }

    #[test]
    fn targeting_line_formats_guid_and_health_bar_when_available() {
        let target_guid = Guid(0x60000001);
        let mut data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        let mut entity = Entity::new(target_guid, "Drudge".to_string(), WorldPosition::default());
        entity.health_fraction = Some(0.66);
        data.entities.insert(target_guid, entity);

        let view = ViewState {
            active_interaction: Some(Interaction::Targeting { target_guid }),
            ..ViewState::default()
        };

        let area = Rect::new(0, 0, 80, 3);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        terminal
            .draw(|frame| render_dynamic_pane(frame, &data, &view, area))
            .expect("dynamic pane should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("Drudge (0x60000001)"));
        assert!(rendered.contains("66%"));
    }

    #[test]
    fn target_health_bar_uses_fixed_width_two_color_bar_with_overlay_text() {
        let spans = health_bar_spans(0.66);
        let content = spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert_eq!(content.len(), TARGET_HEALTH_BAR_WIDTH + 2);
        assert!(content.starts_with('['));
        assert!(content.ends_with(']'));
        assert!(content.contains("66%"));
        assert!(spans.iter().any(|span| span.style.bg == Some(Color::Green)));
        assert!(spans.iter().any(|span| span.style.bg == Some(Color::Red)));
    }

    #[test]
    fn target_line_places_health_bar_after_name_and_guid() {
        let line = format_target_line("Drudge", Guid(0x60000001), Some(0.66));

        assert_eq!(line.to_string(), "  Drudge (0x60000001) [     66%    ]");
    }

    #[test]
    fn busy_title_uses_centered_busy_banner() {
        assert_eq!(busy_title(), " (BUSY...) ");
    }

    #[test]
    fn active_busy_operation_renders_centered_busy_banner_in_title() {
        let data = GameData::new(
            Default::default(),
            "Player".to_string(),
            "World".to_string(),
        );
        let view = ViewState {
            active_busy_operation: Some(BusyOperationKind::Sell),
            ..ViewState::default()
        };

        let area = Rect::new(0, 0, 80, 3);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        terminal
            .draw(|frame| render_dynamic_pane(frame, &data, &view, area))
            .expect("dynamic pane should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("(BUSY...)"));
    }
}
