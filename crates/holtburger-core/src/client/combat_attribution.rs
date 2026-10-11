//! Conservative correlation of name-only server feedback with successful attack and cast requests.

use super::server_combat_text::TextCombatSource;
use super::types::CombatOutcomeAttribution;
use holtburger_common::Guid;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Recent targets are hints, not a guarantee about projectile travel time.
const ATTRIBUTION_HISTORY_LIFETIME: Duration = Duration::from_secs(8);
/// Bounds each history independently of the server's automatic repeat loop.
const MAX_RECENT_TARGETS: usize = 8;

/// A successfully sent target whose public name may not yet have been received.
#[derive(Debug)]
struct AttackTarget {
    guid: Guid,
    name: Option<String>,
}

/// One retired engagement retained briefly for committed swings and in-flight missiles.
#[derive(Debug)]
struct RetiredTarget {
    target: AttackTarget,
    retired_at: Instant,
}

/// A successful targeted cast retained independently of physical repeat engagement.
#[derive(Debug)]
struct RecentCast {
    /// Resolved outgoing target and its captured public name.
    target: AttackTarget,
    /// Validated catalog name consumed by named spell damage correlation.
    spell_name: String,
    /// Successful send time; busy completion does not change expiry.
    sent_at: Instant,
}

/// Owns attribution hints only; the engagement runtime owns attack lifecycle decisions.
#[derive(Debug, Default)]
pub(super) struct CombatOutcomeAttributor {
    active: Option<AttackTarget>,
    retired: VecDeque<RetiredTarget>,
    /// One-shot casts have their own bounded lifetime, independent of physical repeat.
    casts: VecDeque<RecentCast>,
}

impl CombatOutcomeAttributor {
    /// Called only after a physical attack request was successfully sent.
    pub(super) fn sent(&mut self, guid: Guid, name: Option<&str>, now: Instant) {
        if self
            .active
            .as_ref()
            .is_some_and(|target| target.guid != guid)
        {
            self.retire(now);
        }
        self.retired.retain(|entry| entry.target.guid != guid);
        self.active = Some(AttackTarget {
            guid,
            name: name.map(str::to_owned),
        });
    }

    /// Terminal feedback retires active context, while ordinary refill feedback does not.
    pub(super) fn retire(&mut self, now: Instant) {
        if let Some(target) = self.active.take() {
            self.retired.push_back(RetiredTarget {
                target,
                retired_at: now,
            });
            while self.retired.len() > MAX_RECENT_TARGETS {
                self.retired.pop_front();
            }
        }
    }

    /// Retained same-name creatures veto ambiguity; they never establish attack context.
    pub(super) fn resolve(
        &mut self,
        defender_name: &str,
        matching_creatures: impl Iterator<Item = Guid>,
        now: Instant,
    ) -> CombatOutcomeAttribution {
        self.retired
            .retain(|entry| now.duration_since(entry.retired_at) < ATTRIBUTION_HISTORY_LIFETIME);
        resolve_candidates(
            defender_name,
            self.active
                .iter()
                .chain(self.retired.iter().map(|entry| &entry.target)),
            matching_creatures,
        )
    }

    /// Successful sends refresh a pair; spell completion never retires this history.
    pub(super) fn sent_cast(
        &mut self,
        guid: Guid,
        name: Option<&str>,
        spell_name: &str,
        now: Instant,
    ) {
        self.casts
            .retain(|entry| entry.target.guid != guid || entry.spell_name != spell_name);
        self.casts.push_back(RecentCast {
            target: AttackTarget {
                guid,
                name: name.map(str::to_owned),
            },
            spell_name: spell_name.to_owned(),
            sent_at: now,
        });
        while self.casts.len() > MAX_RECENT_TARGETS {
            self.casts.pop_front();
        }
    }

    /// Select source-appropriate hints, then use the same conservative identity decision.
    pub(super) fn resolve_text(
        &mut self,
        defender_name: &str,
        source: TextCombatSource<'_>,
        matching_creatures: impl Iterator<Item = Guid>,
        now: Instant,
    ) -> CombatOutcomeAttribution {
        self.casts
            .retain(|entry| now.duration_since(entry.sent_at) < ATTRIBUTION_HISTORY_LIFETIME);
        self.retired
            .retain(|entry| now.duration_since(entry.retired_at) < ATTRIBUTION_HISTORY_LIFETIME);
        let casts = self
            .casts
            .iter()
            .filter(|entry| match source {
                TextCombatSource::NamedSpell(spell) => entry.spell_name == spell,
                TextCombatSource::Resistance | TextCombatSource::Periodic => true,
            })
            .map(|entry| &entry.target);
        let physical = self
            .active
            .iter()
            .chain(self.retired.iter().map(|entry| &entry.target))
            .filter(|_| source == TextCombatSource::Periodic);
        resolve_candidates(defender_name, casts.chain(physical), matching_creatures)
    }

    /// World/session discontinuities invalidate all correlation hints.
    pub(super) fn clear(&mut self) {
        self.active = None;
        self.retired.clear();
        self.casts.clear();
    }
}

/// Same-GUID hints corroborate one identity; any different GUID vetoes it.
fn resolve_candidates<'a>(
    defender_name: &str,
    candidates: impl Iterator<Item = &'a AttackTarget>,
    matching_creatures: impl Iterator<Item = Guid>,
) -> CombatOutcomeAttribution {
    let mut candidates = candidates.filter(|target| target.name.as_deref() == Some(defender_name));
    let Some(candidate) = candidates.next() else {
        return CombatOutcomeAttribution::Unplaced;
    };
    if candidates.any(|other| other.guid != candidate.guid)
        || matching_creatures
            .into_iter()
            .any(|guid| guid != candidate.guid)
    {
        return CombatOutcomeAttribution::Unplaced;
    }
    CombatOutcomeAttribution::Attributed {
        target: candidate.guid,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cast_sources_refresh_expire_and_share_identity_veto_without_overwriting_physical() {
        let mut owner = CombatOutcomeAttributor::default();
        let now = Instant::now();
        owner.sent(Guid(1), Some("Drudge"), now);
        owner.sent_cast(Guid(2), Some("Drudge"), "Flame", now);
        owner.sent_cast(Guid(2), Some("Drudge"), "Frost", now);
        owner.sent_cast(Guid(2), Some("Drudge"), "Flame", now);
        assert_eq!(owner.casts.len(), 2);
        for source in [
            TextCombatSource::NamedSpell("Flame"),
            TextCombatSource::NamedSpell("Frost"),
            TextCombatSource::Resistance,
        ] {
            assert_eq!(
                owner.resolve_text("Drudge", source, [].into_iter(), now),
                CombatOutcomeAttribution::Attributed { target: Guid(2) }
            );
        }
        assert_eq!(
            owner.resolve("Drudge", [].into_iter(), now),
            CombatOutcomeAttribution::Attributed { target: Guid(1) }
        );
        assert_eq!(
            owner.resolve_text("Drudge", TextCombatSource::Periodic, [].into_iter(), now),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::NamedSpell("Other"),
                [].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::Resistance,
                [Guid(3)].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
        owner.sent_cast(Guid(3), Some("Drudge"), "Flame", now);
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::NamedSpell("Flame"),
                [].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::Resistance,
                [].into_iter(),
                now + ATTRIBUTION_HISTORY_LIFETIME
            ),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::Periodic,
                [].into_iter(),
                now + ATTRIBUTION_HISTORY_LIFETIME
            ),
            CombatOutcomeAttribution::Attributed { target: Guid(1) }
        );
        owner.sent_cast(
            Guid(2),
            Some("Drudge"),
            "Flame",
            now + ATTRIBUTION_HISTORY_LIFETIME,
        );
        owner.clear();
        assert_eq!(
            owner.resolve_text(
                "Drudge",
                TextCombatSource::Resistance,
                [].into_iter(),
                now + ATTRIBUTION_HISTORY_LIFETIME
            ),
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[test]
    fn casts_are_bounded_and_missing_names_never_establish_identity() {
        let mut owner = CombatOutcomeAttributor::default();
        let now = Instant::now();
        for index in 0..=MAX_RECENT_TARGETS {
            owner.sent_cast(
                Guid(index as u32),
                Some(&format!("Target {index}")),
                "Flame",
                now,
            );
        }
        assert_eq!(owner.casts.len(), MAX_RECENT_TARGETS);
        assert_eq!(
            owner.resolve_text(
                "Target 0",
                TextCombatSource::Resistance,
                [].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
        owner.sent_cast(Guid(100), None, "Flame", now);
        owner.sent_cast(Guid(101), Some("Unknown"), "Other Spell", now);
        assert_eq!(
            owner.resolve_text(
                "Target 100",
                TextCombatSource::NamedSpell("Flame"),
                [].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve_text(
                "Unknown",
                TextCombatSource::NamedSpell("Flame"),
                [].into_iter(),
                now
            ),
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[test]
    fn active_repeat_survives_history_expiry_but_duplicate_creatures_veto_it() {
        let mut owner = CombatOutcomeAttributor::default();
        let start = Instant::now();
        owner.sent(Guid(1), Some("Drudge"), start);
        let later = start + ATTRIBUTION_HISTORY_LIFETIME * 2;
        assert_eq!(
            owner.resolve("Drudge", [Guid(1)].into_iter(), later),
            CombatOutcomeAttribution::Attributed { target: Guid(1) }
        );
        assert_eq!(
            owner.resolve("Drudge", [Guid(1), Guid(2)].into_iter(), later),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve("Other", [Guid(3)].into_iter(), later),
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[test]
    fn retired_missiles_remain_ambiguous_until_expiry_and_reset_clears_everything() {
        let mut owner = CombatOutcomeAttributor::default();
        let start = Instant::now();
        owner.sent(Guid(1), Some("Drudge"), start);
        owner.retire(start);
        owner.sent(Guid(2), Some("Drudge"), start);
        assert_eq!(
            owner.resolve("Drudge", [Guid(2)].into_iter(), start),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve(
                "Drudge",
                [Guid(2)].into_iter(),
                start + ATTRIBUTION_HISTORY_LIFETIME
            ),
            CombatOutcomeAttribution::Attributed { target: Guid(2) }
        );
        owner.clear();
        assert_eq!(
            owner.resolve(
                "Drudge",
                [Guid(2)].into_iter(),
                start + ATTRIBUTION_HISTORY_LIFETIME
            ),
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[test]
    fn refresh_and_missing_names_do_not_create_extra_candidates() {
        let mut owner = CombatOutcomeAttributor::default();
        let now = Instant::now();
        owner.sent(Guid(1), None, now);
        assert_eq!(
            owner.resolve("Unknown", [].into_iter(), now),
            CombatOutcomeAttribution::Unplaced
        );
        owner.sent(Guid(1), Some("Drudge"), now);
        owner.retire(now);
        owner.sent(Guid(1), Some("Drudge"), now);
        assert!(owner.retired.is_empty());
        assert_eq!(
            owner.resolve("Drudge", [].into_iter(), now),
            CombatOutcomeAttribution::Attributed { target: Guid(1) }
        );
    }

    #[test]
    fn bounded_history_retires_oldest_context_but_preserves_recent_delayed_outcomes() {
        let mut owner = CombatOutcomeAttributor::default();
        let now = Instant::now();
        for index in 0..=MAX_RECENT_TARGETS {
            owner.sent(Guid(index as u32), Some(&format!("Target {index}")), now);
            owner.retire(now);
        }
        assert_eq!(owner.retired.len(), MAX_RECENT_TARGETS);
        assert_eq!(
            owner.resolve("Target 0", [].into_iter(), now),
            CombatOutcomeAttribution::Unplaced
        );
        assert_eq!(
            owner.resolve(&format!("Target {MAX_RECENT_TARGETS}"), [].into_iter(), now),
            CombatOutcomeAttribution::Attributed {
                target: Guid(MAX_RECENT_TARGETS as u32)
            }
        );
    }
}
