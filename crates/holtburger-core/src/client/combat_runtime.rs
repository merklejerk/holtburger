//! Shared combat request execution; world and existing operation owners retain state.
use super::combat_engagement::CombatControlEffect;
use super::movement_types::{
    AutonomousDriveIntent, ClientDirectedCommand, ClientMovementPolicy, Gait, PlayerDriveIntent,
};
use super::types::{
    ActionResultReason, ActionResultSource, ClientAttackProfile, ClientCommand, ClientViewEvent,
    CombatFeedback, SpellCastAim,
};
use super::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_common::properties::{PropertyString, WorldObjectPropertyAccessors};
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

// ACE Player_Melee.cs permits a direct strike at 0.6 m and a melee-visible sticky sequence at
// 4.0 m. Keep normal admission strict, then use a smaller sticky fallback after pursuit stalls so
// client/server cylinder or position disagreement cannot put the request on ACE's exact boundary.
const MELEE_DIRECT_DISTANCE: f32 = 0.6;
const MELEE_STALLED_DISTANCE: f32 = 3.0;
const MELEE_STALL_DURATION: Duration = Duration::from_secs(1);
const MELEE_PROGRESS_DISTANCE: f32 = 0.1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CombatStaticPath {
    Clear,
    Blocked,
    Unknown,
}

/// Target-specific pursuit evidence and the resulting melee-request admission decision.
#[derive(Debug, Clone, Copy)]
pub(super) struct MeleeApproachState {
    /// Target whose approach samples produced this evidence.
    target: Guid,
    /// Smallest separation observed at the last material progress edge.
    closest_distance: f32,
    /// Time at which separation last decreased enough to count as progress.
    last_progress_at: Instant,
    /// Physical admission computed before movement advances the sampled world state.
    request_admitted: bool,
}

impl MeleeApproachState {
    fn sample(
        previous: Option<Self>,
        target: Guid,
        distance: f32,
        path: CombatStaticPath,
        now: Instant,
    ) -> Self {
        let mut state = match previous {
            Some(state) if state.target == target => state,
            _ => Self {
                target,
                closest_distance: distance,
                last_progress_at: now,
                request_admitted: false,
            },
        };
        if state.closest_distance - distance >= MELEE_PROGRESS_DISTANCE {
            state.closest_distance = distance;
            state.last_progress_at = now;
        }
        state.request_admitted = melee_request_admitted(
            distance,
            path,
            now.saturating_duration_since(state.last_progress_at) >= MELEE_STALL_DURATION,
        );
        state
    }

    fn request_admitted_for(self, target: Guid) -> bool {
        self.target == target && self.request_admitted
    }
}

fn melee_request_admitted(distance: f32, path: CombatStaticPath, stalled: bool) -> bool {
    path == CombatStaticPath::Clear
        && (distance <= MELEE_DIRECT_DISTANCE || stalled && distance <= MELEE_STALLED_DISTANCE)
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
    fn to_action(&self) -> GameAction {
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
        let movement_ready = match desired.profile {
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
            ClientAttackProfile::Melee { .. } => self
                .melee_approach_state
                .is_some_and(|state| state.request_admitted_for(desired.target)),
            ClientAttackProfile::Missile { .. } => self.missile_request_ready(),
        };
        self.world.player_combat_mode() == desired.profile.combat_mode()
            && self
                .world
                .combat_target_status(desired.target)
                .is_available()
            && movement_ready
            && self.active_busy_operation.is_none()
            && !self.equipment_change_pending()
            && self.pack_exchange.is_none()
    }

    /// Physical prediction can gate jumping locally. Navigation has no local support solver,
    /// so ACE owns that decision (Player_Missile.cs:64, Player.cs:49); unknown support must not
    /// permanently prevent requests or become an invented grounded body.
    fn missile_request_ready(&self) -> bool {
        match self.movement.movement_policy() {
            ClientMovementPolicy::Navigation => true,
            ClientMovementPolicy::Physical => self
                .world
                .runtime_body_view(SpatialBodyId::LocalPlayer(self.world.player.guid))
                .is_some_and(|body| body.contact == ContactState::Grounded),
        }
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
            self.reset_combat_approach(now);
            return;
        };
        if !self
            .world
            .combat_target_status(desired.target)
            .is_available()
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.reset_combat_approach(now);
            return;
        }
        if self.world.player_combat_mode() != desired.profile.combat_mode()
            && self.combat_engagement.has_sent_sequence()
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.reset_combat_approach(now);
            return;
        }
        // Missile has no pursuit policy and remains compatible with player-owned translation.
        if !matches!(desired.profile, ClientAttackProfile::Melee { .. }) {
            self.reset_combat_approach(now);
            return;
        }
        let distance = self
            .world
            .cylinder_distance(self.world.player.guid, desired.target);
        if distance
            .is_some_and(|distance| distance >= self.combat_tuning.melee_max_chase_distance())
        {
            self.combat_engagement.stop();
            self.emit_combat_status_if_changed(previous_status);
            self.reset_combat_approach(now);
            return;
        }
        if self.movement.has_active_manual_drive() {
            self.interrupt_combat_for_movement(now);
            return;
        }
        // ACE owns target-relative movement after accepting an attack. Its swing motion carries
        // StickToObject and remains authoritative until AttackDone(ActionCancelled) retires the
        // sequence (Player_Melee.cs:215-230, 413-428). Reapplying the initial admission
        // gate here would cancel and reacquire combat whenever sticky motion crossed that edge.
        if self.combat_engagement.has_sent_sequence() {
            self.reset_combat_approach(now);
            return;
        }
        let Some(distance) = distance else {
            self.reset_combat_approach(now);
            return;
        };
        let path = self.combat_static_path(desired.target);
        if path == CombatStaticPath::Unknown {
            self.reset_combat_approach(now);
            return;
        }
        let approach = MeleeApproachState::sample(
            self.melee_approach_state,
            desired.target,
            distance,
            path,
            now,
        );
        self.melee_approach_state = Some(approach);
        if approach.request_admitted_for(desired.target) {
            self.release_combat_approach(now);
            return;
        }
        let Some(player_pose) = self.world.runtime_pose_for_guid(self.world.player.guid) else {
            self.reset_combat_approach(now);
            return;
        };
        let Some(target_pose) = self.world.runtime_pose_for_guid(desired.target) else {
            self.reset_combat_approach(now);
            return;
        };
        let Ok(capabilities) = self.world.resolve_self_movement_capabilities() else {
            self.reset_combat_approach(now);
            return;
        };
        let delta = target_pose.global_coords() - player_pose.global_coords();
        let planar = Vector3::new(delta.x, delta.y, 0.0);
        let planar_distance = planar.length();
        if planar_distance <= f32::EPSILON {
            self.reset_combat_approach(now);
            return;
        }
        let budget = capabilities.resolved_autonomous_run_speed(1.0) * dt.as_secs_f32();
        if budget <= f32::EPSILON {
            self.reset_combat_approach(now);
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

    fn reset_combat_approach(&mut self, now: Instant) {
        self.melee_approach_state = None;
        self.release_combat_approach(now);
    }

    /// Ends desired combat when another movement owner takes control.
    pub(super) fn interrupt_combat_for_movement(&mut self, now: Instant) {
        let previous = self.combat_engagement.status();
        if previous.desired.is_none() {
            return;
        }
        self.combat_engagement.stop();
        self.emit_combat_status_if_changed(previous);
        self.reset_combat_approach(now);
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
                self.send_targeted_attack(engagement.target, engagement.profile, now)
                    .await?;
                self.melee_approach_state = None;
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
        now: Instant,
    ) -> Result<()> {
        let result = match profile {
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
        };
        result?;
        let name = self
            .world
            .entities
            .get(target)
            .and_then(|entity| entity.get_string_prop(PropertyString::Name));
        self.combat_attribution.sent(target, name, now);
        Ok(())
    }

    /// Resolve name-only feedback once against successful physical attack history.
    pub(super) fn attribute_combat_outcome(
        &mut self,
        name: &str,
        now: Instant,
    ) -> super::types::CombatOutcomeContext {
        super::types::CombatOutcomeContext {
            world_generation: self.world_generation,
            attribution: self.combat_attribution.resolve(name, now),
        }
    }

    /// Interpret network text once; unsupported messages carry no cosmetic companion.
    pub(super) fn interpret_server_combat_text(
        &mut self,
        chat_type: ChatMessageTypeId,
        message: &str,
        now: Instant,
    ) -> Option<super::types::ServerTextCombatOutcome> {
        let parsed = super::server_combat_text::recognize(chat_type, message)?;
        Some(super::types::ServerTextCombatOutcome {
            context: super::types::CombatOutcomeContext {
                world_generation: self.world_generation,
                attribution: self.combat_attribution.resolve_text(
                    parsed.defender_name,
                    parsed.source,
                    now,
                ),
            },
            kind: parsed.kind,
        })
    }

    pub(super) fn observe_combat_feedback(&mut self, feedback: &CombatFeedback, now: Instant) {
        let previous = self.combat_engagement.status();
        match feedback {
            CombatFeedback::AttackCommenced => self.combat_engagement.attack_commenced(),
            CombatFeedback::AttackDone { error } => {
                self.combat_engagement.attack_done(*error, now);
                if self.combat_engagement.sent_engagement().is_none() {
                    self.combat_attribution.retire(now);
                }
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
        self.combat_attribution.clear();
        self.combat_approach_drive_active = false;
        self.melee_approach_state = None;
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

        self.set_character_option(CharacterOption::AutoRepeatAttacks, true)
            .await
    }

    pub(super) async fn handle_combat_command(&mut self, command: ClientCommand) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }
        match command {
            ClientCommand::CastSpell { spell_id, aim } => self.cast_spell(spell_id, aim).await,
            ClientCommand::BeginCombatEngagement { target, profile } => {
                if !self.world.combat_target_status(target).is_available() {
                    self.reject_combat_request("Select a valid target before attacking.");
                    // Reassert retained intent so frontends can retire speculative cancellation
                    // ownership even when this refusal leaves an idle status unchanged.
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::CombatStatusUpdated(
                            self.combat_engagement.status(),
                        ));
                    return Ok(());
                }
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
                if self.equipment_change_pending() {
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
                self.cancel_equipment_set_peace();
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
        if self.described_character == Some(self.world.player.guid)
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
        let result = self.send_game_action(action.to_action()).await;
        if let (Ok(()), Some(target)) = (&result, action.target) {
            self.record_sent_targeted_spell(target, action.spell_id);
        }
        if result.is_err() {
            self.clear_busy_operation();
        }
        result
    }

    /// Both explicit casts and spell-bearing item uses supply the same cosmetic identity hints.
    pub(super) fn record_sent_targeted_spell(&mut self, target: Guid, spell_id: u32) {
        if target == self.world.player.guid || target == Guid::NULL {
            return;
        }
        // Item use can proceed without catalog data; missing identity never invents attribution.
        let Some(spell) = self.world.spell_catalog.get(spell_id) else {
            return;
        };
        let name = self
            .world
            .entities
            .get(target)
            .and_then(|entity| entity.get_string_prop(PropertyString::Name));
        self.combat_attribution
            .sent_cast(target, name, &spell.name, Instant::now());
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

    /// Exercise the production wire decoder and message intake rather than bypassing recognition.
    async fn receive_text(
        client: &mut ClientRuntime,
        channel: u32,
        text: &str,
    ) -> Option<super::super::types::ServerTextCombatOutcome> {
        use holtburger_protocol::traits::ProtocolPack;
        let mut bytes = Vec::new();
        GameMessage::ServerMessage(Box::new(ServerMessageData {
            message: text.into(),
            chat_type: channel,
        }))
        .pack(&mut bytes);
        let mut events = client.subscribe_client_view_events();
        client.handle_message(&bytes).await.unwrap();
        let ClientViewEvent::ServerMessage {
            message,
            chat_type,
            combat_outcome,
        } = events.try_recv().unwrap()
        else {
            panic!("expected one server message");
        };
        assert_eq!(message, text);
        assert_eq!(chat_type.raw(), channel);
        while let Ok(event) = events.try_recv() {
            assert!(
                !matches!(
                    event,
                    ClientViewEvent::ServerMessage { .. } | ClientViewEvent::CombatFeedback(_)
                ),
                "duplicate combat/chat publication: {event:?}"
            );
        }
        combat_outcome
    }

    #[tokio::test]
    async fn network_text_preserves_unplaced_confirmations_and_unsupported_chat() {
        use super::super::types::CombatOutcomeAttribution;
        let mut client = client(0);
        for (channel, text) in [
            (
                ChatMessageType::Magic as u32,
                "You burn Drudge for 0 points with Flame.",
            ),
            (
                ChatMessageType::Magic as u32,
                "With Harm Other VII you drain 12 points of health from Drudge.",
            ),
            (
                ChatMessageType::Magic as u32,
                "You scar Drudge for 42 points of periodic nether damage!",
            ),
            (
                ChatMessageType::Magic as u32,
                "With Surge of Affliction you drain 42 points of health from Drudge!",
            ),
            (
                ChatMessageType::CombatSelf as u32,
                "You bleed Drudge for 1 points of periodic health damage!",
            ),
            (ChatMessageType::Magic as u32, "Drudge resists your spell"),
        ] {
            let outcome = receive_text(&mut client, channel, text).await.unwrap();
            assert_eq!(
                outcome.context.attribution,
                CombatOutcomeAttribution::Unplaced
            );
        }
        for (channel, text) in [
            (
                ChatMessageType::Magic as u32,
                "With Heal Other you restore 12 points of health to Drudge.",
            ),
            (
                ChatMessageType::Magic as u32,
                "With Drain Mana you drain 12 points of mana from Drudge.",
            ),
            (
                ChatMessageType::Magic as u32,
                "You gain 12 points of health due to casting Drain Health on Drudge.",
            ),
            (
                ChatMessageType::Magic as u32,
                "Drudge burns you for 12 points with Flame.",
            ),
            (ChatMessageType::Magic as u32, "You fail to affect Drudge."),
            (ChatMessageType::Combat as u32, "Drudge resists your spell"),
            (999, "Drudge resists your spell"),
        ] {
            assert!(receive_text(&mut client, channel, text).await.is_none());
        }
    }

    #[tokio::test]
    async fn successful_cast_with_same_name_creatures_attributes_network_text_until_reset() {
        use super::super::types::{CombatOutcomeAttribution, ServerTextCombatOutcomeKind};
        let mut client = client(0);
        // Only GUID 2 receives a targeted cast; the other same-name creatures are unrelated.
        for guid in [Guid(2), Guid(3), Guid(4), Guid(5)] {
            let mut entity = holtburger_world::entity::Entity::new(
                guid,
                "Drudge".into(),
                WorldPosition::default(),
            );
            entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            client.world.entities.insert(entity);
        }
        let aim = SpellCastAim::Normal {
            selection: Some(Guid(2)),
        };
        client.cast_spell(42, aim).await.unwrap();
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        for (text, kind) in [
            (
                "You burn Drudge for 0 points with Test Spell.",
                ServerTextCombatOutcomeKind::Damage {
                    amount: 0,
                    critical_hit: false,
                },
            ),
            (
                "Critical hit! You burn Drudge for 37 points with Test Spell.",
                ServerTextCombatOutcomeKind::Damage {
                    amount: 37,
                    critical_hit: true,
                },
            ),
            (
                "Drudge resists your spell",
                ServerTextCombatOutcomeKind::Resisted,
            ),
            (
                "You burn Drudge for 7 points of periodic nether damage!",
                ServerTextCombatOutcomeKind::Damage {
                    amount: 7,
                    critical_hit: false,
                },
            ),
            (
                "You burn Drudge for 7 points of periodic nether damage!",
                ServerTextCombatOutcomeKind::Damage {
                    amount: 7,
                    critical_hit: false,
                },
            ),
        ] {
            let outcome = receive_text(&mut client, ChatMessageType::Magic as u32, text)
                .await
                .unwrap();
            assert_eq!(outcome.kind, kind);
            assert_eq!(
                outcome.context.attribution,
                CombatOutcomeAttribution::Attributed { target: Guid(2) }
            );
            assert_eq!(outcome.context.world_generation, client.world_generation);
        }
        let generation = client.world_generation;
        client.bump_world_generation();
        let outcome = receive_text(
            &mut client,
            ChatMessageType::Magic as u32,
            "Drudge resists your spell",
        )
        .await
        .unwrap();
        assert_eq!(outcome.context.world_generation, generation + 1);
        assert_eq!(
            outcome.context.attribution,
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[tokio::test]
    async fn targeted_item_spell_attributes_damage_and_resistance_after_use_completion() {
        use super::super::types::{CombatOutcomeAttribution, ServerTextCombatOutcomeKind};
        use holtburger_common::properties::PropertyDataId;
        use holtburger_world::{entity::Entity, item_use::ItemUseIntent};

        let mut client = client(0);
        let mut wand = Entity::new(Guid(10), "Wand".into(), WorldPosition::default());
        wand.set_did_prop(PropertyDataId::Spell, Guid(42));
        client.world.entities.insert(wand);
        for guid in [Guid(2), Guid(3)] {
            client.world.entities.insert(Entity::new(
                guid,
                "Drudge".into(),
                WorldPosition::default(),
            ));
        }
        assert!(
            client
                .dispatch_item_use(&ItemUseIntent::Targeted {
                    source: Guid(10),
                    target: Guid(2),
                })
                .await
                .unwrap()
        );
        assert_eq!(
            client.application_snapshot().spell_cast_target,
            Some(Guid(2))
        );
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        assert_eq!(client.application_snapshot().spell_cast_target, None);
        for (text, kind) in [
            (
                "You burn Drudge for 37 points with Test Spell.",
                ServerTextCombatOutcomeKind::Damage {
                    amount: 37,
                    critical_hit: false,
                },
            ),
            (
                "Drudge resists your spell",
                ServerTextCombatOutcomeKind::Resisted,
            ),
        ] {
            let outcome = receive_text(&mut client, ChatMessageType::Magic as u32, text)
                .await
                .unwrap();
            assert_eq!(outcome.kind, kind);
            assert_eq!(
                outcome.context.attribution,
                CombatOutcomeAttribution::Attributed { target: Guid(2) }
            );
        }
    }

    #[tokio::test]
    async fn item_use_requires_sent_targeted_spell_identity_for_attribution() {
        use super::super::types::CombatOutcomeAttribution;
        use holtburger_common::properties::PropertyDataId;
        use holtburger_world::{entity::Entity, item_use::ItemUseIntent};

        for mode in [
            "ordinary",
            "unknown-spell",
            "direct",
            "self",
            "busy",
            "failed",
        ] {
            let mut client = client(0);
            let mut wand = Entity::new(Guid(10), "Wand".into(), WorldPosition::default());
            if mode != "ordinary" {
                wand.set_did_prop(
                    PropertyDataId::Spell,
                    Guid(if mode == "unknown-spell" { 99 } else { 42 }),
                );
            }
            client.world.entities.insert(wand);
            let target = if mode == "self" { Guid(1) } else { Guid(2) };
            client.world.entities.insert(Entity::new(
                target,
                "Drudge".into(),
                WorldPosition::default(),
            ));
            if mode == "busy" {
                client.arm_busy_operation(super::super::PendingOperation::UseWithTarget {
                    spell_target: None,
                });
            }
            if mode == "failed" {
                client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
                    .await
                    .unwrap();
            }
            let intent = if mode == "direct" {
                ItemUseIntent::Direct {
                    source: Guid(10),
                    unrestricted: false,
                }
            } else {
                ItemUseIntent::Targeted {
                    source: Guid(10),
                    target,
                }
            };
            let result = client.dispatch_item_use(&intent).await;
            assert_eq!(result.is_err(), mode == "failed", "{mode}");
            if let Ok(dispatched) = result {
                assert_eq!(dispatched, mode != "busy", "{mode}");
            }
            let outcome = client
                .interpret_server_combat_text(
                    ChatMessageType::Magic.into(),
                    "You burn Drudge for 37 points with Test Spell.",
                    Instant::now(),
                )
                .unwrap();
            assert_eq!(
                outcome.context.attribution,
                CombatOutcomeAttribution::Unplaced,
                "{mode}"
            );
        }
    }

    #[tokio::test]
    async fn rejected_busy_failed_self_and_untargeted_casts_do_not_supply_defender_hints() {
        use super::super::types::CombatOutcomeAttribution;
        for mode in ["rejected", "busy", "failed", "self", "untargeted"] {
            let mut client = client(0);
            client
                .world
                .entities
                .insert(holtburger_world::entity::Entity::new(
                    Guid(2),
                    "Drudge".into(),
                    WorldPosition::default(),
                ));
            if mode == "busy" {
                client.arm_busy_operation(super::super::PendingOperation::SpellCast {
                    target: Some(Guid(3)),
                });
            }
            if mode == "failed" {
                client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
                    .await
                    .unwrap();
            }
            let aim = match mode {
                "untargeted" => SpellCastAim::Untargeted,
                "self" => SpellCastAim::Normal {
                    selection: Some(Guid(1)),
                },
                _ => SpellCastAim::Normal {
                    selection: Some(Guid(2)),
                },
            };
            let result = client
                .cast_spell(if mode == "rejected" { 99 } else { 42 }, aim)
                .await;
            assert_eq!(result.is_err(), mode == "failed");
            let outcome = receive_text(
                &mut client,
                ChatMessageType::Magic as u32,
                "You burn Drudge for 1 points with Test Spell.",
            )
            .await
            .unwrap();
            assert_eq!(
                outcome.context.attribution,
                CombatOutcomeAttribution::Unplaced,
                "{mode}"
            );
        }
    }

    #[tokio::test]
    async fn successful_physical_send_with_same_name_creatures_attributes_feedback_until_reset() {
        use super::super::types::CombatOutcomeAttribution;
        let mut client = client(0);
        // Only GUID 2 receives an attack request; the other same-name creatures are unrelated.
        for guid in [Guid(2), Guid(3), Guid(4), Guid(5)] {
            let mut entity = holtburger_world::entity::Entity::new(
                guid,
                "Drudge".into(),
                WorldPosition::default(),
            );
            entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            client.world.entities.insert(entity);
        }
        let now = Instant::now();
        client
            .send_targeted_attack(
                Guid(2),
                ClientAttackProfile::Melee {
                    height: AttackHeight::Medium,
                    power: 0.5,
                },
                now,
            )
            .await
            .unwrap();
        let context = client.attribute_combat_outcome("Drudge", now);
        assert_eq!(context.world_generation, client.world_generation);
        assert_eq!(
            context.attribution,
            CombatOutcomeAttribution::Attributed { target: Guid(2) }
        );
        client.bump_world_generation();
        let after = client.attribute_combat_outcome("Drudge", now);
        assert_eq!(after.world_generation, context.world_generation + 1);
        assert_eq!(after.attribution, CombatOutcomeAttribution::Unplaced);
    }

    #[tokio::test]
    async fn failed_physical_send_never_establishes_attribution_context() {
        use super::super::types::CombatOutcomeAttribution;
        let mut client = client(0);
        client
            .world
            .entities
            .insert(holtburger_world::entity::Entity::new(
                Guid(2),
                "Drudge".into(),
                WorldPosition::default(),
            ));
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let now = Instant::now();
        assert!(
            client
                .send_targeted_attack(
                    Guid(2),
                    ClientAttackProfile::Melee {
                        height: AttackHeight::Medium,
                        power: 0.5
                    },
                    now
                )
                .await
                .is_err()
        );
        assert_eq!(
            client.attribute_combat_outcome("Drudge", now).attribution,
            CombatOutcomeAttribution::Unplaced
        );
    }

    #[test]
    fn melee_request_uses_stall_fallback_inside_the_server_sticky_boundary() {
        for (distance, path, stalled, expected) in [
            (MELEE_DIRECT_DISTANCE, CombatStaticPath::Clear, false, true),
            (
                MELEE_DIRECT_DISTANCE + 0.01,
                CombatStaticPath::Clear,
                false,
                false,
            ),
            (MELEE_STALLED_DISTANCE, CombatStaticPath::Clear, true, true),
            (
                MELEE_STALLED_DISTANCE + 0.01,
                CombatStaticPath::Clear,
                true,
                false,
            ),
            (1.0, CombatStaticPath::Blocked, true, false),
            (1.0, CombatStaticPath::Unknown, true, false),
        ] {
            assert_eq!(melee_request_admitted(distance, path, stalled), expected);
        }
    }

    #[test]
    fn melee_approach_admission_requires_target_specific_lack_of_progress() {
        let start = Instant::now();
        let target = Guid(2);
        let sample = |previous, target, distance, elapsed| {
            MeleeApproachState::sample(
                previous,
                target,
                distance,
                CombatStaticPath::Clear,
                start + elapsed,
            )
        };
        let initial_distance = 2.5;
        let initial = sample(None, target, initial_distance, Duration::ZERO);
        let almost_stalled = sample(
            Some(initial),
            target,
            initial_distance,
            MELEE_STALL_DURATION - Duration::from_millis(1),
        );
        assert!(!almost_stalled.request_admitted_for(target));
        let stalled = sample(
            Some(initial),
            target,
            initial_distance,
            MELEE_STALL_DURATION,
        );
        assert!(stalled.request_admitted_for(target));

        let progress_at = Duration::from_millis(900);
        let progressed_distance = initial_distance - MELEE_PROGRESS_DISTANCE - 0.01;
        let progressed = sample(Some(initial), target, progressed_distance, progress_at);
        let after_progress = sample(
            Some(progressed),
            target,
            progressed_distance,
            progress_at + Duration::from_millis(100),
        );
        assert!(!after_progress.request_admitted_for(target));
        let stalled_after_progress = sample(
            Some(progressed),
            target,
            progressed_distance,
            progress_at + MELEE_STALL_DURATION,
        );
        assert!(stalled_after_progress.request_admitted_for(target));

        let replacement = sample(
            Some(stalled),
            Guid(3),
            initial_distance,
            progress_at + MELEE_STALL_DURATION,
        );
        assert!(!replacement.request_admitted_for(Guid(3)));
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
    async fn melee_handoff_observes_manual_release_before_preparing_pursuit() {
        let dt = Duration::from_millis(super::super::PHYSICS_TICK_MS);
        let held =
            || PlayerDriveIntent::ManualHeld(CharacterDrive::builder().walk().forward().build());
        for (case, initial, commands, retain_melee) in [
            ("held", held(), Vec::new(), false),
            (
                "released",
                held(),
                vec![PlayerDriveIntent::ReleaseManual],
                true,
            ),
            (
                "expired",
                PlayerDriveIntent::ManualPulse {
                    state: CharacterDrive::builder().walk().forward().build(),
                    duration: dt,
                },
                Vec::new(),
                true,
            ),
            (
                "reacquired",
                held(),
                vec![PlayerDriveIntent::ReleaseManual, held()],
                false,
            ),
        ] {
            let mut client = client(0);
            let now = Instant::now();
            let pose = WorldPosition {
                landblock_id: Guid(0x1234_0001),
                ..WorldPosition::default()
            };
            client
                .world
                .seed_local_player_entity(Guid(1), "Player", pose);
            let mut target = holtburger_world::entity::Entity::new(Guid(2), "Target".into(), pose);
            target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            client.world.add_entity(target);
            client
                .handle_command(ClientCommand::DriveSelf(initial))
                .await
                .unwrap();
            client
                .movement
                .tick(now, &mut client.world, &mut client.session)
                .await
                .unwrap();
            assert!(client.movement.has_active_manual_drive());
            for command in commands {
                client
                    .handle_command(ClientCommand::DriveSelf(command))
                    .await
                    .unwrap();
            }
            client
                .handle_command(ClientCommand::BeginCombatEngagement {
                    target: Guid(2),
                    profile: ClientAttackProfile::Melee {
                        height: AttackHeight::Medium,
                        power: 0.5,
                    },
                })
                .await
                .unwrap();
            client
                .advance_physics_tick(
                    now + dt,
                    dt,
                    super::super::runtime_profile::RuntimePhaseProfile::begin("physics_tick"),
                    #[cfg(feature = "runtime-fixture")]
                    None,
                )
                .await
                .unwrap();
            assert_eq!(
                client
                    .combat_engagement
                    .status()
                    .desired
                    .map(|engagement| engagement.target),
                retain_melee.then_some(Guid(2)),
                "{case}",
            );
        }
    }

    #[tokio::test]
    async fn invalid_attack_starts_report_feedback_and_preserve_retained_intent() {
        for profile in [
            ClientAttackProfile::Melee {
                height: AttackHeight::High,
                power: 0.25,
            },
            ClientAttackProfile::Missile {
                height: AttackHeight::Low,
                accuracy: 0.75,
            },
        ] {
            for target in [Guid::NULL, Guid(1), Guid(3), Guid(4)] {
                for retained in [false, true] {
                    let mut client = client(0);
                    client.world.add_entity(combat_target(Guid(2)));
                    // A present world object is insufficient: physical attacks require a creature.
                    client
                        .world
                        .add_entity(holtburger_world::entity::Entity::new(
                            Guid(3),
                            "Item".into(),
                            WorldPosition {
                                landblock_id: Guid(0x1234_0001),
                                ..WorldPosition::default()
                            },
                        ));
                    if retained {
                        client
                            .handle_command(ClientCommand::BeginCombatEngagement {
                                target: Guid(2),
                                profile,
                            })
                            .await
                            .unwrap();
                    }
                    let previous = client.combat_engagement.status();
                    let sequence = client.session.game_action_sequence;
                    let mut events = client.subscribe_client_view_events();
                    client
                        .handle_command(ClientCommand::BeginCombatEngagement { target, profile })
                        .await
                        .unwrap();
                    assert_eq!(client.combat_engagement.status(), previous);
                    assert_eq!(client.session.game_action_sequence, sequence);
                    let ClientViewEvent::ActionResult { source, reason } =
                        events.try_recv().unwrap()
                    else {
                        panic!("Expected rejected attack feedback");
                    };
                    assert_eq!(source, ActionResultSource::Client);
                    let ActionResultReason::General(message) = reason else {
                        panic!("Expected local attack refusal");
                    };
                    assert_eq!(message, "Select a valid target before attacking.");
                    let ClientViewEvent::CombatStatusUpdated(status) = events.try_recv().unwrap()
                    else {
                        panic!("Expected retained combat status after refusal");
                    };
                    assert_eq!(status, previous);
                    assert!(events.try_recv().is_err());
                }
            }
        }
    }

    /// Available world creature used by command tests independently of spell fixtures.
    fn combat_target(guid: Guid) -> holtburger_world::entity::Entity {
        let mut target = holtburger_world::entity::Entity::new(
            guid,
            "Target".into(),
            WorldPosition {
                landblock_id: Guid(0x1234_0001),
                ..WorldPosition::default()
            },
        );
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target
    }

    #[tokio::test]
    async fn manual_movement_interrupts_melee_but_preserves_missile_combat() {
        let mut client = client(0);
        client.world.add_entity(combat_target(Guid(2)));
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
    fn missile_request_admission_uses_the_selected_simulation_policy() {
        let mut client = client(0);
        client.world.seed_local_player_entity(
            Guid(1),
            "Archer",
            WorldPosition {
                landblock_id: Guid(0x1234_0000),
                ..WorldPosition::default()
            },
        );
        for policy in [
            ClientMovementPolicy::Physical,
            ClientMovementPolicy::Navigation,
        ] {
            client.movement = crate::client::movement::MovementSystem::with_policy(policy);
            for contact in [
                ContactState::Unknown,
                ContactState::Airborne,
                ContactState::Sliding,
                ContactState::Grounded,
            ] {
                client.world.apply_spatial_body_event(
                    &holtburger_world::SpatialBodyEvent::ContactChanged {
                        body_id: holtburger_world::SpatialBodyId::LocalPlayer(Guid(1)),
                        contact,
                    },
                );
                assert_eq!(
                    client.missile_request_ready(),
                    policy == ClientMovementPolicy::Navigation || contact == ContactState::Grounded,
                    "{policy:?} / {contact:?}"
                );
            }
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
            let action = prepared.to_action();
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
        client.described_character = Some(Guid(1));
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
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
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
                    aim: SpellCastAim::Normal {
                        selection: Some(Guid(2))
                    }
                })
                .await
                .is_err()
        );
        assert!(client.active_busy_operation.is_none());
        let mut states = Vec::new();
        let mut targets = Vec::new();
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::BusyStateUpdated { busy } => states.push(busy),
                ClientViewEvent::SpellCastTargetUpdated { target } => targets.push(target),
                _ => {}
            }
        }
        assert_eq!(states, [Some(BusyOperationKind::SpellCast), None]);
        assert_eq!(targets, [Some(Guid(2)), None]);
        assert_eq!(client.application_snapshot().spell_cast_target, None);
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
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
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
                .to_action(),
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
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
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
