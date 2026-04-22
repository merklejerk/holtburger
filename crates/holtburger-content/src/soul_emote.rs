use holtburger_dat::file_type::ChatPoseTable;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default)]
pub struct SoulEmoteCatalog {
    pub tokens: BTreeMap<String, SoulEmoteToken>,
    pub poses: BTreeMap<String, SoulEmotePose>,
}

impl SoulEmoteCatalog {
    pub fn from_asset(table: &ChatPoseTable) -> Self {
        let tokens = table
            .chat_pose_hash
            .iter()
            .map(|(token, pose)| {
                (
                    token.clone(),
                    SoulEmoteToken {
                        token: token.clone(),
                        pose: pose.clone(),
                    },
                )
            })
            .collect();

        let poses = table
            .chat_emote_hash
            .iter()
            .map(|(pose, emote)| {
                (
                    pose.clone(),
                    SoulEmotePose {
                        pose: pose.clone(),
                        my_emote: emote.my_emote.clone(),
                        other_emote: emote.other_emote.clone(),
                    },
                )
            })
            .collect();

        Self { tokens, poses }
    }

    pub fn is_known_token(&self, token: &str) -> bool {
        self.tokens.contains_key(token)
    }

    pub fn token(&self, token: &str) -> Option<&SoulEmoteToken> {
        self.tokens.get(token)
    }

    pub fn pose(&self, pose: &str) -> Option<&SoulEmotePose> {
        self.poses.get(pose)
    }

    pub fn resolve(&self, token: &str) -> Option<SoulEmoteResolution<'_>> {
        let token_entry = self.tokens.get(token)?;

        let pose_entry = self.poses.get(token_entry.pose.as_str());

        Some(SoulEmoteResolution {
            token: token_entry.token.as_str(),
            pose: token_entry.pose.as_str(),
            my_emote: pose_entry.map(|entry| entry.my_emote.as_str()),
            other_emote: pose_entry.map(|entry| entry.other_emote.as_str()),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoulEmoteToken {
    pub token: String,
    pub pose: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoulEmotePose {
    pub pose: String,
    pub my_emote: String,
    pub other_emote: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoulEmoteResolution<'a> {
    pub token: &'a str,
    pub pose: &'a str,
    pub my_emote: Option<&'a str>,
    pub other_emote: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::{ChatEmoteData, ChatPoseTable};
    use std::collections::HashMap;

    #[test]
    fn catalog_resolves_tokens_and_pose_text() {
        let table = ChatPoseTable {
            id: ChatPoseTable::FILE_ID,
            chat_pose_hash: HashMap::from([("wave".to_string(), "Wave".to_string())]),
            chat_emote_hash: HashMap::from([(
                "Wave".to_string(),
                ChatEmoteData {
                    my_emote: "wave.".to_string(),
                    other_emote: "waves.".to_string(),
                },
            )]),
        };

        let catalog = SoulEmoteCatalog::from_asset(&table);
        let resolved = catalog.resolve("wave").expect("token should resolve");

        assert_eq!(resolved.pose, "Wave");
        assert_eq!(resolved.my_emote, Some("wave."));
        assert_eq!(resolved.other_emote, Some("waves."));
    }

    #[test]
    fn catalog_preserves_known_token_without_pose_text() {
        let table = ChatPoseTable {
            id: ChatPoseTable::FILE_ID,
            chat_pose_hash: HashMap::from([("mystery".to_string(), "Mystery".to_string())]),
            chat_emote_hash: HashMap::new(),
        };

        let catalog = SoulEmoteCatalog::from_asset(&table);
        let resolved = catalog
            .resolve("mystery")
            .expect("token should still resolve by pose");

        assert_eq!(resolved.pose, "Mystery");
        assert_eq!(resolved.my_emote, None);
        assert_eq!(resolved.other_emote, None);
    }
}
