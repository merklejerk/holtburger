//! TUI-owned recall syntax; destination behavior remains in core.

use anyhow::{Result, bail};
use holtburger_core::client::recall::RecallDestination;

/// Recognize retail travel commands before sending ordinary speech to ACE.
/// Unknown commands remain server chat; malformed recognized recalls fail locally.
pub(super) fn parse_recall_command(text: &str) -> Result<Option<RecallDestination>> {
    let Some(command) = text.trim().strip_prefix(['@', '/']) else {
        return Ok(None);
    };
    let mut words = command.split_whitespace();
    let Some(verb) = words.next() else {
        return Ok(None);
    };
    // Retail registrations: acclient.c:409594–409909 and 410236–410436.
    let destination = match verb.to_ascii_lowercase().as_str() {
        "lifestone" | "lif" | "ls" => RecallDestination::Lifestone,
        "marketplace" | "mar" | "mp" => RecallDestination::Marketplace,
        "pkarena" | "pka" => RecallDestination::PkArena,
        "pklarena" | "pla" => RecallDestination::PkLiteArena,
        "hor" | "hr" => RecallDestination::House,
        "hom" | "hoa" => RecallDestination::AllegianceHousing,
        "house" | "hou" => match words.next().map(str::to_ascii_lowercase).as_deref() {
            // DoHouse: acclient.c:406889–406929.
            Some("recall" | "re") => RecallDestination::House,
            Some("mansion_recall" | "alleg_recall" | "ma") => RecallDestination::AllegianceHousing,
            _ => return Ok(None),
        },
        "allegiance" | "all" => match words.next().map(str::to_ascii_lowercase).as_deref() {
            // DoAllegiance: acclient.c:404233–404245.
            // Retail dispatches hometown immediately, without checking trailing arguments.
            Some("hometown" | "ho") => return Ok(Some(RecallDestination::AllegianceHometown)),
            _ => return Ok(None),
        },
        _ => return Ok(None),
    };
    if words.next().is_some() {
        bail!("Recall commands do not accept extra arguments");
    }
    Ok(Some(destination))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retail_aliases_accept_both_prefixes_and_case() {
        use RecallDestination::*;
        for (destination, commands) in [
            (Lifestone, vec!["ls", "lif", "lifestone"]),
            (Marketplace, vec!["mp", "mar", "marketplace"]),
            (House, vec!["hr", "hor", "house recall", "hou re"]),
            (
                AllegianceHousing,
                vec![
                    "hom",
                    "hoa",
                    "house mansion_recall",
                    "house alleg_recall",
                    "hou ma",
                ],
            ),
            (AllegianceHometown, vec!["allegiance hometown", "all ho"]),
            (PkArena, vec!["pkarena", "pka"]),
            (PkLiteArena, vec!["pklarena", "pla"]),
        ] {
            for command in commands {
                for prefix in ['@', '/'] {
                    let text = format!("  {prefix}{}  ", command.to_uppercase());
                    assert_eq!(
                        parse_recall_command(&text).unwrap(),
                        Some(destination),
                        "{text}"
                    );
                }
            }
        }
        assert_eq!(
            parse_recall_command("@house guest add Someone").unwrap(),
            None
        );
        assert_eq!(parse_recall_command("@allegiance info").unwrap(), None);
        assert_eq!(parse_recall_command("meet me at @ls").unwrap(), None);
        assert!(parse_recall_command("@ls extra").is_err());
        assert!(parse_recall_command("@house recall extra").is_err());
    }
}
