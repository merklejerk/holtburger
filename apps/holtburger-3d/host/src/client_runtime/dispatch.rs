//! Client-authority command dispatch organized by domain.

use std::sync::Arc;

use holtburger_core::ClientCommand;

use super::ClientHostRuntime;
use super::commands::ClientHostCommand;
use crate::protocol::{HostResponse, ProtocolError, application_error};

async fn send_unit(
    runtime: &ClientHostRuntime,
    command: ClientCommand,
) -> Result<HostResponse, ProtocolError> {
    runtime
        .send_command(command)
        .await
        .map(|()| HostResponse::Unit)
        .map_err(application_error)
}

async fn unit_result(result: anyhow::Result<()>) -> Result<HostResponse, ProtocolError> {
    result
        .map(|()| HostResponse::Unit)
        .map_err(application_error)
}

async fn dispatch_character_and_housing(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;
    match command {
        CreateClientCharacter { draft } => {
            let catalog = Arc::new(
                runtime
                    .content
                    .repository
                    .read_character_gen_catalog()
                    .map_err(application_error)?,
            );
            let request = draft.build_request(catalog).map_err(application_error)?;
            send_unit(runtime, ClientCommand::CreateCharacter(Box::new(request))).await
        }
        DeleteClientCharacter { slot } => {
            send_unit(runtime, ClientCommand::DeleteCharacter { slot }).await
        }
        RestoreClientCharacter { guid } => {
            send_unit(runtime, ClientCommand::RestoreCharacter(guid)).await
        }
        SelectClientCharacter { guid } => unit_result(runtime.select_character(guid).await).await,
        SetClientCharacterTitle {
            character,
            title_id,
        } => {
            send_unit(
                runtime,
                ClientCommand::SetCharacterTitle {
                    character,
                    title_id,
                },
            )
            .await
        }
        SetClientGameplayOption { option, enabled } => {
            send_unit(
                runtime,
                ClientCommand::SetCharacterOption {
                    option: option.into(),
                    value: enabled,
                },
            )
            .await
        }
        SetClientAppearanceOption { option, enabled } => {
            send_unit(
                runtime,
                ClientCommand::SetCharacterOption {
                    option: option.into(),
                    value: enabled,
                },
            )
            .await
        }
        EvaluateClientProgression {
            request_id,
            intents,
        } => {
            send_unit(
                runtime,
                ClientCommand::EvaluateProgression {
                    request_id,
                    intents,
                },
            )
            .await
        }
        SubmitClientProgression { quote } => {
            send_unit(runtime, ClientCommand::SubmitProgression(quote)).await
        }
        QueryClientHousingAccess => send_unit(runtime, ClientCommand::QueryHousingAccess).await,
        SearchClientHousing { house_type } => {
            send_unit(runtime, ClientCommand::SearchHousing { house_type }).await
        }
        SubmitClientHousingManagement { request } => {
            send_unit(runtime, ClientCommand::SubmitHousingManagement(request)).await
        }
        RefreshClientHousing => send_unit(runtime, ClientCommand::RefreshHousing).await,
        PreviewClientHousingPayment { request } => {
            send_unit(runtime, ClientCommand::PreviewHousingPayment(request)).await
        }
        SubmitClientHousingPayment { request } => {
            send_unit(runtime, ClientCommand::SubmitHousingPayment(request)).await
        }
        _ => unreachable!("non-character/housing command passed to character/housing dispatcher"),
    }
}

async fn dispatch_combat_and_interaction(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;
    match command {
        CastClientSpell { spell_id, aim } => {
            send_unit(runtime, ClientCommand::CastSpell { spell_id, aim }).await
        }
        BeginClientCombatEngagement {
            target,
            profile,
            intent_sequence,
        } => {
            let profile = profile
                .validated()
                .map_err(|err| application_error(anyhow::anyhow!(err)))?;
            send_unit(
                runtime,
                ClientCommand::BeginCombatEngagement {
                    target,
                    profile,
                    intent_sequence,
                },
            )
            .await
        }
        UpdateClientCombatProfile { profile } => {
            let profile = profile
                .validated()
                .map_err(|err| application_error(anyhow::anyhow!(err)))?;
            send_unit(runtime, ClientCommand::UpdateCombatProfile(profile)).await
        }
        StopClientCombatEngagement { intent_sequence } => {
            send_unit(
                runtime,
                ClientCommand::StopCombatEngagement { intent_sequence },
            )
            .await
        }
        ToggleClientCombatMode => send_unit(runtime, ClientCommand::ToggleCombatMode).await,
        SetClientRestPosture { posture } => {
            send_unit(runtime, ClientCommand::SetRestPosture(posture)).await
        }
        CancelClientRestPosture => send_unit(runtime, ClientCommand::CancelRestPosture).await,
        SetClientCombatMode { mode } => {
            send_unit(runtime, ClientCommand::SetCombatMode(mode.into())).await
        }
        ExamineClientEntity { guid, refresh } => {
            send_unit(
                runtime,
                ClientCommand::RequestAppraisal {
                    guid,
                    output: holtburger_core::AppraisalOutputDemand::Full,
                    allow_cached_preview: refresh,
                },
            )
            .await
        }
        RequestClientFactsAppraisal { guid } => {
            send_unit(
                runtime,
                ClientCommand::RequestAppraisal {
                    guid,
                    output: holtburger_core::AppraisalOutputDemand::FactsOnly,
                    allow_cached_preview: false,
                },
            )
            .await
        }
        CancelClientAppraisal { guid, demand } => {
            send_unit(
                runtime,
                ClientCommand::CancelAppraisal {
                    guid,
                    output: demand,
                },
            )
            .await
        }
        ReadClientBookPage {
            player,
            book,
            page_index,
        } => {
            send_unit(
                runtime,
                ClientCommand::ReadBookPage {
                    player,
                    book,
                    page_index,
                },
            )
            .await
        }
        QueryClientSpellInspection { query } => {
            send_unit(runtime, ClientCommand::QuerySpellInspection(query)).await
        }
        QueryClientEntityHealth { guid } => {
            send_unit(runtime, ClientCommand::QueryHealth(guid)).await
        }
        _ => unreachable!("non-combat/interaction command passed to combat/interaction dispatcher"),
    }
}

async fn dispatch_inventory_and_trade(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;
    match command {
        QueryClientItemUseTarget { query } => {
            send_unit(runtime, ClientCommand::QueryItemUseTarget(query)).await
        }
        PreviewClientSalvage { request } => {
            send_unit(runtime, ClientCommand::PreviewSalvage(request)).await
        }
        SubmitClientSalvage { request } => {
            send_unit(runtime, ClientCommand::SubmitSalvage(request)).await
        }
        SubmitClientItemUse { request } => {
            send_unit(runtime, ClientCommand::SubmitItemUse(request)).await
        }
        ApplyClientEquipmentSet { bindings, storage } => {
            send_unit(
                runtime,
                ClientCommand::ApplyEquipmentSet {
                    bindings: bindings
                        .into_iter()
                        .map(
                            |binding| holtburger_core::client::equipment_set::EquipmentBinding {
                                item: binding.item,
                                target: holtburger_common::properties::EquipMask::from_bits_retain(
                                    binding.target,
                                ),
                            },
                        )
                        .collect(),
                    storage,
                },
            )
            .await
        }
        CloseClientContainer { guid } => {
            send_unit(runtime, ClientCommand::CloseContainer(guid)).await
        }
        AutoMergeClientContainer { container, policy } => {
            send_unit(
                runtime,
                ClientCommand::AutoMergeContainer { container, policy },
            )
            .await
        }
        SubmitClientInventory { intent, storage } => {
            send_unit(runtime, ClientCommand::SubmitInventory { intent, storage }).await
        }
        PreviewClientInventory { request } => {
            send_unit(runtime, ClientCommand::PreviewInventory(request)).await
        }
        PreviewClientVendor { request } => {
            send_unit(runtime, ClientCommand::PreviewVendorTrade(request)).await
        }
        SubmitClientVendor { request } => {
            send_unit(runtime, ClientCommand::VendorTrade(request)).await
        }
        SubmitClientTrade { request } => send_unit(runtime, ClientCommand::Trade(request)).await,
        RequestClientBarber { request } => send_unit(runtime, ClientCommand::Barber(request)).await,
        _ => unreachable!("non-inventory/trade command passed to inventory/trade dispatcher"),
    }
}

async fn dispatch_social_and_corpse(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;
    match command {
        RespondToClientConfirmation {
            request_id,
            accepted,
        } => {
            let request_id = request_id.parse::<u64>().map_err(application_error)?;
            send_unit(
                runtime,
                ClientCommand::RespondToConfirmation {
                    request_id,
                    accepted,
                },
            )
            .await
        }
        SubmitClientAllegiance { action } => send_unit(runtime, action.into()).await,
        SubmitClientSquelch { action } => send_unit(runtime, action.into()).await,
        AbandonClientContract { id } => {
            send_unit(runtime, ClientCommand::AbandonContract { id }).await
        }
        SubmitClientFriends { action } => send_unit(runtime, action.into()).await,
        SubmitClientParty { action } => send_unit(runtime, action.into()).await,
        SetClientPartyUpdates { enabled } => {
            send_unit(
                runtime,
                ClientCommand::SetFellowshipUpdatesSubscribed { enabled },
            )
            .await
        }
        RecallClient { destination } => {
            send_unit(runtime, ClientCommand::Recall(destination)).await
        }
        QueryClientDeathLocations { query } => {
            send_unit(runtime, ClientCommand::QueryDeathLocations(query)).await
        }
        ManageClientCorpseConsent { action } => {
            send_unit(runtime, ClientCommand::ManageCorpseConsent(action)).await
        }
        SetClientCorpsePermission {
            player_name,
            granted,
        } => {
            send_unit(
                runtime,
                if granted {
                    ClientCommand::AddPlayerPermission { player_name }
                } else {
                    ClientCommand::RemovePlayerPermission { player_name }
                },
            )
            .await
        }
        SetClientCorpseConsent { enabled } => {
            send_unit(
                runtime,
                ClientCommand::SetCharacterOption {
                    option: holtburger_common::CharacterOption::AcceptCorpseLootingPermissions,
                    value: enabled,
                },
            )
            .await
        }
        KillClientCharacter => send_unit(runtime, ClientCommand::Suicide).await,
        SendClientChat { request } => unit_result(runtime.send_chat(request).await).await,
        _ => unreachable!("non-social/corpse command passed to social/corpse dispatcher"),
    }
}

async fn dispatch_motion_and_camera(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;
    match command {
        ReplaceClientDrive { request } => unit_result(runtime.replace_drive(request).await).await,
        QueueClientCharacterMotionEvent { request } => {
            unit_result(runtime.queue_character_motion_event(request).await).await
        }
        TeleportClientToMapPosition { position } => {
            let destination = position.destination().map_err(application_error)?;
            send_unit(runtime, ClientCommand::TeleportToMapPosition(destination)).await
        }
        StartClientCamera { request } => unit_result(runtime.start_camera(request).await).await,
        SetClientCameraIntent { request } => {
            unit_result(runtime.set_camera_intent(request).await).await
        }
        SetClientEntityCollisionDisabled { disabled } => {
            send_unit(runtime, ClientCommand::SetEntityCollisionDisabled(disabled)).await
        }
        SetClientCameraClearance { request } => {
            unit_result(runtime.set_camera_clearance(request).await).await
        }
        SetClientPreciseJumpAim { request } => {
            unit_result(runtime.set_precise_jump_aim(request).await).await
        }
        QueryClientEntitySelectionCandidates { request } => {
            unit_result(runtime.query_entity_selection_candidates(request).await).await
        }
        CommitClientPreciseJump { request } => {
            unit_result(runtime.commit_precise_jump(request).await).await
        }
        CancelClientPreciseJump { request } => {
            unit_result(runtime.cancel_precise_jump(request).await).await
        }
        AcknowledgeClientWorldReveal { world_generation } => {
            unit_result(runtime.acknowledge_world_reveal(world_generation).await).await
        }
        StopClientCamera { request } => unit_result(runtime.stop_camera(request).await).await,
        _ => unreachable!("non-motion/camera command passed to motion/camera dispatcher"),
    }
}

/// Dispatches one client-only command against the client authority.
pub async fn dispatch_client(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;

    match command {
        ClientPerformance { request } => {
            let state = runtime.state.lock().await;
            if !state.accepting {
                return Err(application_error(anyhow::anyhow!(
                    "Client diagnostics retired"
                )));
            }
            let snapshot = runtime
                .performance
                .control(request)
                .map_err(application_error)?;
            serde_json::to_value(snapshot)
                .map(HostResponse::Json)
                .map_err(application_error)
        }
        StartClient { startup } => unit_result(runtime.start(startup).await).await,
        RequestClientCurrentState => unit_result(runtime.request_current_state().await).await,
        ReportClientSelectedEntity { guid } => {
            runtime.report_selected_entity(guid).await;
            Ok(HostResponse::Unit)
        }
        SetClientAutomationPaused { paused } => {
            unit_result(runtime.set_automation_paused(paused).await).await
        }
        SubmitClientApiScreenshot {
            request_id,
            content_type,
            base64_data,
            error,
        } => {
            runtime
                .submit_api_screenshot(&request_id, content_type, base64_data, error)
                .await;
            Ok(HostResponse::Unit)
        }
        LogoutClient => send_unit(runtime, ClientCommand::Logout).await,
        DisconnectClient => unit_result(runtime.disconnect().await).await,

        command @ (CreateClientCharacter { .. }
        | DeleteClientCharacter { .. }
        | RestoreClientCharacter { .. }
        | SelectClientCharacter { .. }
        | SetClientCharacterTitle { .. }
        | SetClientGameplayOption { .. }
        | SetClientAppearanceOption { .. }
        | EvaluateClientProgression { .. }
        | SubmitClientProgression { .. }
        | QueryClientHousingAccess
        | SearchClientHousing { .. }
        | SubmitClientHousingManagement { .. }
        | RefreshClientHousing
        | PreviewClientHousingPayment { .. }
        | SubmitClientHousingPayment { .. }) => {
            dispatch_character_and_housing(runtime, command).await
        }

        command @ (CastClientSpell { .. }
        | BeginClientCombatEngagement { .. }
        | UpdateClientCombatProfile { .. }
        | StopClientCombatEngagement { .. }
        | ToggleClientCombatMode
        | SetClientRestPosture { .. }
        | CancelClientRestPosture
        | SetClientCombatMode { .. }
        | ExamineClientEntity { .. }
        | RequestClientFactsAppraisal { .. }
        | CancelClientAppraisal { .. }
        | ReadClientBookPage { .. }
        | QueryClientSpellInspection { .. }
        | QueryClientEntityHealth { .. }) => {
            dispatch_combat_and_interaction(runtime, command).await
        }

        command @ (QueryClientItemUseTarget { .. }
        | PreviewClientSalvage { .. }
        | SubmitClientSalvage { .. }
        | SubmitClientItemUse { .. }
        | ApplyClientEquipmentSet { .. }
        | CloseClientContainer { .. }
        | AutoMergeClientContainer { .. }
        | SubmitClientInventory { .. }
        | PreviewClientInventory { .. }
        | PreviewClientVendor { .. }
        | SubmitClientVendor { .. }
        | SubmitClientTrade { .. }
        | RequestClientBarber { .. }) => dispatch_inventory_and_trade(runtime, command).await,

        command @ (RespondToClientConfirmation { .. }
        | SubmitClientAllegiance { .. }
        | SubmitClientSquelch { .. }
        | AbandonClientContract { .. }
        | SubmitClientFriends { .. }
        | SubmitClientParty { .. }
        | SetClientPartyUpdates { .. }
        | RecallClient { .. }
        | QueryClientDeathLocations { .. }
        | ManageClientCorpseConsent { .. }
        | SetClientCorpsePermission { .. }
        | SetClientCorpseConsent { .. }
        | KillClientCharacter
        | SendClientChat { .. }) => dispatch_social_and_corpse(runtime, command).await,

        command @ (ReplaceClientDrive { .. }
        | QueueClientCharacterMotionEvent { .. }
        | TeleportClientToMapPosition { .. }
        | StartClientCamera { .. }
        | SetClientCameraIntent { .. }
        | SetClientEntityCollisionDisabled { .. }
        | SetClientCameraClearance { .. }
        | SetClientPreciseJumpAim { .. }
        | QueryClientEntitySelectionCandidates { .. }
        | CommitClientPreciseJump { .. }
        | CancelClientPreciseJump { .. }
        | AcknowledgeClientWorldReveal { .. }
        | StopClientCamera { .. }) => dispatch_motion_and_camera(runtime, command).await,
    }
}
