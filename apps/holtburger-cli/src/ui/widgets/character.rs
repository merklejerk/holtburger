use ratatui::style::{Color, Style, Modifier};
use ratatui::text::{Line, Span};
use ratatui::widgets::ListItem;
use super::super::state::AppState;

pub fn get_character_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let mut items = Vec::new();
    let header_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    // Attributes
    items.push(ListItem::new(Line::from(vec![Span::styled(
        " ATTRIBUTES ",
        header_style,
    )])));
    let mut sorted_attrs = state.attributes.clone();
    sorted_attrs.sort_by_key(|a| a.attr_type as u32);
    for attr in sorted_attrs {
        let val_str = if attr.current != attr.base {
            format!("{} ({})", attr.base, attr.current)
        } else {
            attr.base.to_string()
        };
        items.push(ListItem::new(Line::from(format!(
            "  {:<15} {:>10}",
            attr.attr_type, val_str
        ))));
    }

    items.push(ListItem::new(Line::from("")));

    // Skills
    items.push(ListItem::new(Line::from(vec![Span::styled(
        " SKILLS ",
        header_style,
    )])));
    let mut sorted_skills = state.skills.clone();
    sorted_skills.sort_by_key(|s| s.skill_type as u32);
    for skill in sorted_skills {
        if skill.skill_type.is_eor() {
            let val_str = if skill.current != skill.base {
                format!("{} ({})", skill.base, skill.current)
            } else {
                skill.current.to_string()
            };
            items.push(ListItem::new(Line::from(format!(
                "  {:<20} {:>10}",
                skill.skill_type.to_string(),
                val_str
            ))));
        }
    }
    items
}
