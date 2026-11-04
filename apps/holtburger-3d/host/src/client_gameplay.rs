//! App-local selection of server-saved gameplay options; core owns updates and mirroring.

use holtburger_common::CharacterOption;
use holtburger_core::PlayerCharacterOptions;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Only options with implemented Gameplay controls cross this command boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientGameplayOption {
    /// Gameplay control for `UseCraftingChanceOfSuccessDialog`.
    CraftSuccessDialog,
    /// Gameplay control for `ConfirmUseOfRareGems`.
    ConfirmRareUse,
    /// Gameplay control for `LetOtherPlayersGiveYouItems`.
    AllowItemGive,
    /// Gameplay control for `IgnoreAllTradeRequests`.
    IgnoreTradeRequests,
    /// Gameplay control for `IgnoreAllegianceRequests`.
    IgnoreAllegianceRequests,
    /// Gameplay control for `AttemptToDeceiveOtherPlayers`.
    UseDeception,
    /// Gameplay control for `AllowOthersToSeeYourDateOfBirth`.
    ShareBirthDate,
    /// Gameplay control for `AllowOthersToSeeYourAge`.
    ShareAge,
    /// Gameplay control for `AllowOthersToSeeYourNumberOfDeaths`.
    ShareDeaths,
    /// Gameplay control for `AllowOthersToSeeYourNumberOfTitles`.
    ShareTitles,
    /// Gameplay control for `AllowOthersToSeeYourChessRank`.
    ShareChessRank,
    /// Gameplay control for `AllowOthersToSeeYourFishingSkill`.
    ShareFishingSkill,
}

impl From<ClientGameplayOption> for CharacterOption {
    fn from(option: ClientGameplayOption) -> Self {
        match option {
            ClientGameplayOption::CraftSuccessDialog => Self::UseCraftingChanceOfSuccessDialog,
            ClientGameplayOption::ConfirmRareUse => Self::ConfirmUseOfRareGems,
            ClientGameplayOption::AllowItemGive => Self::LetOtherPlayersGiveYouItems,
            ClientGameplayOption::IgnoreTradeRequests => Self::IgnoreAllTradeRequests,
            ClientGameplayOption::IgnoreAllegianceRequests => Self::IgnoreAllegianceRequests,
            ClientGameplayOption::UseDeception => Self::AttemptToDeceiveOtherPlayers,
            ClientGameplayOption::ShareBirthDate => Self::AllowOthersToSeeYourDateOfBirth,
            ClientGameplayOption::ShareAge => Self::AllowOthersToSeeYourAge,
            ClientGameplayOption::ShareDeaths => Self::AllowOthersToSeeYourNumberOfDeaths,
            ClientGameplayOption::ShareTitles => Self::AllowOthersToSeeYourNumberOfTitles,
            ClientGameplayOption::ShareChessRank => Self::AllowOthersToSeeYourChessRank,
            ClientGameplayOption::ShareFishingSkill => Self::AllowOthersToSeeYourFishingSkill,
        }
    }
}

/// Complete locally mirrored option set, shared by snapshots and incremental events.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct ClientGameplayPreferences(BTreeMap<ClientGameplayOption, bool>);

impl From<PlayerCharacterOptions> for ClientGameplayPreferences {
    fn from(options: PlayerCharacterOptions) -> Self {
        Self(
            [
                ClientGameplayOption::CraftSuccessDialog,
                ClientGameplayOption::ConfirmRareUse,
                ClientGameplayOption::AllowItemGive,
                ClientGameplayOption::IgnoreTradeRequests,
                ClientGameplayOption::IgnoreAllegianceRequests,
                ClientGameplayOption::UseDeception,
                ClientGameplayOption::ShareBirthDate,
                ClientGameplayOption::ShareAge,
                ClientGameplayOption::ShareDeaths,
                ClientGameplayOption::ShareTitles,
                ClientGameplayOption::ShareChessRank,
                ClientGameplayOption::ShareFishingSkill,
            ]
            .into_iter()
            .map(|option| (option, options.is_enabled(option.into())))
            .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_runtime::ClientHostCommand;
    use holtburger_common::{CharacterOptions1, CharacterOptions2};
    use serde_json::json;

    #[test]
    fn gameplay_projection_matches_complete_browser_contract_and_preserves_option_bits() {
        let options = PlayerCharacterOptions {
            options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG | CharacterOptions1::ALLOW_GIVE,
            options2: CharacterOptions2::CONFIRM_VOLATILE_RARE_USE | CharacterOptions2::DISPLAY_AGE,
        };
        let mut expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/harness/browser/fixtures/gameplay-preferences.json"
        ))
        .unwrap();
        for key in [
            "craftSuccessDialog",
            "allowItemGive",
            "confirmRareUse",
            "shareAge",
        ] {
            expected[key] = json!(true);
        }
        assert_eq!(
            serde_json::to_value(ClientGameplayPreferences::from(options)).unwrap(),
            expected
        );
    }

    #[test]
    fn gameplay_commands_map_to_the_requested_server_option() {
        for (wire, expected) in [
            (
                "craftSuccessDialog",
                CharacterOption::UseCraftingChanceOfSuccessDialog,
            ),
            ("confirmRareUse", CharacterOption::ConfirmUseOfRareGems),
            (
                "allowItemGive",
                CharacterOption::LetOtherPlayersGiveYouItems,
            ),
            (
                "ignoreTradeRequests",
                CharacterOption::IgnoreAllTradeRequests,
            ),
            (
                "ignoreAllegianceRequests",
                CharacterOption::IgnoreAllegianceRequests,
            ),
            (
                "useDeception",
                CharacterOption::AttemptToDeceiveOtherPlayers,
            ),
            (
                "shareBirthDate",
                CharacterOption::AllowOthersToSeeYourDateOfBirth,
            ),
            ("shareAge", CharacterOption::AllowOthersToSeeYourAge),
            (
                "shareDeaths",
                CharacterOption::AllowOthersToSeeYourNumberOfDeaths,
            ),
            (
                "shareTitles",
                CharacterOption::AllowOthersToSeeYourNumberOfTitles,
            ),
            (
                "shareChessRank",
                CharacterOption::AllowOthersToSeeYourChessRank,
            ),
            (
                "shareFishingSkill",
                CharacterOption::AllowOthersToSeeYourFishingSkill,
            ),
        ] {
            for enabled in [false, true] {
                let command = serde_json::from_value::<ClientHostCommand>(json!({
                    "command": "set_client_gameplay_option", "option": wire, "enabled": enabled,
                }))
                .unwrap();
                match command {
                    ClientHostCommand::SetClientGameplayOption {
                        option,
                        enabled: actual,
                    } => {
                        assert_eq!(CharacterOption::from(option), expected);
                        assert_eq!(actual, enabled);
                    }
                    _ => panic!("Expected a gameplay option command"),
                }
            }
        }
        assert!(serde_json::from_value::<ClientHostCommand>(json!({
            "command": "set_client_gameplay_option", "option": "autoRepeatAttacks", "enabled": true,
        })).is_err());
    }
}
