//! Immutable contract reference data and safely parsed authored counter formats.

use holtburger_dat::file_type::{ContractDefinition, ContractTable};
use std::collections::BTreeMap;

/// A single integer substitution surrounded by literal authored text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractProgressFormat {
    /// Literal text without a substitution.
    Literal(String),
    /// The one `%d` placeholder observed in retail content.
    Counter {
        /// Authored text before the integer substitution.
        prefix: String,
        /// Authored text after the integer substitution.
        suffix: String,
    },
}

impl ContractProgressFormat {
    fn parse(id: u32, text: &str) -> Result<Self, ContractCatalogError> {
        match text.split_once('%') {
            None => Ok(Self::Literal(text.into())),
            Some((prefix, substitution)) => match substitution.strip_prefix('d') {
                Some(suffix) if !suffix.contains('%') => Ok(Self::Counter {
                    prefix: prefix.into(),
                    suffix: suffix.into(),
                }),
                _ => Err(ContractCatalogError::ProgressFormat {
                    id,
                    text: text.into(),
                }),
            },
        }
    }

    /// Substitute the server counter without evaluating arbitrary format syntax.
    pub fn render(&self, count: u32) -> String {
        match self {
            Self::Literal(text) => text.clone(),
            Self::Counter { prefix, suffix } => format!("{prefix}{count}{suffix}"),
        }
    }
}

/// One lossless definition and its parsed progress format.
#[derive(Debug, Clone)]
pub struct ContractReference {
    /// Original static fields, including full destinations and quest flag references.
    pub definition: ContractDefinition,
    /// Absent when the authored progress description is empty.
    pub progress_format: Option<ContractProgressFormat>,
}

/// Immutable contract lookup assembled once during client bootstrap.
#[derive(Debug, Clone, Default)]
pub struct ContractCatalog {
    contracts: BTreeMap<u32, ContractReference>,
}

impl ContractCatalog {
    /// Validate the catalog once, preserving every source definition.
    pub fn from_table(table: ContractTable) -> Result<Self, ContractCatalogError> {
        if table.id != ContractTable::FILE_ID {
            return Err(ContractCatalogError::RecordId(table.id));
        }
        let mut contracts = BTreeMap::new();
        for (id, definition) in table.contracts {
            if id != definition.id {
                return Err(ContractCatalogError::DefinitionId {
                    key: id,
                    id: definition.id,
                });
            }
            for (role, position) in [
                ("start", &definition.start_position),
                ("end", &definition.end_position),
                ("area", &definition.area_position),
            ] {
                let origin = position.frame.origin;
                let rotation = position.frame.orientation;
                for (component, value) in [
                    ("x", origin.x),
                    ("y", origin.y),
                    ("z", origin.z),
                    ("rotation.w", rotation.w),
                    ("rotation.x", rotation.x),
                    ("rotation.y", rotation.y),
                    ("rotation.z", rotation.z),
                ] {
                    if !value.is_finite() {
                        return Err(ContractCatalogError::PositionComponent {
                            id,
                            role,
                            component,
                        });
                    }
                }
            }
            let progress_format = if definition.progress_description.is_empty() {
                None
            } else {
                Some(ContractProgressFormat::parse(
                    id,
                    &definition.progress_description,
                )?)
            };
            contracts.insert(
                id,
                ContractReference {
                    definition,
                    progress_format,
                },
            );
        }
        Ok(Self { contracts })
    }

    /// Find a definition by stable identity; names are not unique.
    pub fn get(&self, id: u32) -> Option<&ContractReference> {
        self.contracts.get(&id)
    }
}

/// Static content failures with enough context to identify the authored record.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ContractCatalogError {
    /// Source placement cannot be delivered as finite coordinates/orientation.
    #[error("contract {id} has nonfinite {role} position component {component}")]
    PositionComponent {
        /// Definition containing the invalid source position.
        id: u32,
        /// Authored destination field: start, end, or area.
        role: &'static str,
        /// Origin axis or rotation component that was not finite.
        component: &'static str,
    },
    /// A caller supplied the wrong record to catalog assembly.
    #[error("unexpected contract table ID {0:#010x}")]
    RecordId(u32),
    /// The table key disagrees with its embedded identity.
    #[error("contract key {key} differs from definition ID {id}")]
    DefinitionId {
        /// Identity used by the table lookup.
        key: u32,
        /// Conflicting identity embedded in the definition.
        id: u32,
    },
    /// Authored formatting exceeds the supported single integer substitution.
    #[error("contract {id} has unsupported progress format {text:?}")]
    ProgressFormat {
        /// Definition containing the unsupported format.
        id: u32,
        /// Complete authored text to diagnose the content error.
        text: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> ContractDefinition {
        let position = holtburger_dat::file_type::ContractPosition {
            cell_id: 0x80800001,
            frame: holtburger_dat::graphics::Frame::default(),
        };
        ContractDefinition {
            version: 0,
            id: 7,
            name: "Quest".into(),
            description: String::new(),
            progress_description: String::new(),
            start_npc: "NPC".into(),
            end_npc: String::new(),
            stamped_flag: String::new(),
            started_flag: String::new(),
            finished_flag: String::new(),
            progress_flag: String::new(),
            timer_flag: String::new(),
            repeat_flag: String::new(),
            start_position: position.clone(),
            end_position: position.clone(),
            area_position: position,
        }
    }

    #[test]
    fn invalid_source_positions_report_definition_role_and_component() {
        for role in ["start", "end", "area"] {
            let mut definition = definition();
            let position = match role {
                "start" => &mut definition.start_position,
                "end" => &mut definition.end_position,
                _ => &mut definition.area_position,
            };
            position.frame.origin.x = f32::NAN;
            let table = ContractTable {
                id: ContractTable::FILE_ID,
                contracts: [(7, definition)].into(),
            };
            assert!(
                matches!(ContractCatalog::from_table(table), Err(ContractCatalogError::PositionComponent { id: 7, role: found, component: "x" }) if found == role)
            );
        }
        let mut definition = definition();
        definition.area_position.frame.orientation.w = f32::INFINITY;
        let table = ContractTable {
            id: ContractTable::FILE_ID,
            contracts: [(7, definition)].into(),
        };
        assert!(matches!(
            ContractCatalog::from_table(table),
            Err(ContractCatalogError::PositionComponent {
                id: 7,
                role: "area",
                component: "rotation.w"
            })
        ));
    }

    #[test]
    fn authored_progress_supports_targets_open_counts_and_literals() {
        for (text, expected) in [
            ("%d/20 Tuskers", "7/20 Tuskers"),
            ("%d Wins", "7 Wins"),
            ("Count: %d", "Count: 7"),
            ("In progress", "In progress"),
        ] {
            assert_eq!(
                ContractProgressFormat::parse(1, text).unwrap().render(7),
                expected
            );
        }
        for text in ["%s", "%d %d", "%", "%%", "%02d"] {
            assert!(matches!(
                ContractProgressFormat::parse(42, text),
                Err(ContractCatalogError::ProgressFormat { id: 42, .. })
            ));
        }
    }
}
