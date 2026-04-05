pub const CHARACTER_LIST: &[u8] = include_bytes!("../tests/fixtures/character_list.bin");
pub const CHARACTER_CREATE: &[u8] = include_bytes!("../tests/fixtures/character_create.bin");
pub const CHARACTER_CREATE_RESPONSE_OK: &[u8] =
    include_bytes!("../tests/fixtures/character_create_response_ok.bin");
pub const CHARACTER_CREATE_RESPONSE_NAME_IN_USE: &[u8] =
    include_bytes!("../tests/fixtures/character_create_response_name_in_use.bin");
pub const CHARACTER_DELETE_REQUEST: &[u8] =
    include_bytes!("../tests/fixtures/character_delete_request.bin");
pub const CHARACTER_DELETE_RESPONSE: &[u8] =
    include_bytes!("../tests/fixtures/character_delete_response.bin");
pub const PLAYER_DESCRIPTION: &[u8] = include_bytes!("../tests/fixtures/player_description.bin");
pub const UPDATE_PROPERTY_INT: &[u8] = include_bytes!("../tests/fixtures/update_property_int.bin");
pub const CHARACTER_ENTER_WORLD: &[u8] =
    include_bytes!("../tests/fixtures/character_enter_world.bin");
pub const CHARACTER_ENTER_WORLD_REQUEST: &[u8] =
    include_bytes!("../tests/fixtures/character_enter_world_request.bin");
pub const CHARACTER_ERROR: &[u8] = include_bytes!("../tests/fixtures/character_error.bin");
pub const CHARACTER_RESTORE_REQUEST: &[u8] =
    include_bytes!("../tests/fixtures/character_restore_request.bin");
pub const CHARACTER_RESTORE_RESPONSE: &[u8] =
    include_bytes!("../tests/fixtures/character_restore_response.bin");
pub const PLAYER_DESCRIPTION_MINIMAL: &[u8] =
    include_bytes!("../tests/fixtures/player_description_minimal.bin");
pub const CREATURE_SKILL_MELEE_DEF: &[u8] =
    include_bytes!("../tests/fixtures/creature_skill_melee_def.bin");
pub const MOVEMENT_EVENT_MOVETO: &[u8] =
    include_bytes!("../tests/fixtures/movement_event_moveto.bin");
pub const MOVEMENT_EVENT_MOVETO_OBJ: &[u8] =
    include_bytes!("../tests/fixtures/movement_event_moveto_obj.bin");
pub const MOVEMENT_TURN_TO_OBJ: &[u8] =
    include_bytes!("../tests/fixtures/movement_turn_to_obj.bin");
pub const MOVEMENT_EVENT_COMPLEX: &[u8] =
    include_bytes!("../tests/fixtures/movement_event_complex.bin");
pub const MOVEMENT_EVENT_TURN_TO_OBJ: &[u8] =
    include_bytes!("../tests/fixtures/movement_event_turn_to_obj.bin");
pub const MOVEMENT_EVENT_IDLE: &[u8] = include_bytes!("../tests/fixtures/movement_event_idle.bin");
pub const MOVEMENT_MOVE_TO_POS: &[u8] =
    include_bytes!("../tests/fixtures/movement_move_to_pos.bin");
pub const ACTION_RAISE_ATTRIBUTE: &[u8] =
    include_bytes!("../tests/fixtures/action_raise_attribute.bin");
pub const ACTION_RAISE_VITAL: &[u8] = include_bytes!("../tests/fixtures/action_raise_vital.bin");
pub const ACTION_RAISE_SKILL: &[u8] = include_bytes!("../tests/fixtures/action_raise_skill.bin");
pub const ACTION_TALK: &[u8] = include_bytes!("../tests/fixtures/action_talk.bin");
pub const ACTION_TELL: &[u8] = include_bytes!("../tests/fixtures/action_tell.bin");
pub const MOVE_TO_STATE: &[u8] = include_bytes!("../tests/fixtures/move_to_state.bin");
pub const PUBLIC_UPDATE_POSITION: &[u8] =
    include_bytes!("../tests/fixtures/public_update_position.bin");
pub const PRIVATE_UPDATE_POSITION: &[u8] =
    include_bytes!("../tests/fixtures/private_update_position.bin");
pub const PLAYER_TELEPORT: &[u8] = include_bytes!("../tests/fixtures/player_teleport.bin");
pub const VIEW_CONTENTS: &[u8] = include_bytes!("../tests/fixtures/view_contents.bin");
pub const ACTION_DROP_ITEM: &[u8] = include_bytes!("../tests/fixtures/action_drop_item.bin");
pub const ACTION_PUT_ITEM: &[u8] = include_bytes!("../tests/fixtures/action_put_item.bin");
pub const ACTION_CREATE_TINKERING_TOOL: &[u8] =
    include_bytes!("../tests/fixtures/action_create_tinkering_tool.bin");
pub const ACTION_USE: &[u8] = include_bytes!("../tests/fixtures/action_use.bin");
pub const GAMEPLAY_OPTIONS_TUI_2026_02_07: &[u8] =
    include_bytes!("../tests/fixtures/gameplay_options_tui_2026_02_07.bin");
pub const ENCHANTMENT_SIMPLE: &[u8] = include_bytes!("../tests/fixtures/enchantment_simple.bin");
pub const HEAR_SPEECH: &[u8] = include_bytes!("../tests/fixtures/hear_speech.bin");
pub const HEAR_RANGED_SPEECH: &[u8] = include_bytes!("../tests/fixtures/hear_ranged_speech.bin");
pub const EMOTE_TEXT: &[u8] = include_bytes!("../tests/fixtures/emote_text.bin");
pub const SOUL_EMOTE: &[u8] = include_bytes!("../tests/fixtures/soul_emote.bin");
pub const WEENIE_ERROR: &[u8] = include_bytes!("../tests/fixtures/weenie_error.bin");
pub const WEENIE_ERROR_WITH_STRING: &[u8] =
    include_bytes!("../tests/fixtures/weenie_error_with_string.bin");
pub const DDD_INTERROGATION_RESPONSE: &[u8] =
    include_bytes!("../tests/fixtures/ddd_interrogation_response.bin");
pub const SOUND: &[u8] = include_bytes!("../tests/fixtures/sound.bin");
pub const PLAY_EFFECT: &[u8] = include_bytes!("../tests/fixtures/play_effect.bin");
pub const ACTION_IDENTIFY: &[u8] = include_bytes!("../tests/fixtures/action_identify.bin");
pub const ACTION_LOGIN_COMPLETE: &[u8] =
    include_bytes!("../tests/fixtures/action_login_complete.bin");
pub const ACTION_PING_REQUEST: &[u8] = include_bytes!("../tests/fixtures/action_ping_request.bin");
pub const ACTION_SET_SINGLE_CHARACTER_OPTION: &[u8] =
    include_bytes!("../tests/fixtures/action_set_single_character_option.bin");
pub const ACTION_CONFIRMATION_RESPONSE: &[u8] =
    include_bytes!("../tests/fixtures/action_confirmation_response.bin");
pub const FORCE_OBJ_DESC_SEND: &[u8] = include_bytes!("../tests/fixtures/force_obj_desc_send.bin");
pub const OBJ_DESC_EVENT: &[u8] = include_bytes!("../tests/fixtures/obj_desc_event.bin");
pub const UPDATE_SKILL_LEVEL_PRIVATE: &[u8] =
    include_bytes!("../tests/fixtures/update_skill_level_private.bin");
pub const UPDATE_SKILL_LEVEL_PUBLIC: &[u8] =
    include_bytes!("../tests/fixtures/update_skill_level_public.bin");
pub const UPDATE_SKILL_PRIVATE: &[u8] =
    include_bytes!("../tests/fixtures/update_skill_private.bin");
pub const UPDATE_VITAL_PRIVATE: &[u8] =
    include_bytes!("../tests/fixtures/update_vital_private.bin");
pub const UPDATE_ATTRIBUTE_PRIVATE: &[u8] =
    include_bytes!("../tests/fixtures/update_attribute_private.bin");
pub const UPDATE_VITAL_CURRENT_PRIVATE: &[u8] =
    include_bytes!("../tests/fixtures/update_vital_current_private.bin");
pub const PLAYER_CREATE: &[u8] = include_bytes!("../tests/fixtures/player_create.bin");
pub const OBJ_DESC_EVENT_DROP: &[u8] = include_bytes!("../tests/fixtures/obj_desc_event_drop.bin");

pub const PING_RESPONSE: &[u8] = include_bytes!("../tests/fixtures/ping_response.bin");
pub const ARMOR_PROFILE: &[u8] = include_bytes!("../tests/fixtures/armor_profile.bin");
pub const CREATURE_PROFILE: &[u8] = include_bytes!("../tests/fixtures/creature_profile.bin");
pub const WEAPON_PROFILE: &[u8] = include_bytes!("../tests/fixtures/weapon_profile.bin");
pub const HOOK_PROFILE: &[u8] = include_bytes!("../tests/fixtures/hook_profile.bin");
pub const ARMOR_LEVEL: &[u8] = include_bytes!("../tests/fixtures/armor_level.bin");
pub const IDENTIFY_OBJECT_DATA: &[u8] =
    include_bytes!("../tests/fixtures/identify_object_data.bin");
pub const USE_DATA: &[u8] = include_bytes!("../tests/fixtures/use_data.bin");
pub const USE_WITH_TARGET_DATA: &[u8] =
    include_bytes!("../tests/fixtures/use_with_target_data.bin");
pub const MODEL_DATA: &[u8] = include_bytes!("../tests/fixtures/model_data.bin");
pub const OBJECT_CREATE_MINIMAL: &[u8] =
    include_bytes!("../tests/fixtures/object_create_minimal.bin");
pub const OBJECT_CREATE_COMPLEX: &[u8] =
    include_bytes!("../tests/fixtures/object_create_complex.bin");
pub const CHARACTER_CONFIRMATION_REQUEST: &[u8] =
    include_bytes!("../tests/fixtures/character_confirmation_request.bin");
pub const CHARACTER_CONFIRMATION_DONE: &[u8] =
    include_bytes!("../tests/fixtures/character_confirmation_done.bin");
pub const FELLOWSHIP_FULL_UPDATE: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_full_update.bin");
pub const FELLOWSHIP_UPDATE_FELLOW_FULL: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_update_fellow_full.bin");
pub const FELLOWSHIP_UPDATE_FELLOW_VITALS: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_update_fellow_vitals.bin");
pub const FELLOWSHIP_DISBAND: &[u8] = include_bytes!("../tests/fixtures/fellowship_disband.bin");
pub const FELLOWSHIP_QUIT_EVENT: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_quit_event.bin");
pub const FELLOWSHIP_DISMISS_EVENT: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_dismiss_event.bin");
pub const FELLOWSHIP_FELLOW_UPDATE_DONE: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_fellow_update_done.bin");
pub const FELLOWSHIP_FELLOW_STATS_DONE: &[u8] =
    include_bytes!("../tests/fixtures/fellowship_fellow_stats_done.bin");
