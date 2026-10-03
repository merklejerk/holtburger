//! Shared admission for ACE's privileged map teleport, independent of map presentation.

use super::types::{ActionResultReason, ActionResultSource};
use super::{ClientLifecycleState, ClientRuntime, ClientViewEvent};
use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition,
};
use holtburger_common::properties::{PropertyBool, WorldObjectPropertyAccessors};
use holtburger_protocol::messages::{AdvocateTeleportActionData, GameAction};

/// Validate a canonical outdoor destination, including the exclusive landscape edge.
fn validate_map_destination(position: WorldPosition) -> Result<(), &'static str> {
    let (block_x, block_y) = position.landblock_coords();
    if block_x > MAX_OUTDOOR_LANDBLOCK_AXIS || block_y > MAX_OUTDOOR_LANDBLOCK_AXIS {
        return Err("Map teleport destination is outside the landscape");
    }
    let cell = position.landblock_id.0 & 0xffff;
    if !(1..=64).contains(&cell) {
        return Err("Map teleport requires an outdoor terrain cell");
    }
    if ![position.coords.x, position.coords.y, position.coords.z]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("Map teleport destination must be finite");
    }
    if ![
        position.rotation.w,
        position.rotation.x,
        position.rotation.y,
        position.rotation.z,
    ]
    .iter()
    .all(|value| value.is_finite())
    {
        return Err("Map teleport orientation must be finite");
    }
    if !(0.0..METERS_PER_LANDBLOCK).contains(&position.coords.x)
        || !(0.0..METERS_PER_LANDBLOCK).contains(&position.coords.y)
    {
        return Err("Map teleport coordinates must be local to their landblock");
    }
    if position.derived_outdoor_cell_id() != Some(cell) {
        return Err("Map teleport terrain cell does not match its coordinates");
    }
    Ok(())
}

impl ClientRuntime {
    /// Mirror retail PlayerIsPSR and ACE GameActionAdvocateTeleport using character facts.
    pub fn can_teleport_from_map(&self) -> bool {
        matches!(self.lifecycle(), ClientLifecycleState::InWorld)
            && self.world.player_entity().is_some_and(|entity| {
                [
                    PropertyBool::IsAdmin,
                    PropertyBool::IsArch,
                    PropertyBool::IsPsr,
                ]
                .iter()
                .any(|&property| entity.get_bool_prop(property))
            })
    }

    pub(super) fn publish_map_teleport_capability(&mut self) {
        let allowed = self.can_teleport_from_map();
        if allowed != self.published_map_teleport_capability {
            self.published_map_teleport_capability = allowed;
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::MapTeleportCapabilityChanged(allowed));
        }
    }

    pub(super) async fn teleport_to_map_position(
        &mut self,
        position: WorldPosition,
    ) -> anyhow::Result<()> {
        let rejection = if !self.can_teleport_from_map() {
            Some("Map teleport requires an eligible character in the world")
        } else {
            validate_map_destination(position).err()
        };
        if let Some(message) = rejection {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(message.into()),
            );
            return Ok(());
        }
        self.send_game_action(GameAction::AdvocateTeleport(Box::new(
            AdvocateTeleportActionData {
                target: String::new(),
                position,
            },
        )))
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientCommand, ClientState, builder};
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_world::entity::Entity;

    fn destination() -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x12340001),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        }
    }

    fn client(permission: Option<PropertyBool>) -> ClientRuntime {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(7);
        client.world.player.guid = guid;
        let mut entity = Entity::new(guid, "Map tester".into(), destination());
        if let Some(permission) = permission {
            entity.properties.bools.insert(permission, true);
        }
        client.world.add_entity(entity);
        client
    }

    #[tokio::test]
    async fn each_character_permission_admits_one_map_action() {
        for permission in [
            PropertyBool::IsAdmin,
            PropertyBool::IsArch,
            PropertyBool::IsPsr,
        ] {
            let mut client = client(Some(permission));
            assert!(client.application_snapshot().can_teleport_from_map);
            client
                .handle_command(ClientCommand::TeleportToMapPosition(destination()))
                .await
                .unwrap();
            assert_eq!(client.session.game_action_sequence, 1);
        }
    }

    #[tokio::test]
    async fn ordinary_and_out_of_world_characters_send_no_action() {
        let mut ordinary = client(None);
        ordinary
            .handle_command(ClientCommand::TeleportToMapPosition(destination()))
            .await
            .unwrap();
        assert_eq!(ordinary.session.game_action_sequence, 0);
        assert!(!ordinary.application_snapshot().can_teleport_from_map);

        let mut privileged = client(Some(PropertyBool::IsAdmin));
        privileged.state = ClientState::EnteringWorld;
        privileged
            .handle_command(ClientCommand::TeleportToMapPosition(destination()))
            .await
            .unwrap();
        assert_eq!(privileged.session.game_action_sequence, 0);
        assert!(!privileged.application_snapshot().can_teleport_from_map);
    }

    #[tokio::test]
    async fn server_permission_revocation_reconciles_and_blocks_a_queued_intent() {
        use holtburger_protocol::messages::{GameMessage, PrivateUpdatePropertyBoolData};
        use holtburger_protocol::traits::ProtocolPack;
        let mut client = client(Some(PropertyBool::IsAdmin));
        client.publish_map_teleport_capability();
        let mut events = client.subscribe_client_view_events();
        let mut packet = Vec::new();
        GameMessage::PrivateUpdatePropertyBool(Box::new(PrivateUpdatePropertyBoolData {
            sequence: 1,
            guid: Guid::NULL,
            property: PropertyBool::IsAdmin as u32,
            value: false,
        }))
        .pack(&mut packet);
        client.handle_message(&packet).await.unwrap();
        let mut revoked = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::MapTeleportCapabilityChanged(false)) {
                revoked = true;
            }
        }
        assert!(revoked);
        assert!(!client.application_snapshot().can_teleport_from_map);
        client
            .handle_command(ClientCommand::TeleportToMapPosition(destination()))
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[test]
    fn capability_publishes_edges_and_revokes_on_character_removal() {
        let mut client = client(Some(PropertyBool::IsPsr));
        let mut events = client.subscribe_client_view_events();
        client.publish_map_teleport_capability();
        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::MapTeleportCapabilityChanged(true)
        ));
        client.publish_map_teleport_capability();
        assert!(events.try_recv().is_err());
        client.world.player.guid = Guid::NULL;
        client.publish_map_teleport_capability();
        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::MapTeleportCapabilityChanged(false)
        ));
        assert!(!client.application_snapshot().can_teleport_from_map);
    }

    #[tokio::test]
    async fn invalid_destinations_report_feedback_without_dispatch() {
        let mut client = client(Some(PropertyBool::IsAdmin));
        let mut events = client.subscribe_client_view_events();
        let mut invalid = Vec::new();
        let mut p = destination();
        p.landblock_id = Guid(0xff340001);
        invalid.push(p);
        let mut p = destination();
        p.landblock_id = Guid(0x12340100);
        invalid.push(p);
        let mut p = destination();
        p.coords.x = f32::NAN;
        invalid.push(p);
        let mut p = destination();
        p.coords.y = METERS_PER_LANDBLOCK;
        invalid.push(p);
        let mut p = destination();
        p.landblock_id = Guid(0x12340002);
        invalid.push(p);
        let mut p = destination();
        p.rotation.w = f32::INFINITY;
        invalid.push(p);
        for position in invalid {
            client
                .handle_command(ClientCommand::TeleportToMapPosition(position))
                .await
                .unwrap();
            assert_eq!(client.session.game_action_sequence, 0);
            assert!(matches!(
                events.try_recv().unwrap(),
                ClientViewEvent::ActionResult { .. }
            ));
        }
    }
}
