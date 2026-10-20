use anyhow::{Result, ensure};
use holtburger_dat::file_type::ChatPoseTable;
use serde::Serialize;
use std::collections::BTreeMap;

/// Authored emote strings indexed by retail's case-insensitive identities.
#[derive(Debug, Clone, Default)]
pub struct SoulEmoteCatalog {
    tokens: BTreeMap<String, SoulEmoteToken>,
    poses: BTreeMap<String, SoulEmotePose>,
}

impl SoulEmoteCatalog {
    /// Reject ambiguous case-folded content rather than choosing by hash iteration order.
    pub fn from_asset(table: &ChatPoseTable) -> Result<Self> {
        let mut catalog = Self::default();
        let mut poses: Vec<_> = table.chat_emote_hash.iter().collect();
        poses.sort_by_key(|(pose, _)| *pose);
        for (pose, emote) in poses {
            let entry = SoulEmotePose {
                pose: pose.clone(),
                my_emote: emote.my_emote.clone(),
                other_emote: emote.other_emote.clone(),
            };
            if let Some(previous) = catalog.poses.get(&pose.to_ascii_lowercase()) {
                ensure!(
                    previous.my_emote == entry.my_emote
                        && previous.other_emote == entry.other_emote,
                    "conflicting soul-emote pose spellings: {} and {pose}",
                    previous.pose
                );
            } else {
                catalog.poses.insert(pose.to_ascii_lowercase(), entry);
            }
        }
        let mut tokens: Vec<_> = table.chat_pose_hash.iter().collect();
        tokens.sort_by_key(|(token, _)| *token);
        // Pose spellings without text still have one deterministic authored representative.
        let mut identities = BTreeMap::new();
        for (_, pose) in &tokens {
            identities
                .entry(pose.to_ascii_lowercase())
                .or_insert_with(|| (*pose).clone());
        }
        for (token, pose) in tokens {
            let canonical = match catalog.pose(pose) {
                Some(entry) => entry.pose.clone(),
                None => identities[&pose.to_ascii_lowercase()].clone(),
            };
            if let Some(previous) = catalog.token(token) {
                ensure!(
                    previous.pose == canonical,
                    "conflicting soul-emote alias spellings: {} and {token}",
                    previous.token
                );
            } else {
                catalog.tokens.insert(
                    token.to_ascii_lowercase(),
                    SoulEmoteToken {
                        token: token.clone(),
                        pose: canonical,
                    },
                );
            }
        }
        Ok(catalog)
    }

    /// Canonical alias index used by diagnostics; authored spelling lives in each value.
    pub fn tokens(&self) -> &BTreeMap<String, SoulEmoteToken> {
        &self.tokens
    }

    /// Canonical pose index used by diagnostics.
    pub fn poses(&self) -> &BTreeMap<String, SoulEmotePose> {
        &self.poses
    }

    pub fn is_known_token(&self, token: &str) -> bool {
        self.token(token).is_some()
    }

    pub fn token(&self, token: &str) -> Option<&SoulEmoteToken> {
        self.tokens.get(&token.to_ascii_lowercase())
    }

    pub fn pose(&self, pose: &str) -> Option<&SoulEmotePose> {
        self.poses.get(&pose.to_ascii_lowercase())
    }

    pub fn resolve(&self, token: &str) -> Option<SoulEmoteResolution<'_>> {
        let token_entry = self.token(token)?;
        let pose_entry = self.pose(&token_entry.pose);
        Some(SoulEmoteResolution {
            token: &token_entry.token,
            pose: &token_entry.pose,
            my_emote: pose_entry.map(|entry| entry.my_emote.as_str()),
            other_emote: pose_entry.map(|entry| entry.other_emote.as_str()),
        })
    }

    /// Static reference data groups aliases once for completion and pose-based usage history.
    pub fn references(&self) -> Vec<SoulEmoteReference> {
        let mut references = BTreeMap::new();
        for token in self.tokens.values() {
            let id = token.pose.to_ascii_lowercase();
            let reference = references.entry(id.clone()).or_insert_with(|| {
                let text = self.pose(&token.pose);
                SoulEmoteReference {
                    id,
                    pose: token.pose.clone(),
                    aliases: Vec::new(),
                    my_emote: text.map(|text| text.my_emote.clone()),
                    other_emote: text.map(|text| text.other_emote.clone()),
                }
            });
            reference.aliases.push(token.token.clone());
        }
        references.into_values().collect()
    }
}

/// One authored alias and its resolved canonical pose spelling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoulEmoteToken {
    /// Original alias spelling; chat delimiters are not part of this string.
    pub token: String,
    /// Canonical authored pose spelling.
    pub pose: String,
}

/// Authored self and broadcast templates for a pose.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoulEmotePose {
    /// Original motion name.
    pub pose: String,
    /// Authored self template.
    pub my_emote: String,
    /// Authored broadcast template.
    pub other_emote: String,
}

/// Borrowed execution facts; absent text never invents an authored template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoulEmoteResolution<'a> {
    /// Authored alias spelling.
    pub token: &'a str,
    /// Canonical authored pose spelling.
    pub pose: &'a str,
    /// Optional authored self template.
    pub my_emote: Option<&'a str>,
    /// Optional authored broadcast template.
    pub other_emote: Option<&'a str>,
}

/// Lossless static reference consumed by emote discovery and usage history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoulEmoteReference {
    /// Case-independent identity owned by this catalog, used for deduplication.
    pub id: String,
    /// Canonical authored motion name.
    pub pose: String,
    /// Accepted alias spellings in deterministic order.
    pub aliases: Vec<String>,
    /// Optional authored self template, without frontend formatting.
    pub my_emote: Option<String>,
    /// Optional authored broadcast template, without frontend formatting.
    pub other_emote: Option<String>,
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

        let catalog = SoulEmoteCatalog::from_asset(&table).unwrap();
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

        let catalog = SoulEmoteCatalog::from_asset(&table).unwrap();
        let resolved = catalog
            .resolve("mystery")
            .expect("token should still resolve by pose");

        assert_eq!(resolved.pose, "Mystery");
        assert_eq!(resolved.my_emote, None);
        assert_eq!(resolved.other_emote, None);
    }
    #[test]
    fn aliases_group_under_case_independent_authored_pose() {
        let table = ChatPoseTable {
            chat_pose_hash: HashMap::from([
                ("Hi".into(), "wave".into()),
                ("wave".into(), "WAVE".into()),
            ]),
            chat_emote_hash: HashMap::from([(
                "Wave".into(),
                ChatEmoteData {
                    my_emote: "You wave.".into(),
                    other_emote: "waves.".into(),
                },
            )]),
            ..Default::default()
        };
        let catalog = SoulEmoteCatalog::from_asset(&table).unwrap();
        let resolution = catalog.resolve("HI").unwrap();
        assert_eq!(resolution.token, "Hi");
        assert_eq!(resolution.pose, "Wave");
        assert_eq!(resolution.my_emote, Some("You wave."));
        let references = catalog.references();
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].id, "wave");
        assert_eq!(references[0].aliases, ["Hi", "wave"]);
        assert!(catalog.resolve("missing").is_none());
    }

    #[test]
    fn ambiguous_case_folded_content_fails_instead_of_silently_overwriting() {
        let mut table = ChatPoseTable {
            chat_pose_hash: HashMap::from([
                ("Hi".into(), "Wave".into()),
                ("hi".into(), "Bow".into()),
            ]),
            ..Default::default()
        };
        assert!(
            SoulEmoteCatalog::from_asset(&table)
                .unwrap_err()
                .to_string()
                .contains("alias spellings")
        );
        table.chat_pose_hash.clear();
        table.chat_emote_hash = HashMap::from([
            (
                "Wave".into(),
                ChatEmoteData {
                    my_emote: "You wave.".into(),
                    other_emote: "waves.".into(),
                },
            ),
            (
                "WAVE".into(),
                ChatEmoteData {
                    my_emote: "Different.".into(),
                    other_emote: "waves.".into(),
                },
            ),
        ]);
        assert!(
            SoulEmoteCatalog::from_asset(&table)
                .unwrap_err()
                .to_string()
                .contains("pose spellings")
        );
    }
}
