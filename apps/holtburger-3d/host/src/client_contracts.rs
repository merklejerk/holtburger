//! Narrow journal command adapter; shared world snapshots carry resolved facts.

use holtburger_core::ClientCommand;
use serde::Deserialize;

/// App-owned removal intent adapted to a reusable core command.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientContractsAction {
    /// Remove journal tracking without resetting quest progress.
    Remove {
        /// Stable contract registry identity.
        id: u32,
    },
}

impl From<ClientContractsAction> for ClientCommand {
    fn from(action: ClientContractsAction) -> Self {
        match action {
            ClientContractsAction::Remove { id } => Self::AbandonContract { id },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_event_sink::ClientEventSink;
    use crate::protocol::{StdioEventSink, encode_frame};
    use holtburger_core::ClientViewEvent;
    use holtburger_world::state::contracts::{
        ContractContact, ContractContactRole, ContractDeadline, ContractLocation, ContractRow,
        ContractStatus, ContractsSnapshot,
    };
    use serde_json::Value;
    use std::sync::mpsc;

    #[test]
    fn sidecar_contract_payload_matches_browser_fixture() {
        let statuses = [
            ContractStatus::Available,
            ContractStatus::InProgress {
                progress: Some("7 Wins".into()),
            },
            ContractStatus::Completed,
            ContractStatus::WaitingToRepeat {
                remaining_seconds: 120.0,
            },
            ContractStatus::InProgress { progress: None },
        ];
        let mut rows: Vec<_> = statuses
            .into_iter()
            .enumerate()
            .map(|(index, status)| {
                let id = index as u32 + 1;
                ContractRow::Resolved {
                    id,
                    name: if id <= 2 {
                        "Same quest".into()
                    } else {
                        format!("Quest {id}")
                    },
                    description: "Authored quest notes.".into(),
                    status,
                    contact: match id {
                        1 => Some(ContractContact {
                            role: ContractContactRole::Start,
                            name: "Fred".into(),
                            location: ContractLocation::Outdoor {
                                latitude: -1.2,
                                longitude: 3.4,
                                position: Box::new(holtburger_common::position::WorldPosition {
                                    landblock_id: holtburger_common::Guid(0x80800001),
                                    coords: holtburger_common::Vector3::new(6.0, 12.0, 25.0),
                                    rotation: holtburger_common::Quaternion::identity(),
                                }),
                            },
                        }),
                        2 => Some(ContractContact {
                            role: ContractContactRole::End,
                            name: "Bob".into(),
                            location: ContractLocation::Indoor {
                                cell_id: 0xda550100,
                            },
                        }),
                        _ => None,
                    },
                    area: if id == 2 {
                        ContractLocation::Outdoor {
                            latitude: 0.1,
                            longitude: 0.2,
                            position: Box::new(holtburger_common::position::WorldPosition {
                                landblock_id: holtburger_common::Guid(0x8080000a),
                                coords: holtburger_common::Vector3::new(36.0, 42.0, 50.0),
                                rotation: holtburger_common::Quaternion {
                                    w: 0.5,
                                    x: 0.5,
                                    y: 0.5,
                                    z: 0.5,
                                },
                            }),
                        }
                    } else {
                        ContractLocation::Missing
                    },
                    deadline: match id {
                        2 => Some(ContractDeadline::Running {
                            remaining_seconds: 60.0,
                        }),
                        3 => Some(ContractDeadline::Finished),
                        _ => None,
                    },
                }
            })
            .collect();
        rows.push(ContractRow::Unresolved { id: 99 });
        let fixture: Value = serde_json::from_str(include_str!(
            "../../src/harness/browser/fixtures/contracts.json"
        ))
        .unwrap();
        for (contracts, expected) in [
            (Some(ContractsSnapshot { rows }), fixture),
            (None, serde_json::json!({ "contracts": null })),
        ] {
            let event = crate::client_projection::project_client_event(
                ClientViewEvent::ContractsStateUpdated { contracts },
            )
            .unwrap();
            let (sender, receiver) = mpsc::sync_channel(1);
            StdioEventSink::new(sender)
                .publish_client_event(event)
                .unwrap();
            let bytes = encode_frame(&receiver.recv().unwrap()).unwrap();
            let frame: Value = rmp_serde::from_slice(&bytes[4..]).unwrap();
            assert_eq!(frame["event"]["event"], "client-contracts-updated");
            assert_eq!(frame["event"]["payload"], expected);
        }
    }

    #[test]
    fn sidecar_membership_payload_matches_browser_fixture() {
        use holtburger_world::state::contracts::{
            ContractMembershipChange, ContractMembershipChangeKind,
        };
        let fixture: Vec<Value> = serde_json::from_str(include_str!(
            "../../src/harness/browser/fixtures/contract-membership.json"
        ))
        .unwrap();
        for (change, expected) in [
            (
                ContractMembershipChange {
                    kind: ContractMembershipChangeKind::Added,
                    id: 1,
                    name: Some("Same quest".into()),
                },
                fixture[0].clone(),
            ),
            (
                ContractMembershipChange {
                    kind: ContractMembershipChangeKind::Removed,
                    id: 99,
                    name: None,
                },
                fixture[1].clone(),
            ),
        ] {
            let event = crate::client_projection::project_client_event(
                ClientViewEvent::ContractMembershipChanged(change),
            )
            .unwrap();
            let (sender, receiver) = mpsc::sync_channel(1);
            StdioEventSink::new(sender)
                .publish_client_event(event)
                .unwrap();
            let bytes = encode_frame(&receiver.recv().unwrap()).unwrap();
            let frame: Value = rmp_serde::from_slice(&bytes[4..]).unwrap();
            assert_eq!(
                frame["event"]["event"],
                "client-contract-membership-changed"
            );
            assert_eq!(frame["event"]["payload"], expected);
        }
    }

    #[test]
    fn removal_adapter_rejects_invalid_intents() {
        let action: ClientContractsAction =
            serde_json::from_value(serde_json::json!({ "kind": "remove", "id": 99 })).unwrap();
        assert!(matches!(
            ClientCommand::from(action),
            ClientCommand::AbandonContract { id: 99 }
        ));
        for value in [
            serde_json::json!({ "kind": "remove", "id": -1 }),
            serde_json::json!({ "kind": "remove", "id": 99, "pending": true }),
        ] {
            assert!(serde_json::from_value::<ClientContractsAction>(value).is_err());
        }
    }
}
