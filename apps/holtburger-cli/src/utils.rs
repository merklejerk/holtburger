use crate::types::FocusedPane;
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInt, PropertyString, WorldObjectPropertyAccessors};
use unicode_width::UnicodeWidthStr;

/// Formats an item's display name, including stack size and structure/durability if present.
pub fn format_item_name<T: WorldObjectPropertyAccessors>(item: &T, guid: Guid) -> String {
    let name = item
        .get_string_prop(PropertyString::Name)
        .unwrap_or("Unknown");
    let mut display_name = if name.trim().is_empty() {
        format!("<{}>", guid)
    } else {
        name.to_string()
    };

    let stack_size = item.get_int_prop(PropertyInt::StackSize).unwrap_or(1);
    if stack_size > 1 {
        display_name = format!("{} ({}x)", display_name, stack_size);
    }

    let structure = item.get_int_prop(PropertyInt::Structure);
    let max_structure = item.get_int_prop(PropertyInt::MaxStructure);

    if let (Some(s), Some(ms)) = (structure, max_structure) {
        display_name = format!("{} ({}/{})", display_name, s, ms);
    }

    display_name
}

pub fn format_cost(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.1}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

pub fn wrap_text(text: &str, width: usize) -> Vec<String> {
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
            let word_width = word.width();
            if current_line.is_empty() {
                if word_width > width {
                    let mut s = word.to_string();
                    while s.width() > width {
                        let mut split_idx = 0;
                        let mut current_w = 0;
                        for (idx, c) in s.char_indices() {
                            let cw = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
                            if current_w + cw > width {
                                break;
                            }
                            current_w += cw;
                            split_idx = idx + c.len_utf8();
                        }
                        if split_idx == 0 {
                            split_idx = s.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
                        }
                        let (head, tail) = s.split_at(split_idx);
                        result.push(head.to_string());
                        s = tail.to_string();
                    }
                    current_line = s;
                } else {
                    current_line.push_str(word);
                }
            } else {
                let current_width = current_line.width();
                if current_width + 1 + word_width <= width {
                    current_line.push(' ');
                    current_line.push_str(word);
                } else {
                    result.push(current_line);
                    let mut s = word.to_string();
                    while s.width() > width {
                        let mut split_idx = 0;
                        let mut current_w = 0;
                        for (idx, c) in s.char_indices() {
                            let cw = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
                            if current_w + cw > width {
                                break;
                            }
                            current_w += cw;
                            split_idx = idx + c.len_utf8();
                        }
                        if split_idx == 0 {
                            split_idx = s.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
                        }
                        let (head, tail) = s.split_at(split_idx);
                        result.push(head.to_string());
                        s = tail.to_string();
                    }
                    current_line = s;
                }
            }
        }
        if !current_line.is_empty() {
            result.push(current_line);
        }
    }
    result
}

pub fn get_adjacent_pane(
    current: FocusedPane,
    width: u16,
    active_interaction: bool,
    delta: i32,
) -> FocusedPane {
    let order = get_pane_order(width);
    let n = order.len() as i32;
    let current_idx = order.iter().position(|&p| p == current).unwrap_or(0) as i32;

    let mut next_idx = (current_idx + delta).rem_euclid(n);

    // Skip dynamic if not moving anything
    if order[next_idx as usize] == FocusedPane::Dynamic && !active_interaction {
        next_idx = (next_idx + delta).rem_euclid(n);
    }

    order[next_idx as usize]
}

fn get_pane_order(width: u16) -> [FocusedPane; 4] {
    if width < crate::pages::game::layout::WIDTH_BREAKPOINT {
        // Portrait: Dashboard -> Context -> Dynamic -> Chat
        [
            FocusedPane::Dashboard,
            FocusedPane::Context,
            FocusedPane::Dynamic,
            FocusedPane::Chat,
        ]
    } else {
        // Landscape: Dashboard -> Chat -> Context -> Dynamic
        [
            FocusedPane::Dashboard,
            FocusedPane::Chat,
            FocusedPane::Context,
            FocusedPane::Dynamic,
        ]
    }
}
