use crate::types::Interaction;
use holtburger_common::Guid;
use holtburger_common::properties::{ItemType, WorldObjectExt};
use holtburger_core::ActionResultReason;
use holtburger_core::errors::format_weenie_error;
use holtburger_protocol::errors::WeenieError;
use holtburger_world::crafting::salvage::get_material_name;
use std::collections::HashSet;
use unicode_width::UnicodeWidthStr;

/// Formats an item's display name, including stack size and structure/durability if present.
pub fn format_item_name<T: WorldObjectExt>(item: &T, guid: Guid) -> String {
    let name = item.name();
    let mut display_name = if name.trim().is_empty() {
        format!("<{}>", guid)
    } else {
        name.to_string()
    };

    if item
        .item_type()
        .is_some_and(|it| it.contains(ItemType::TINKERING_MATERIAL))
        && let Some(mat_type) = item.material_type()
    {
        let mat_name = get_material_name(mat_type);
        display_name = format!("{} {}", mat_name, display_name);
    }

    // Strip out count suffix from salvage bags since we append our own structure suffix.
    let is_salvage = item
        .item_type()
        .is_some_and(|item_type| item_type.contains(ItemType::TINKERING_MATERIAL));
    if is_salvage && let Some(idx) = display_name.rfind(" (") {
        display_name.truncate(idx);
    }

    let stack_size = item.stack_size();
    if stack_size > 1 {
        display_name = format!("{} ({}x)", display_name, stack_size);
    }

    let structure = item.structure();
    let max_structure = item.max_structure();

    if let (Some(s), Some(ms)) = (structure, max_structure) {
        display_name = format!("{} ({}/{})", display_name, s, ms);
    }

    display_name
}

pub fn format_duration(seconds: f64) -> String {
    if seconds >= 3600.0 {
        format!("{:.1}h", seconds / 3600.0)
    } else if seconds >= 60.0 {
        format!("{:.1}m", seconds / 60.0)
    } else {
        format!("{:.0}s", seconds)
    }
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

pub fn format_action_result_message(reason: &ActionResultReason) -> String {
    match reason {
        ActionResultReason::Weenie(error, parameter) => {
            format_weenie_error(*error, parameter.as_deref())
        }
        ActionResultReason::InventoryServerSaveFailed { item_guid, error } => {
            if *error == WeenieError::None {
                format!("Inventory save failed for {:?}", item_guid)
            } else {
                format!(
                    "Inventory save failed for {:?}: {}",
                    item_guid,
                    format_weenie_error(*error, None)
                )
            }
        }
        ActionResultReason::Character(error) => format!("Character error: {:?}", error),
        ActionResultReason::General(message) | ActionResultReason::Transport(message) => {
            message.clone()
        }
    }
}

pub fn active_interaction_subject_guid(interaction: Option<Interaction>) -> Option<Guid> {
    match interaction {
        Some(Interaction::Moving { item_guid }) | Some(Interaction::Combining { item_guid }) => {
            Some(item_guid)
        }
        Some(Interaction::Targeting { target_guid })
        | Some(Interaction::Approaching { target_guid })
        | Some(Interaction::Following { target_guid }) => Some(target_guid),
        Some(Interaction::Salvaging) | None => None,
    }
}

pub fn normalize_filter_tokens(pattern: &str) -> Vec<String> {
    pattern
        .split_whitespace()
        .map(|token| token.to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect()
}

pub fn fuzzy_subsequence_match(needle: &str, haystack: &str) -> bool {
    if needle.is_empty() {
        return true;
    }

    let mut needle_chars = needle.chars().map(|c| c.to_ascii_lowercase());
    let mut current = needle_chars.next();

    for haystack_char in haystack.chars().map(|c| c.to_ascii_lowercase()) {
        if Some(haystack_char) == current {
            current = needle_chars.next();
            if current.is_none() {
                return true;
            }
        }
    }

    false
}

pub fn retain_matching_hierarchy<T, FGuid, FDepth, FMatch>(
    items: Vec<T>,
    guid_of: FGuid,
    depth_of: FDepth,
    mut matches: FMatch,
) -> Vec<T>
where
    FGuid: Fn(&T) -> Guid,
    FDepth: Fn(&T) -> usize,
    FMatch: FnMut(&T) -> bool,
{
    let mut included_guids = HashSet::new();
    let mut ancestor_path = Vec::new();

    for item in &items {
        let depth = depth_of(item);
        ancestor_path.truncate(depth);

        if matches(item) {
            included_guids.insert(guid_of(item));
            included_guids.extend(ancestor_path.iter().copied());
        }

        ancestor_path.push(guid_of(item));
    }

    items
        .into_iter()
        .filter(|item| included_guids.contains(&guid_of(item)))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct TestHierarchyEntry {
        guid: Guid,
        depth: usize,
        name: &'static str,
    }

    #[test]
    fn normalize_filter_tokens_lowercases_and_skips_empty_segments() {
        assert_eq!(
            normalize_filter_tokens("  HeL   wor LD  "),
            vec!["hel", "wor", "ld"]
        );
    }

    #[test]
    fn fuzzy_subsequence_match_is_case_insensitive() {
        assert!(fuzzy_subsequence_match("hlg", "Healing Kit"));
        assert!(fuzzy_subsequence_match("KIT", "healing kit"));
        assert!(!fuzzy_subsequence_match("hzk", "Healing Kit"));
    }

    #[test]
    fn format_action_result_message_preserves_inventory_save_item_guid() {
        let reason = ActionResultReason::InventoryServerSaveFailed {
            item_guid: Guid(0x4000_0001),
            error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
        };

        assert_eq!(
            format_action_result_message(&reason),
            "Inventory save failed for 0x40000001: You're too busy!"
        );
    }

    #[test]
    fn retain_matching_hierarchy_keeps_ancestor_chain_only_for_matches() {
        let items = vec![
            TestHierarchyEntry {
                guid: Guid(1),
                depth: 0,
                name: "Pack",
            },
            TestHierarchyEntry {
                guid: Guid(2),
                depth: 1,
                name: "Nested Pack",
            },
            TestHierarchyEntry {
                guid: Guid(3),
                depth: 2,
                name: "Healing Kit",
            },
            TestHierarchyEntry {
                guid: Guid(4),
                depth: 1,
                name: "Mana Stone",
            },
        ];

        let visible = retain_matching_hierarchy(
            items,
            |item| item.guid,
            |item| item.depth,
            |item| item.name == "Healing Kit",
        );

        assert_eq!(
            visible
                .into_iter()
                .map(|item| item.guid)
                .collect::<Vec<_>>(),
            vec![Guid(1), Guid(2), Guid(3)]
        );
    }
}
