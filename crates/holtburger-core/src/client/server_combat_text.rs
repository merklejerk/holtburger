//! Exact outgoing health/resistance grammars from ACE; unknown text stays ordinary chat.

use super::types::ServerTextCombatOutcomeKind;
use holtburger_protocol::messages::{ChatMessageType, ChatMessageTypeId};

/// Candidate context appropriate to the evidence supplied by a text family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TextCombatSource<'a> {
    /// The message explicitly names the spell; both names must corroborate a cast.
    NamedSpell(&'a str),
    /// Resistance names only the defender and must use recent casts.
    Resistance,
    /// Periodic/proc messages can originate from physical attacks or spells.
    Periodic,
}

/// Borrowed parsing facts are consumed once by core attribution, never exported to rendering.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct ParsedCombatText<'a> {
    /// Exact public defender name used by the attribution owner.
    pub defender_name: &'a str,
    /// Family-derived candidate selection; never inferred by the consumer.
    pub source: TextCombatSource<'a>,
    /// Confirmed damage/critical or resistance facts consumed by typed delivery.
    pub kind: ServerTextCombatOutcomeKind,
}

// ACE Entity/Strings.cs GetAttackVerb singular forms; not arbitrary language matching.
const ATTACK_VERBS: [&str; 37] = [
    "hit",
    "mangle",
    "slash",
    "cut",
    "scratch",
    "gore",
    "impale",
    "stab",
    "nick",
    "crush",
    "smash",
    "bash",
    "graze",
    "incinerate",
    "burn",
    "scorch",
    "singe",
    "freeze",
    "frost",
    "chill",
    "numb",
    "dissolve",
    "corrode",
    "sear",
    "blister",
    "blast",
    "jolt",
    "shock",
    "spark",
    "eradicate",
    "wither",
    "twist",
    "scar",
    "deplete",
    "siphon",
    "exhaust",
    "drain",
];
const AUGMENTATION_SUFFIX: &str = " Your critical hit was avoided with their augmentation!";

/// Multiple valid delimiter decompositions are ambiguous even if their amounts agree.
fn unique<'a>(
    mut candidates: impl Iterator<Item = ParsedCombatText<'a>>,
) -> Option<ParsedCombatText<'a>> {
    let candidate = candidates.next()?;
    candidates.next().is_none().then_some(candidate)
}

fn splits<'a>(text: &'a str, delimiter: &'a str) -> impl Iterator<Item = (&'a str, &'a str)> {
    text.match_indices(delimiter)
        .map(move |(index, _)| (&text[..index], &text[index + delimiter.len()..]))
}

fn amount(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn after_verb(text: &str) -> Option<&str> {
    let (verb, rest) = text.split_once(' ')?;
    ATTACK_VERBS.contains(&verb).then_some(rest)
}

fn damage<'a>(
    defender: &'a str,
    source: TextCombatSource<'a>,
    amount: u32,
    critical_hit: bool,
) -> Option<ParsedCombatText<'a>> {
    (!defender.is_empty()).then_some(ParsedCombatText {
        defender_name: defender,
        source,
        kind: ServerTextCombatOutcomeKind::Damage {
            amount,
            critical_hit,
        },
    })
}

/// SpellProjectile.DamageTarget: fixed ordered prefixes and an optional avoided-crit suffix.
fn projectile(text: &str) -> Option<ParsedCombatText<'_>> {
    let critical_hit = text.starts_with("Critical hit! ");
    let text = text.strip_prefix("Critical hit! ").unwrap_or(text);
    let text = text.strip_prefix("Overpower! ").unwrap_or(text);
    let text = text.strip_prefix("Sneak Attack! ").unwrap_or(text);
    let text = text
        .strip_suffix(AUGMENTATION_SUFFIX)
        .unwrap_or(text)
        .strip_suffix('.')?;
    let text = after_verb(text.strip_prefix("You ")?)?;
    unique(splits(text, " for ").flat_map(|(defender, rest)| {
        splits(rest, " points with ").filter_map(move |(number, spell)| {
            if spell.is_empty() {
                return None;
            }
            damage(
                defender,
                TextCombatSource::NamedSpell(spell),
                amount(number)?,
                critical_hit,
            )
        })
    }))
}

/// WorldObject_Magic boost/drain only: transfer gains and other vitals are excluded.
fn direct_drain(text: &str) -> Option<ParsedCombatText<'_>> {
    let text = text.strip_prefix("With ")?.strip_suffix('.')?;
    unique(splits(text, " you drain ").flat_map(|(spell, rest)| {
        splits(rest, " points of health from ").filter_map(move |(number, defender)| {
            if spell.is_empty() {
                return None;
            }
            damage(
                defender,
                TextCombatSource::NamedSpell(spell),
                amount(number)?,
                false,
            )
        })
    }))
}

/// Monster_Combat.TakeDamageOverTime_NotifySource aggregates outgoing health ticks.
fn periodic<'a>(text: &'a str, ending: &str, fixed_bleed: bool) -> Option<ParsedCombatText<'a>> {
    let text = text.strip_suffix(ending)?;
    let text = if fixed_bleed {
        text.strip_prefix("You bleed ")?
    } else {
        after_verb(text.strip_prefix("You ")?)?
    };
    unique(splits(text, " for ").filter_map(|(defender, number)| {
        damage(defender, TextCombatSource::Periodic, amount(number)?, false)
    }))
}

fn affliction(text: &str) -> Option<ParsedCombatText<'_>> {
    let text = after_verb(
        text.strip_prefix("With Surge of Affliction you ")?
            .strip_suffix('!')?,
    )?;
    unique(
        splits(text, " points of health from ").filter_map(|(number, defender)| {
            damage(defender, TextCombatSource::Periodic, amount(number)?, false)
        }),
    )
}

/// Recognize only actual network system text on its source-defined channel.
pub(super) fn recognize(chat_type: ChatMessageTypeId, text: &str) -> Option<ParsedCombatText<'_>> {
    match chat_type.known()? {
        ChatMessageType::Magic => unique(
            [
                projectile(text),
                direct_drain(text),
                periodic(text, " points of periodic nether damage!", false),
                affliction(text),
                text.strip_suffix(" resists your spell")
                    .filter(|name| !name.is_empty())
                    .map(|defender_name| ParsedCombatText {
                        defender_name,
                        source: TextCombatSource::Resistance,
                        kind: ServerTextCombatOutcomeKind::Resisted,
                    }),
            ]
            .into_iter()
            .flatten(),
        ),
        ChatMessageType::CombatSelf => periodic(text, " points of periodic health damage!", true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_attack_verbs_and_ordered_prefixes_preserve_exact_names_and_amounts() {
        for verb in ATTACK_VERBS {
            for prefix in [
                "",
                "Critical hit! ",
                "Overpower! ",
                "Sneak Attack! ",
                "Critical hit! Overpower! Sneak Attack! ",
            ] {
                let text =
                    format!("{prefix}You {verb} Drudge, Jr. for 0 points with Acid's Arc VII.");
                assert_eq!(
                    recognize(ChatMessageType::Magic.into(), &text),
                    Some(ParsedCombatText {
                        defender_name: "Drudge, Jr.",
                        source: TextCombatSource::NamedSpell("Acid's Arc VII"),
                        kind: ServerTextCombatOutcomeKind::Damage {
                            amount: 0,
                            critical_hit: prefix.starts_with("Critical hit!")
                        },
                    })
                );
            }
            let text = format!("You {verb} Drudge for 42 points of periodic nether damage!");
            assert_eq!(
                recognize(ChatMessageType::Magic.into(), &text)
                    .unwrap()
                    .kind,
                ServerTextCombatOutcomeKind::Damage {
                    amount: 42,
                    critical_hit: false
                }
            );
            let text =
                format!("With Surge of Affliction you {verb} 42 points of health from Drudge!");
            assert_eq!(
                recognize(ChatMessageType::Magic.into(), &text)
                    .unwrap()
                    .source,
                TextCombatSource::Periodic
            );
        }
    }

    #[test]
    fn six_families_channels_and_augmentation_avoidance() {
        for (channel, text, source, kind) in [
            (
                ChatMessageType::Magic,
                "You burn Drudge for 4294967295 points with Flame. Your critical hit was avoided with their augmentation!",
                TextCombatSource::NamedSpell("Flame"),
                ServerTextCombatOutcomeKind::Damage {
                    amount: u32::MAX,
                    critical_hit: false,
                },
            ),
            (
                ChatMessageType::Magic,
                "With Harm Other VII you drain 12 points of health from Drudge.",
                TextCombatSource::NamedSpell("Harm Other VII"),
                ServerTextCombatOutcomeKind::Damage {
                    amount: 12,
                    critical_hit: false,
                },
            ),
            (
                ChatMessageType::CombatSelf,
                "You bleed Drudge for 1 points of periodic health damage!",
                TextCombatSource::Periodic,
                ServerTextCombatOutcomeKind::Damage {
                    amount: 1,
                    critical_hit: false,
                },
            ),
            (
                ChatMessageType::Magic,
                "Drudge resists your spell",
                TextCombatSource::Resistance,
                ServerTextCombatOutcomeKind::Resisted,
            ),
        ] {
            let parsed = recognize(channel.into(), text).unwrap();
            assert_eq!(parsed.defender_name, "Drudge");
            assert_eq!(parsed.source, source);
            assert_eq!(parsed.kind, kind);
            assert!(recognize(ChatMessageType::Speech.into(), text).is_none());
            assert!(recognize(ChatMessageTypeId::Unknown(999), text).is_none());
        }
    }

    #[test]
    fn unsupported_incoming_malformed_and_ambiguous_text_stays_chat_only() {
        for text in [
            "You burn Drudge for -1 points with Flame.",
            "You burn Drudge for +1 points with Flame.",
            "You burn Drudge for 1.5 points with Flame.",
            "You burn Drudge for 4294967296 points with Flame.",
            "You burn Drudge for 1 points with Flame. junk",
            "You burn  for 1 points with Flame.",
            "You burn Drudge for 1 points with .",
            "You obliterate Drudge for 1 points with Flame.",
            "Sneak Attack! Critical hit! You burn Drudge for 1 points with Flame.",
            "With Harm you drain 1 points of mana from Drudge.",
            "With Harm you restore 1 points of health to Drudge.",
            "With Harm you drain 1 points of your health.",
            "You gain 1 points of health due to casting Drain Health on Drudge.",
            "Drudge burns you for 1 points with Flame.",
            "You resist the spell cast by Drudge",
            "You fail to affect Drudge.",
            "Drudge resists your spell.",
            " resists your spell",
            "You bleed Drudge for 1 points of periodic health damage!",
            // Both defender/spell decompositions are grammatical; no first-delimiter guess.
            "You burn Drudge for 1 points with Flame for 2 points with Frost.",
            "With Harm you drain 1 points of health from Drudge you drain 2 points of health from Other.",
        ] {
            assert!(
                recognize(ChatMessageType::Magic.into(), text).is_none(),
                "{text}"
            );
        }
    }
}
