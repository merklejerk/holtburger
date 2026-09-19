//! Shared combat request execution; world and existing operation owners retain state.
use super::combat_engagement::CombatControlEffect;
use super::movement_types::{
    AutonomousDriveIntent, ClientDirectedCommand, Gait, PlayerDriveIntent,
};
use super::types::{
    ActionResultReason, ActionResultSource, ClientAttackProfile, ClientCommand, ClientViewEvent,
    CombatFeedback, SpellCastAim,
};
use super::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_common::{CharacterOption, Guid, Vector3};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_protocol::messages::*;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::EntityMotionDirective;
use holtburger_world::spell::SpellCastingRoute;
use holtburger_world::{
    ContactState, PhysicalCollisionFilter, SpatialBodyId, StaticSurfaceRayRequest,
};
use std::time::{Duration, Instant};

// ACE Player_Melee.cs distinguishes direct striking range (0.6) from the broader distance at
// which the server may begin its own sticky sequence (4.0). Client pursuit reaches direct range
// before the initial request; an accepted sequence then hands movement ownership to ACE.
const MELEE_ATTACK_DISTANCE: f32 = 0.6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CombatStaticPath {
    Clear,
    Blocked,
    Unknown,
}

/// Resolved cast request shared by wire publication and pending-operation correlation.
#[derive(Debug)]
struct PreparedSpellCast {
    /// Canonical spell identifier after stripping the frontend marker bit.
    spell_id: u32,
    /// Actual recipient after resolving self-target and untargeted spell routes.
    target: Option<Guid>,
}

impl PreparedSpellCast {
    fn into_action(self) -> GameAction {
        match self.target {
            Some(target) => GameAction::CastTargetedSpell(Box::new(CastTargetedSpellActionData {
                target,
                spell_id: self.spell_id,
            })),
            None => GameAction::CastUntargetedSpell(Box::new(CastUntargetedSpellActionData {
                spell_id: self.spell_id,
            })),
        }
    }
}

impl ClientRuntime {
    fn combat_refill_duration(&self) -> Duration {
        if self.world.player.last_server_motion_style == Some(MotionStance::DualWieldCombat) {
            Duration::from_millis(800)
        } else {
            Duration::from_secs(1)
        }
    }

    fn emit_combat_status_if_changed(&self, previous: super::types::ClientCombatStatus) {
        let current = self.combat_engagement.status();
        if current != previous {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::CombatStatusUpdated(current));
        }
    }

    fn combat_request_ready(&self) -> bool {
        let Some(desired) = self.combat_engagement.status().desired else {
            return false;
        };
        let physical_ready = match desired.profile {
            ClientAttackProfile::Melee { .. }
                if self
                    .combat_engagement
                    .sent_engagement()
                    .is_some_and(|sent| {
                        sent.target == desired.target
                            && matches!(sent.profile, ClientAttackProfile::Melee { .. })
                    }) =>
            {
                true
            }
            ClientAttackProfile::Melee { .. } => {
                self.world
                    .physical_cylinder_distance(self.world.player.guid, desired.target)
                    .is_some_and(|distance| distance <= MELEE_ATTACK_DISTANCE)
                    && self.combat_static_path(desired.target) == CombatStaticPath::Clear
            }
            ClientAttackProfile::Missile { .. } => self.missile_request_grounded(),
        };
        self.world.player_combat_mode() == desired.profile.combat_mode()
            && self
                .world
                .combat_target_status(desired.target)
                .is_available()
            && physical_ready
            && self.active_busy_operation.is_none()
            && self.equipment_operation.is_none()
            && self.pack_exchange.is_none()
    }

    /// ACE rejects a new missile request while jumping; unknown support cannot authorize it.
    fn missile_request_grounded(&self) -> bool {
        self.world
            .runtime_body_view(SpatialBodyId::LocalPlayer(self.world.player.guid))
            .is_some_and(|body| body.contact == ContactState::Grounded)
    }

    fn combat_static_path(&self, target: Guid) -> CombatStaticPath {
        let Some(collision) = self
            .collision_coordinator
            .as_ref()
            .map(super::collision::ClientCollisionCoordinator::snapshot)
        else {
            return CombatStaticPath::Unknown;
        };
        let Some(player_pose) = self.world.runtime_pose_for_guid(self.world.player.guid) else {
            return CombatStaticPath::Unknown;
        };
        let Some(target_pose) = self.world.runtime_pose_for_guid(target) else {
            return CombatStaticPath::Unknown;
        };
        let anchor = Guid((player_pose.landblock_id.0 & 0xffff_0000) | 0xffff);
        let Ok(player) = player_pose.reanchor_to_landblock_owner(anchor) else {
            return CombatStaticPath::Unknown;
        };
        let Ok(target) = target_pose.reanchor_to_landblock_owner(anchor) else {
            return CombatStaticPath::Unknown;
        };
        let start = player.coords + Vector3::new(0.0, 0.0, 1.0);
        let end = target.coords + Vector3::new(0.0, 0.0, 1.0);
        let delta = end - start;
        let distance = delta.length();
        if distance <= f32::EPSILON {
            return CombatStaticPath::Clear;
        }
        let request = StaticSurfaceRayRequest {
            anchor,
            start,
            direction: delta / distance,
            maximum_distance: distance,
            previous_cell: player_pose.is_indoors().then_some(player_pose.landblock_id),
            filter: PhysicalCollisionFilter::ALL,
        };
        match collision.scene.cast_static_surface_ray(request) {
            Ok(None) => CombatStaticPath::Clear,
            Ok(Some(_)) => CombatStaticPath::Blocked,
            Err(_) => CombatStaticPath::Unknown,
        }
    }

    /// Chooses direct pursuit before the movement owner advances this tick.
    ///
    /// Pursuit intentionally steers at the current target pose without route planning. Static
    /// collision remains authoritative, so a target rounding a corner can pin pursuit at it.
    pub(super) fn prepare_combat_movement(&mut self, now: Instant, dt: Duration) {
        let previous_status = self.combat_engagement.status();
        let Some(desired) = self.combat_engagement.status().desired else {
            self.release_combat_approach(now);
            return;
        };
        if !self
            .world
            .combat_target_status(desired.target)
            .is_available()
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.release_combat_approach(now);
            return;
        }
        if self.world.player_combat_mode() != desired.profile.combat_mode()
            && self.combat_engagement.has_sent_sequence()
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.release_combat_approach(now);
            return;
        }
        // Missile has no pursuit policy and remains compatible with player-owned translation.
        if !matches!(desired.profile, ClientAttackProfile::Melee { .. }) {
            self.release_combat_approach(now);
            return;
        }
        let distance = self
            .world
            .physical_cylinder_distance(self.world.player.guid, desired.target);
        if distance
            .is_some_and(|distance| distance >= self.combat_tuning.melee_max_chase_distance())
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.release_combat_approach(now);
            return;
        }
        if self.movement.has_active_manual_drive() {
            self.interrupt_combat_for_movement(now);
            return;
        }
        // ACE owns target-relative movement after accepting an attack. Its swing motion carries
        // StickToObject and remains authoritative until AttackDone(ActionCancelled) retires the
        // sequence (Player_Melee.cs:215-230, 413-428). Reapplying the initial 0.6 m admission
        // gate here would cancel and reacquire combat whenever sticky motion crossed that edge.
        if self.combat_engagement.has_sent_sequence() {
            self.release_combat_approach(now);
            return;
        }
        let Some(distance) = distance else {
            self.release_combat_approach(now);
            return;
        };
        let path = self.combat_static_path(desired.target);
        if distance <= MELEE_ATTACK_DISTANCE && path == CombatStaticPath::Clear {
            self.release_combat_approach(now);
            return;
        }
        if path == CombatStaticPath::Unknown {
            self.release_combat_approach(now);
            return;
        }
        let Some(player_pose) = self.world.runtime_pose_for_guid(self.world.player.guid) else {
            self.release_combat_approach(now);
            return;
        };
        let Some(target_pose) = self.world.runtime_pose_for_guid(desired.target) else {
            self.release_combat_approach(now);
            return;
        };
        let Ok(capabilities) = self.world.resolve_self_movement_capabilities() else {
            self.release_combat_approach(now);
            return;
        };
        let delta = target_pose.global_coords() - player_pose.global_coords();
        let planar = Vector3::new(delta.x, delta.y, 0.0);
        let planar_distance = planar.length();
        if planar_distance <= f32::EPSILON {
            self.release_combat_approach(now);
            return;
        }
        let budget = capabilities.resolved_autonomous_run_speed(1.0) * dt.as_secs_f32();
        if budget <= f32::EPSILON {
            self.release_combat_approach(now);
            return;
        }
        let desired_world_delta = delta * (budget / planar_distance).min(1.0);
        let intent = AutonomousDriveIntent {
            desired_world_delta,
            desired_heading: Some(Vector3::zero().heading_to(&planar)),
            target_hint: Some(target_pose),
            gait: Gait::Run,
            force_grounded: true,
        };
        let command = if self.combat_approach_drive_active {
            ClientDirectedCommand::Update(intent)
        } else {
            self.combat_approach_drive_active = true;
            ClientDirectedCommand::Acquire(intent)
        };
        self.movement
            .enqueue_drive_intent(PlayerDriveIntent::ClientDirected(command), now);
    }

    fn release_combat_approach(&mut self, now: Instant) {
        if !std::mem::take(&mut self.combat_approach_drive_active) {
            return;
        }
        self.movement.enqueue_drive_intent(
            PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Release),
            now,
        );
    }

    /// Ends desired combat when another movement owner takes control.
    pub(super) fn interrupt_combat_for_movement(&mut self, now: Instant) {
        let previous = self.combat_engagement.status();
        if previous.desired.is_none() {
            return;
        }
        self.combat_engagement.stop();
        self.emit_combat_status_if_changed(previous);
        self.release_combat_approach(now);
    }

    /// Applies the active attack family's player-movement interruption policy.
    pub(super) fn interrupt_combat_for_player_movement(&mut self, now: Instant) {
        let Some(desired) = self.combat_engagement.status().desired else {
            return;
        };
        if matches!(desired.profile, ClientAttackProfile::Missile { .. }) {
            // RETAIL DIVERGENCE: retail requires the missile Ready forward command and cancels
            // auto-repeat after movement leaves it (acclient.c:390981-391000,391436-391464);
            // jump also cancels it (acclient.c:390479-390512). ACE's accepted missile loop has no
            // ordinary-movement guard (Player_Missile.cs:280-304), so preserving the sequence
            // enables mobile missile combat. Restoring retail behavior would make manual movement
            // and jump retire missile fire. Census: five core movement-interruption entry points;
            // all 14 commands in all three missile stances across nine humanoid motion tables;
            // 22 supported humanoid layouts; and four Olthoi entries retaining full-body fallback
            // (docs/animation_composition.md).
            self.release_combat_approach(now);
            return;
        }
        self.interrupt_combat_for_movement(now);
    }

    /// Whether a received server directive supersedes combat-owned movement.
    ///
    /// ACE melee sticky remains combat-owned for its sent target. Matching missile-facing turns
    /// are filtered before world admission; any directive that reaches this policy retires
    /// missile combat rather than introducing chase movement.
    pub(super) fn server_motion_interrupts_combat(&self, data: &MovementEventData) -> bool {
        let Some(directive) = EntityMotionDirective::from_movement_event(data) else {
            return false;
        };
        let Some(sent) = self.combat_engagement.sent_engagement() else {
            return true;
        };
        match sent.profile {
            ClientAttackProfile::Melee { .. } => directive.target_guid() != Some(sent.target),
            ClientAttackProfile::Missile { .. } => true,
        }
    }

    pub(super) async fn advance_combat_engagement(&mut self, now: Instant) -> Result<()> {
        let previous = self.combat_engagement.status();
        let ready = self.combat_request_ready();
        let effect = self.combat_engagement.next_effect(now, ready);
        match effect {
            Some(CombatControlEffect::Attack(engagement)) => {
                self.send_targeted_attack(engagement.target, engagement.profile)
                    .await?;
            }
            Some(CombatControlEffect::Cancel) => {
                log::info!(">>> Retiring shared combat engagement");
                self.send_game_action(GameAction::CancelAttack(Box::new(
                    CancelAttackActionData {},
                )))
                .await?;
            }
            None => {}
        }
        self.emit_combat_status_if_changed(previous);
        Ok(())
    }

    async fn send_targeted_attack(
        &mut self,
        target: Guid,
        profile: ClientAttackProfile,
    ) -> Result<()> {
        match profile {
            ClientAttackProfile::Melee { height, power } => {
                log::info!(
                    ">>> Shared melee engagement on 0x{:08X} ({:?}, power {:.2})",
                    target.0,
                    height,
                    power
                );
                self.send_game_action(GameAction::TargetedMeleeAttack(Box::new(
                    TargetedMeleeAttackActionData {
                        target_guid: target,
                        attack_height: height,
                        power_level: power,
                    },
                )))
                .await
            }
            ClientAttackProfile::Missile { height, accuracy } => {
                log::info!(
                    ">>> Shared missile engagement on 0x{:08X} ({:?}, accuracy {:.2})",
                    target.0,
                    height,
                    accuracy
                );
                self.send_game_action(GameAction::TargetedMissileAttack(Box::new(
                    TargetedMissileAttackActionData {
                        target_guid: target,
                        attack_height: height,
                        accuracy_level: accuracy,
                    },
                )))
                .await
            }
        }
    }

    pub(super) fn observe_combat_feedback(&mut self, feedback: &CombatFeedback, now: Instant) {
        let previous = self.combat_engagement.status();
        match feedback {
            CombatFeedback::AttackCommenced => self.combat_engagement.attack_commenced(),
            CombatFeedback::AttackDone { error } => {
                self.combat_engagement.attack_done(*error, now);
            }
            _ => {}
        }
        self.emit_combat_status_if_changed(previous);
    }

    pub(super) fn observe_combat_action_result(&mut self, reason: &ActionResultReason) {
        if let ActionResultReason::Weenie(error, _) = reason {
            self.combat_engagement.note_weenie_error(*error);
        }
    }

    pub(super) fn reset_combat_engagement(&mut self) {
        let previous = self.combat_engagement.status();
        self.combat_engagement.reset();
        self.combat_approach_drive_active = false;
        self.emit_combat_status_if_changed(previous);
    }

    /// Establishes the server-side repeat policy used by the shared attack owner.
    ///
    /// ACE persists character options but does not acknowledge this action. Ordered session
    /// delivery is the contract: activation sends this before exposing an attack-capable world,
    /// then mirrors the requested value locally so teleport retries do not write it again.
    pub(super) async fn establish_attack_repeat_policy(&mut self) -> Result<()> {
        if self
            .world
            .player
            .character_option_enabled(CharacterOption::AutoRepeatAttacks)
        {
            return Ok(());
        }

        self.send_game_action(GameAction::SetSingleCharacterOption(Box::new(
            SetSingleCharacterOptionActionData {
                option: CharacterOption::AutoRepeatAttacks,
                value: true,
            },
        )))
        .await?;
        self.world
            .player
            .set_character_option_enabled(CharacterOption::AutoRepeatAttacks, true);
        self.emit_player_options_updated();
        Ok(())
    }

    pub(super) async fn handle_combat_command(&mut self, command: ClientCommand) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }
        match command {
            ClientCommand::CastSpell { spell_id, aim } => self.cast_spell(spell_id, aim).await,
            ClientCommand::BeginCombatEngagement { target, profile } => {
                let profile = profile.normalized();
                let previous = self.combat_engagement.status();
                self.combat_engagement.begin(
                    target,
                    profile,
                    Instant::now(),
                    self.combat_refill_duration(),
                );
                self.emit_combat_status_if_changed(previous);
                let desired_mode = profile.combat_mode();
                if self.world.player_combat_mode() != desired_mode {
                    self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                        ChangeCombatModeActionData { mode: desired_mode },
                    )))
                    .await?;
                }
                Ok(())
            }
            ClientCommand::UpdateCombatProfile(profile) => {
                let previous = self.combat_engagement.status();
                self.combat_engagement.update_profile(profile);
                self.emit_combat_status_if_changed(previous);
                Ok(())
            }
            ClientCommand::StopCombatEngagement => {
                let previous = self.combat_engagement.status();
                self.combat_engagement.stop();
                self.emit_combat_status_if_changed(previous);
                self.advance_combat_engagement(Instant::now()).await
            }
            ClientCommand::TargetedMeleeAttack {
                target,
                attack_height,
                power_level,
            } => {
                log::info!(
                    ">>> Targeted melee attack on 0x{:08X} ({:?}, power {:.2})",
                    target.0,
                    attack_height,
                    power_level
                );
                self.send_game_action(GameAction::TargetedMeleeAttack(Box::new(
                    TargetedMeleeAttackActionData {
                        target_guid: target,
                        attack_height,
                        power_level,
                    },
                )))
                .await
            }
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height,
                accuracy_level,
            } => {
                log::info!(
                    ">>> Targeted missile attack on 0x{:08X} ({:?}, accuracy {:.2})",
                    target.0,
                    attack_height,
                    accuracy_level
                );
                self.send_game_action(GameAction::TargetedMissileAttack(Box::new(
                    TargetedMissileAttackActionData {
                        target_guid: target,
                        attack_height,
                        accuracy_level,
                    },
                )))
                .await
            }
            ClientCommand::ToggleCombatMode => {
                // An equipment transaction temporarily enters peace. Do not interpret that
                // intermediate stance as a new player request or interrupt its restoration.
                if self.equipment_operation.is_some() {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "Wait for the equipment change to finish.".into(),
                        ),
                    );
                    return Ok(());
                }
                let current = self.world.player_combat_mode();
                if self.world.player.guid == Guid::NULL || current == CombatMode::Undef {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "Character combat state has not arrived yet.".into(),
                        ),
                    );
                    return Ok(());
                }
                let mode = match current {
                    CombatMode::NonCombat => self.world.get_suggested_combat_mode(),
                    _ => CombatMode::NonCombat,
                };
                if mode == current {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "You cannot enter combat with the currently held equipment.".into(),
                        ),
                    );
                    return Ok(());
                }
                // Stance completion is a mode/motion update, not UseDone. ACE owns its
                // NextUseTime animation queue (Player_Combat.cs:737), so do not arm use busy state.
                self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData { mode },
                )))
                .await
            }
            ClientCommand::SetCombatMode(mode) => {
                self.stop_equipment_change(
                    "Combat mode changed by another command; the last request may still complete",
                );
                log::info!(">>> Changing combat mode to: {:?}", mode);
                self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData { mode },
                )))
                .await
            }
            ClientCommand::CancelAttack => {
                log::info!(">>> Canceling attack");
                self.send_game_action(GameAction::CancelAttack(Box::new(
                    CancelAttackActionData {},
                )))
                .await
            }
            _ => unreachable!(),
        }
    }

    fn prepare_spell_cast(
        &self,
        spell_id: u32,
        aim: SpellCastAim,
    ) -> Result<PreparedSpellCast, &'static str> {
        let spell_id = spell_id & 0x7fff_ffff;
        let Some(spell) = self.world.spell_catalog.get(spell_id) else {
            return Err("Spell definition is unavailable.");
        };
        if self.known_spells_character == Some(self.world.player.guid)
            && !self.world.player.spells.contains_key(&spell_id)
        {
            return Err("You do not know this spell.");
        }
        let target = match aim {
            SpellCastAim::Untargeted => None,
            SpellCastAim::Normal { selection } => match spell.casting_route() {
                SpellCastingRoute::SelfTarget => Some(self.world.player.guid),
                SpellCastingRoute::Untargeted => None,
                SpellCastingRoute::SelectedTarget => {
                    let Some(target) = selection.filter(|id| *id != Guid::NULL) else {
                        return Err("Select a target before casting this spell.");
                    };
                    Some(target)
                }
            },
        };
        if self.world.player.guid == Guid::NULL {
            return Err("Character identity has not arrived yet.");
        }
        Ok(PreparedSpellCast { spell_id, target })
    }

    async fn cast_spell(&mut self, spell_id: u32, aim: SpellCastAim) -> Result<()> {
        let action = match self.prepare_spell_cast(spell_id, aim) {
            Ok(action) => action,
            Err(message) => {
                self.reject_combat_request(message);
                return Ok(());
            }
        };
        if !self.arm_busy_operation(super::PendingOperation::SpellCast {
            target: action.target,
        }) {
            self.reject_combat_request("Wait for the current action to finish.");
            return Ok(());
        }
        let result = self.send_game_action(action.into_action()).await;
        if result.is_err() {
            self.clear_busy_operation();
        }
        result
    }

    fn reject_combat_request(&mut self, message: &str) {
        self.emit_action_result(
            ActionResultSource::Client,
            ActionResultReason::General(message.into()),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use crate::client::movement_types::{CharacterDrive, PlayerDriveIntent};
    use crate::client::types::{BusyOperationKind, ClientCombatStatus};
    use crate::client::types::{BusyOperationResult, ClientExitCause, ClientViewEvent};
    use byteorder::{LittleEndian, ReadBytesExt};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{ItemType, PropertyInt, WorldObjectPropertyAccessorsMut};
    use holtburger_protocol::errors::WeenieError;
    use holtburger_protocol::messages::movement::{
        MoveToObject, MoveToParameters, MovementInvalid, Origin,
    };
    use holtburger_protocol::messages::transport::{FragmentHeader, PacketHeader, packet_flags};
    use holtburger_protocol::traits::ProtocolUnpack;
    use holtburger_world::WorldState;
    use holtburger_world::entity::{
        EntityMotionAdmission, EntityMotionDirective, EntityTurnToParameters, OrderedMotionScalar,
    };
    use holtburger_world::motion::begin_server_directed_motion;
    use holtburger_world::spell::{MagicSchool, SpellCatalog, SpellExtrasInfo, SpellInfo};
    use std::collections::HashMap;
    use std::io::{Cursor, Read};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    fn spell_info(school: MagicSchool, bitfield: u32, non_component_target_type: u32) -> SpellInfo {
        SpellInfo {
            name: "Test Spell".to_string(),
            description: String::new(),
            school,
            icon_id: 0,
            category: 0,
            bitfield,
            base_mana: 0,
            base_range_constant: 0.0,
            base_range_mod: 0.0,
            power: 0,
            spell_economy_mod: 0.0,
            formula_version: 0,
            component_loss: 0.0,
            meta_spell_type: 0,
            meta_spell_id: 0,
            extras: SpellExtrasInfo::None,
            components: [0; 8],
            caster_effect: 0,
            target_effect: 0,
            fizzle_effect: 0,
            recovery_interval: 0.0,
            recovery_amount: 0.0,
            display_order: 0,
            non_component_target_type,
            mana_mod: 0,
        }
    }

    fn world_with_spell(player_guid: Guid, spell_id: u32, spell: SpellInfo) -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = player_guid;
        world.spell_catalog = Arc::new(SpellCatalog {
            spells: HashMap::from([(spell_id, spell)]),
            ..Default::default()
        });
        world
    }

    fn client(flags: u32) -> ClientRuntime {
        let mut client = build_test_client(ClientState::InWorld);
        let mut spell = spell_info(MagicSchool::WarMagic, flags, 0);
        spell.components = [1, 2, 3, 4, 0x31, 0, 0, 0];
        client.world = world_with_spell(Guid(1), 42, spell);
        client
    }

    fn server_motion(data: MovementTypeData, movement_type: MovementType) -> MovementEventData {
        MovementEventData {
            guid: Guid(1),
            object_instance_sequence: 1,
            movement_sequence: 1,
            server_control_sequence: 1,
            is_autonomous: false,
            movement_type,
            motion_flags: 0,
            current_style: MotionStance::SwordCombat.interpreted(),
            data,
        }
    }

    #[tokio::test]
    async fn manual_movement_interrupts_melee_but_preserves_missile_combat() {
        let mut client = client(0);
        let begin = || ClientCommand::BeginCombatEngagement {
            target: Guid(2),
            profile: ClientAttackProfile::Melee {
                height: AttackHeight::Medium,
                power: 0.5,
            },
        };
        client.handle_command(begin()).await.unwrap();
        client
            .handle_command(ClientCommand::DriveSelf(
                PlayerDriveIntent::SynchronizeHeld(CharacterDrive::default()),
            ))
            .await
            .unwrap();
        assert!(client.combat_engagement.status().desired.is_some());

        client
            .handle_command(ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
                CharacterDrive::builder().run().forward().build(),
            )))
            .await
            .unwrap();
        assert_eq!(
            client.combat_engagement.status(),
            ClientCombatStatus::default()
        );

        client
            .handle_command(ClientCommand::BeginCombatEngagement {
                target: Guid(2),
                profile: ClientAttackProfile::Missile {
                    height: AttackHeight::Medium,
                    accuracy: 0.5,
                },
            })
            .await
            .unwrap();
        client
            .handle_command(ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
                CharacterDrive::builder().run().forward().build(),
            )))
            .await
            .unwrap();
        assert!(matches!(
            client
                .combat_engagement
                .status()
                .desired
                .map(|engagement| engagement.profile),
            Some(ClientAttackProfile::Missile { .. })
        ));
    }

    #[test]
    fn accepted_jump_policy_preserves_sent_missile_sequence() {
        let mut client = client(0);
        let now = Instant::now();
        client.combat_engagement.begin(
            Guid(2),
            ClientAttackProfile::Missile {
                height: AttackHeight::Medium,
                accuracy: 0.5,
            },
            now,
            Duration::ZERO,
        );
        assert!(matches!(
            client.combat_engagement.next_effect(now, true),
            Some(CombatControlEffect::Attack(_))
        ));

        client.interrupt_combat_for_player_movement(now);

        assert!(client.combat_engagement.has_sent_sequence());
        assert!(matches!(
            client
                .combat_engagement
                .status()
                .desired
                .map(|engagement| engagement.profile),
            Some(ClientAttackProfile::Missile { .. })
        ));
    }

    #[test]
    fn missile_request_waits_for_grounded_runtime_contact() {
        let mut client = client(0);
        client.world.seed_local_player_entity(
            Guid(1),
            "Archer",
            WorldPosition {
                landblock_id: Guid(0x1234_0000),
                ..WorldPosition::default()
            },
        );
        for (contact, expected) in [
            (holtburger_world::ContactState::Airborne, false),
            (holtburger_world::ContactState::Sliding, false),
            (holtburger_world::ContactState::Grounded, true),
        ] {
            client.world.apply_spatial_body_event(
                &holtburger_world::SpatialBodyEvent::ContactChanged {
                    body_id: holtburger_world::SpatialBodyId::LocalPlayer(Guid(1)),
                    contact,
                },
            );
            assert_eq!(client.missile_request_grounded(), expected);
        }
    }

    #[test]
    fn server_directives_interrupt_except_for_the_sent_attack_target() {
        let mut client = client(0);
        let now = Instant::now();
        client.combat_engagement.begin(
            Guid(2),
            ClientAttackProfile::Melee {
                height: AttackHeight::Medium,
                power: 0.5,
            },
            now,
            Duration::ZERO,
        );
        assert!(matches!(
            client.combat_engagement.next_effect(now, true),
            Some(CombatControlEffect::Attack(_))
        ));
        let object_motion = |target| {
            server_motion(
                MovementTypeData::MoveToObject(MoveToObject {
                    target,
                    origin: Origin::default(),
                    params: MoveToParameters::default(),
                    run_rate: 1.0,
                }),
                MovementType::MoveToObject,
            )
        };

        assert!(!client.server_motion_interrupts_combat(&object_motion(Guid(2))));
        assert!(client.server_motion_interrupts_combat(&object_motion(Guid(3))));
        assert!(client.server_motion_interrupts_combat(&server_motion(
            MovementTypeData::MoveToPosition(MoveToPosition {
                origin: Origin::default(),
                params: MoveToParameters::default(),
                run_rate: 1.0,
            }),
            MovementType::MoveToPosition,
        )));
        assert!(!client.server_motion_interrupts_combat(&server_motion(
            MovementTypeData::Invalid(MovementInvalid::default()),
            MovementType::Invalid,
        )));

        client.combat_engagement.reset();
        client.combat_engagement.begin(
            Guid(2),
            ClientAttackProfile::Missile {
                height: AttackHeight::Medium,
                accuracy: 0.5,
            },
            now,
            Duration::ZERO,
        );
        assert!(client.combat_engagement.next_effect(now, true).is_some());
        assert!(client.server_motion_interrupts_combat(&object_motion(Guid(2))));
    }

    #[test]
    fn recipient_intent_and_canonical_identity_survive_preparation() {
        for (flags, aim, expected) in [
            (
                8,
                SpellCastAim::Normal {
                    selection: Some(Guid(2)),
                },
                Some(Guid(1)),
            ),
            (
                0,
                SpellCastAim::Normal {
                    selection: Some(Guid(2)),
                },
                Some(Guid(2)),
            ),
            (8, SpellCastAim::Untargeted, None),
            (0, SpellCastAim::Untargeted, None),
        ] {
            let client = client(flags);
            let prepared = client.prepare_spell_cast(0x8000_002a, aim).unwrap();
            assert_eq!(prepared.target, expected);
            let action = prepared.into_action();
            match (action, expected) {
                (GameAction::CastTargetedSpell(data), Some(target)) => {
                    assert_eq!(data.target, target);
                    assert_eq!(data.spell_id, 42);
                }
                (GameAction::CastUntargetedSpell(data), None) => assert_eq!(data.spell_id, 42),
                actual => panic!("unexpected route: {actual:?}"),
            }
        }
        let mut client = client(0);
        assert!(
            client
                .prepare_spell_cast(42, SpellCastAim::Normal { selection: None })
                .is_err()
        );
        assert!(
            client
                .prepare_spell_cast(
                    42,
                    SpellCastAim::Normal {
                        selection: Some(Guid::NULL)
                    }
                )
                .is_err()
        );
        assert!(
            client
                .prepare_spell_cast(99, SpellCastAim::Untargeted)
                .is_err()
        );
        client.known_spells_character = Some(Guid(1));
        assert_eq!(
            client
                .prepare_spell_cast(42, SpellCastAim::Untargeted)
                .unwrap_err(),
            "You do not know this spell."
        );
    }

    #[tokio::test]
    async fn cast_does_not_wait_for_stance_and_preserves_busy_overlap() {
        let mut client = client(0);
        client
            .handle_command(ClientCommand::SetCombatMode(CombatMode::Magic))
            .await
            .unwrap();
        let command = || ClientCommand::CastSpell {
            spell_id: 42,
            aim: SpellCastAim::Normal {
                selection: Some(Guid(2)),
            },
        };
        client.handle_command(command()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::SpellCast)
        );
        assert_eq!(
            client.active_busy_operation.as_ref().unwrap().operation,
            crate::client::PendingOperation::SpellCast {
                target: Some(Guid(2))
            }
        );
        let mut events = client.subscribe_client_view_events();
        client.handle_command(command()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::ActionResult { .. }
        ));
        client.note_busy_error(WeenieError::YoureTooBusy, None);
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
        let mut saw_error = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::BusyOperationFinished {
                operation: BusyOperationKind::SpellCast,
                result:
                    BusyOperationResult::Completed {
                        error: WeenieError::YoureTooBusy,
                        ..
                    },
            } = event
            {
                saw_error = true;
            }
        }
        assert!(saw_error);
        client.handle_command(command()).await.unwrap();
        client.poll_busy_timeout(
            Instant::now() + crate::client::BUSY_OPERATION_TIMEOUT + Duration::from_secs(1),
        );
        assert!(client.active_busy_operation.is_none());
        client.handle_command(command()).await.unwrap();
        client.set_exit_cause(ClientExitCause::ServerDisconnect);
        assert!(client.active_busy_operation.is_none());
    }
    #[tokio::test]
    async fn failed_send_releases_busy_and_publishes_idle() {
        let mut client = client(0);
        // Session binds IPv4; an IPv6 destination deterministically fails send_to.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        assert!(
            client
                .handle_command(ClientCommand::CastSpell {
                    spell_id: 42,
                    aim: SpellCastAim::Untargeted
                })
                .await
                .is_err()
        );
        assert!(client.active_busy_operation.is_none());
        let mut states = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::BusyStateUpdated { busy } = event {
                states.push(busy);
            }
        }
        assert_eq!(states, [Some(BusyOperationKind::SpellCast), None]);
    }

    #[tokio::test]
    async fn physical_contact_edges_do_not_complete_spell_busy_state() {
        let mut client = client(0);
        client.world.seed_local_player_entity(
            Guid(1),
            "Caster",
            WorldPosition {
                landblock_id: Guid(0x1234_0000),
                ..WorldPosition::default()
            },
        );
        let entity = client.world.player_entity_mut().unwrap();
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                holtburger_common::properties::PhysicsState::GRAVITY,
            ));
        client
            .handle_command(ClientCommand::CastSpell {
                spell_id: 42,
                aim: SpellCastAim::Untargeted,
            })
            .await
            .unwrap();
        for contact in [
            holtburger_world::ContactState::Grounded,
            holtburger_world::ContactState::Airborne,
            holtburger_world::ContactState::Grounded,
        ] {
            client.world.apply_spatial_body_event(
                &holtburger_world::SpatialBodyEvent::ContactChanged {
                    body_id: holtburger_world::SpatialBodyId::LocalPlayer(Guid(1)),
                    contact,
                },
            );
            assert_eq!(
                client.active_busy_operation(),
                Some(BusyOperationKind::SpellCast)
            );
        }
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn new_character_entry_releases_previous_operation() {
        let mut client = client(0);
        client.arm_busy_operation(crate::client::PendingOperation::SpellCast { target: None });
        client.character_selection.character_id = Some(Guid(2));
        client.begin_world_entry_transition().await.unwrap();
        assert!(client.active_busy_operation.is_none());
    }

    #[test]
    fn naturally_untargeted_formula_ignores_selection() {
        let mut client = client(0);
        Arc::make_mut(&mut client.world.spell_catalog)
            .spells
            .get_mut(&42)
            .unwrap()
            .components[4] = 0x3a;
        assert!(matches!(
            client
                .prepare_spell_cast(
                    42,
                    SpellCastAim::Normal {
                        selection: Some(Guid(2))
                    }
                )
                .unwrap()
                .into_action(),
            GameAction::CastUntargetedSpell(_)
        ));
    }
    #[tokio::test]
    async fn manual_takeover_publishes_movement_without_cancelling_cast() {
        let mut client = client(0);
        let pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            ..WorldPosition::default()
        };
        client
            .world
            .seed_local_player_entity(Guid(1), "Player", pose);
        client
            .world
            .player_entity_mut()
            .unwrap()
            .set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        let capture = tempfile::NamedTempFile::new().unwrap();
        client
            .session
            .set_capture(capture.path().to_str().unwrap())
            .unwrap();
        client
            .handle_command(ClientCommand::CastSpell {
                spell_id: 42,
                aim: SpellCastAim::Untargeted,
            })
            .await
            .unwrap();
        let now = Instant::now();
        let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
        let motion = begin_server_directed_motion(
            EntityMotionDirective::TurnToHeading {
                admission: EntityMotionAdmission {
                    object_instance_sequence: 1,
                    movement_sequence: 1,
                    server_control_sequence: 1,
                    is_autonomous: false,
                },
                params: EntityTurnToParameters {
                    flags: 0,
                    speed: scalar(1.0),
                    desired_heading_degrees: scalar(180.0),
                },
            },
            pose,
            None,
        );
        client
            .movement
            .admit_server_controlled_motion(Some(motion), now, &mut client.world);
        client
            .handle_command(ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
                CharacterDrive::builder().walk().turn_left().build(),
            )))
            .await
            .unwrap();
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .unwrap();
        assert!(client.movement.has_active_manual_drive());
        assert!(!client.movement.has_server_controlled_motion());
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::SpellCast)
        );
        let actions = captured_actions(&capture);
        assert!(matches!(
            actions.first(),
            Some(GameAction::CastUntargetedSpell(_))
        ));
        assert!(
            actions[1..]
                .iter()
                .any(|action| matches!(action, GameAction::MoveToState(_)))
        );
        assert!(actions[1..].iter().all(|action| matches!(
            action,
            GameAction::MoveToState(_) | GameAction::AutonomousPosition(_)
        )));
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
    }

    fn captured_actions(file: &tempfile::NamedTempFile) -> Vec<GameAction> {
        let bytes = std::fs::read(file.path()).unwrap();
        let mut capture = Cursor::new(bytes.as_slice());
        let mut actions = Vec::new();
        while (capture.position() as usize) < bytes.len() {
            assert_eq!(
                capture.read_u8().unwrap(),
                holtburger_session::capture::Direction::Outbound as u8
            );
            capture.read_u64::<LittleEndian>().unwrap();
            let address_len = capture.read_u16::<LittleEndian>().unwrap();
            capture.set_position(capture.position() + u64::from(address_len));
            let packet_len = capture.read_u32::<LittleEndian>().unwrap();
            let mut packet = vec![0; packet_len as usize];
            capture.read_exact(&mut packet).unwrap();
            let mut offset = 0;
            let header = PacketHeader::unpack(&packet, &mut offset).unwrap();
            assert_eq!(header.flags, packet_flags::BLOB_FRAGMENTS);
            let fragment = FragmentHeader::unpack(&packet, &mut offset).unwrap();
            assert_eq!(fragment.count, 1);
            let GameMessage::GameAction(message) =
                GameMessage::unpack(&packet, &mut offset).unwrap()
            else {
                panic!("movement fixture emitted a non-action message");
            };
            assert_eq!(offset, packet.len());
            actions.push(message.action);
        }
        actions
    }

    #[tokio::test]
    async fn repeat_policy_is_ordered_after_login_and_written_once() {
        let mut client = client(0);
        let capture = tempfile::NamedTempFile::new().unwrap();
        client
            .session
            .set_capture(capture.path().to_str().unwrap())
            .unwrap();

        client.send_login_complete().await.unwrap();
        client.establish_attack_repeat_policy().await.unwrap();
        client.establish_attack_repeat_policy().await.unwrap();

        let actions = captured_actions(&capture);
        assert_eq!(actions.len(), 2);
        assert!(matches!(actions[0], GameAction::LoginComplete(_)));
        let GameAction::SetSingleCharacterOption(data) = &actions[1] else {
            panic!("expected repeat option after login complete");
        };
        assert_eq!(data.option, CharacterOption::AutoRepeatAttacks);
        assert!(data.value);
        assert!(
            client
                .world
                .player
                .character_option_enabled(CharacterOption::AutoRepeatAttacks)
        );
    }
}
