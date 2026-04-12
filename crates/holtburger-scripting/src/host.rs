use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Once;

use anyhow::{Context, Result};
use deno_core::serde_json::{Value, from_value, json};
use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use futures::executor::block_on;
use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString,
};

use crate::{
    ScriptClientIntent, ScriptClientInteraction, ScriptClientView, ScriptCombatInfo,
    ScriptContainerView, ScriptEnchantmentView, ScriptEntityKind, ScriptEntityView,
    ScriptEquipmentSlotKind, ScriptEquipmentSlotView, ScriptEvent, ScriptIntent, ScriptLogLevel,
    ScriptPartyView, ScriptPositionRef, ScriptSelfView, ScriptSource, ScriptTradeInfo,
};

const BOOTSTRAP_SCRIPT_NAME: &str = "<holtburger-bootstrap>";
const EVENT_SCRIPT_NAME: &str = "<holtburger-event>";
const USER_SCRIPT_NAME: &str = "<holtburger-user-script>";
static V8_PLATFORM_INIT: Once = Once::new();

#[derive(Clone, Copy)]
struct ScriptClientViewPtr {
    data: *const (),
    self_entity: unsafe fn(*const ()) -> Option<ScriptSelfView>,
    entity_bool_prop: unsafe fn(*const (), Guid, PropertyBool) -> Option<bool>,
    entity_int_prop: unsafe fn(*const (), Guid, PropertyInt) -> Option<i32>,
    entity_int64_prop: unsafe fn(*const (), Guid, PropertyInt64) -> Option<i64>,
    entity_float_prop: unsafe fn(*const (), Guid, PropertyFloat) -> Option<f64>,
    entity_string_prop: unsafe fn(*const (), Guid, PropertyString) -> Option<String>,
    entity_data_prop: unsafe fn(*const (), Guid, PropertyDataId) -> Option<Guid>,
    entity_instance_prop: unsafe fn(*const (), Guid, PropertyInstanceId) -> Option<Guid>,
    debug_log: unsafe fn(*const (), String),
    #[allow(clippy::type_complexity)]
    nearby_entities:
        unsafe fn(*const (), Option<f32>, Option<Vec<ScriptEntityKind>>) -> Vec<ScriptEntityView>,
    inventory: unsafe fn(*const ()) -> Vec<ScriptContainerView>,
    current_open_container: unsafe fn(*const ()) -> Option<Guid>,
    equipment: unsafe fn(*const ()) -> Vec<ScriptEquipmentSlotView>,
    combat_info: unsafe fn(*const ()) -> ScriptCombatInfo,
    current_interaction: unsafe fn(*const ()) -> Option<ScriptClientInteraction>,
    enchantments: unsafe fn(*const ()) -> Vec<ScriptEnchantmentView>,
    spellbook: unsafe fn(*const ()) -> Vec<u32>,
    in_spellbook: unsafe fn(*const (), u32) -> bool,
    distance: unsafe fn(*const (), ScriptPositionRef, ScriptPositionRef) -> f32,
    heading_to: unsafe fn(*const (), ScriptPositionRef, ScriptPositionRef) -> f32,
    entity_exists: unsafe fn(*const (), Guid) -> bool,
    entity: unsafe fn(*const (), Guid) -> Option<ScriptEntityView>,
    #[allow(clippy::type_complexity)]
    current_trade_info: unsafe fn(*const ()) -> Option<ScriptTradeInfo>,
    #[allow(clippy::type_complexity)]
    party: unsafe fn(*const ()) -> Option<ScriptPartyView>,
}

impl ScriptClientViewPtr {
    fn from_ref<T: ScriptClientView>(view: &T) -> Self {
        unsafe fn self_entity<T: ScriptClientView>(data: *const ()) -> Option<ScriptSelfView> {
            unsafe { (&*data.cast::<T>()).self_entity() }
        }

        unsafe fn entity_bool_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyBool,
        ) -> Option<bool> {
            unsafe { (&*data.cast::<T>()).entity_bool_prop(guid, prop) }
        }

        unsafe fn entity_int_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyInt,
        ) -> Option<i32> {
            unsafe { (&*data.cast::<T>()).entity_int_prop(guid, prop) }
        }

        unsafe fn entity_int64_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyInt64,
        ) -> Option<i64> {
            unsafe { (&*data.cast::<T>()).entity_int64_prop(guid, prop) }
        }

        unsafe fn entity_float_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyFloat,
        ) -> Option<f64> {
            unsafe { (&*data.cast::<T>()).entity_float_prop(guid, prop) }
        }

        unsafe fn entity_string_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyString,
        ) -> Option<String> {
            unsafe { (&*data.cast::<T>()).entity_string_prop(guid, prop) }
        }

        unsafe fn entity_data_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyDataId,
        ) -> Option<Guid> {
            unsafe { (&*data.cast::<T>()).entity_data_prop(guid, prop) }
        }

        unsafe fn entity_instance_prop<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
            prop: PropertyInstanceId,
        ) -> Option<Guid> {
            unsafe { (&*data.cast::<T>()).entity_instance_prop(guid, prop) }
        }

        unsafe fn debug_log<T: ScriptClientView>(data: *const (), message: String) {
            unsafe { (&*data.cast::<T>()).debug_log(message) }
        }

        unsafe fn nearby_entities<T: ScriptClientView>(
            data: *const (),
            max_distance: Option<f32>,
            classifications: Option<Vec<ScriptEntityKind>>,
        ) -> Vec<ScriptEntityView> {
            unsafe { (&*data.cast::<T>()).nearby_entities(max_distance, classifications) }
        }

        unsafe fn inventory<T: ScriptClientView>(data: *const ()) -> Vec<ScriptContainerView> {
            unsafe { (&*data.cast::<T>()).inventory() }
        }

        unsafe fn current_open_container<T: ScriptClientView>(data: *const ()) -> Option<Guid> {
            unsafe { (&*data.cast::<T>()).current_open_container() }
        }

        unsafe fn equipment<T: ScriptClientView>(data: *const ()) -> Vec<ScriptEquipmentSlotView> {
            unsafe { (&*data.cast::<T>()).equipment() }
        }

        unsafe fn combat_info<T: ScriptClientView>(data: *const ()) -> ScriptCombatInfo {
            unsafe { (&*data.cast::<T>()).combat_info() }
        }

        unsafe fn current_interaction<T: ScriptClientView>(
            data: *const (),
        ) -> Option<ScriptClientInteraction> {
            unsafe { (&*data.cast::<T>()).current_interaction() }
        }

        unsafe fn enchantments<T: ScriptClientView>(data: *const ()) -> Vec<ScriptEnchantmentView> {
            unsafe { (&*data.cast::<T>()).enchantments() }
        }

        unsafe fn distance<T: ScriptClientView>(
            data: *const (),
            from: ScriptPositionRef,
            to: ScriptPositionRef,
        ) -> f32 {
            unsafe { (&*data.cast::<T>()).distance(from, to) }
        }

        unsafe fn spellbook<T: ScriptClientView>(data: *const ()) -> Vec<u32> {
            unsafe { (&*data.cast::<T>()).spellbook() }
        }

        unsafe fn in_spellbook<T: ScriptClientView>(data: *const (), spell_id: u32) -> bool {
            unsafe { (&*data.cast::<T>()).in_spellbook(spell_id) }
        }

        unsafe fn heading_to<T: ScriptClientView>(
            data: *const (),
            from: ScriptPositionRef,
            to: ScriptPositionRef,
        ) -> f32 {
            unsafe { (&*data.cast::<T>()).heading_to(from, to) }
        }

        unsafe fn entity_exists<T: ScriptClientView>(data: *const (), guid: Guid) -> bool {
            unsafe { (&*data.cast::<T>()).entity_exists(guid) }
        }

        unsafe fn entity<T: ScriptClientView>(
            data: *const (),
            guid: Guid,
        ) -> Option<ScriptEntityView> {
            unsafe { (&*data.cast::<T>()).entity(guid) }
        }

        unsafe fn current_trade_info<T: ScriptClientView>(
            data: *const (),
        ) -> Option<ScriptTradeInfo> {
            unsafe { (&*data.cast::<T>()).current_trade_info() }
        }

        unsafe fn party<T: ScriptClientView>(data: *const ()) -> Option<ScriptPartyView> {
            unsafe { (&*data.cast::<T>()).party() }
        }

        Self {
            data: (view as *const T).cast(),
            self_entity: self_entity::<T>,
            entity_bool_prop: entity_bool_prop::<T>,
            entity_int_prop: entity_int_prop::<T>,
            entity_int64_prop: entity_int64_prop::<T>,
            entity_float_prop: entity_float_prop::<T>,
            entity_string_prop: entity_string_prop::<T>,
            entity_data_prop: entity_data_prop::<T>,
            entity_instance_prop: entity_instance_prop::<T>,
            debug_log: debug_log::<T>,
            nearby_entities: nearby_entities::<T>,
            inventory: inventory::<T>,
            current_open_container: current_open_container::<T>,
            equipment: equipment::<T>,
            combat_info: combat_info::<T>,
            current_interaction: current_interaction::<T>,
            enchantments: enchantments::<T>,
            spellbook: spellbook::<T>,
            in_spellbook: in_spellbook::<T>,
            distance: distance::<T>,
            heading_to: heading_to::<T>,
            entity_exists: entity_exists::<T>,
            entity: entity::<T>,
            current_trade_info: current_trade_info::<T>,
            party: party::<T>,
        }
    }

    unsafe fn self_entity(self) -> Option<ScriptSelfView> {
        unsafe { (self.self_entity)(self.data) }
    }

    unsafe fn entity_bool_prop(self, guid: Guid, prop: PropertyBool) -> Option<bool> {
        unsafe { (self.entity_bool_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_int_prop(self, guid: Guid, prop: PropertyInt) -> Option<i32> {
        unsafe { (self.entity_int_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_int64_prop(self, guid: Guid, prop: PropertyInt64) -> Option<i64> {
        unsafe { (self.entity_int64_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_float_prop(self, guid: Guid, prop: PropertyFloat) -> Option<f64> {
        unsafe { (self.entity_float_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_string_prop(self, guid: Guid, prop: PropertyString) -> Option<String> {
        unsafe { (self.entity_string_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_data_prop(self, guid: Guid, prop: PropertyDataId) -> Option<Guid> {
        unsafe { (self.entity_data_prop)(self.data, guid, prop) }
    }

    unsafe fn entity_instance_prop(self, guid: Guid, prop: PropertyInstanceId) -> Option<Guid> {
        unsafe { (self.entity_instance_prop)(self.data, guid, prop) }
    }

    unsafe fn debug_log(self, message: String) {
        unsafe { (self.debug_log)(self.data, message) }
    }

    unsafe fn nearby_entities(
        self,
        max_distance: Option<f32>,
        classifications: Option<Vec<ScriptEntityKind>>,
    ) -> Vec<ScriptEntityView> {
        unsafe { (self.nearby_entities)(self.data, max_distance, classifications) }
    }

    unsafe fn inventory(self) -> Vec<ScriptContainerView> {
        unsafe { (self.inventory)(self.data) }
    }

    unsafe fn current_open_container(self) -> Option<Guid> {
        unsafe { (self.current_open_container)(self.data) }
    }

    unsafe fn equipment(self) -> Vec<ScriptEquipmentSlotView> {
        unsafe { (self.equipment)(self.data) }
    }

    unsafe fn combat_info(self) -> ScriptCombatInfo {
        unsafe { (self.combat_info)(self.data) }
    }

    unsafe fn current_interaction(self) -> Option<ScriptClientInteraction> {
        unsafe { (self.current_interaction)(self.data) }
    }

    unsafe fn enchantments(self) -> Vec<ScriptEnchantmentView> {
        unsafe { (self.enchantments)(self.data) }
    }

    unsafe fn distance(self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
        unsafe { (self.distance)(self.data, from, to) }
    }

    unsafe fn heading_to(self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
        unsafe { (self.heading_to)(self.data, from, to) }
    }

    unsafe fn spellbook(self) -> Vec<u32> {
        unsafe { (self.spellbook)(self.data) }
    }

    unsafe fn in_spellbook(self, spell_id: u32) -> bool {
        unsafe { (self.in_spellbook)(self.data, spell_id) }
    }

    unsafe fn entity_exists(self, guid: Guid) -> bool {
        unsafe { (self.entity_exists)(self.data, guid) }
    }

    unsafe fn entity(self, guid: Guid) -> Option<ScriptEntityView> {
        unsafe { (self.entity)(self.data, guid) }
    }

    unsafe fn current_trade_info(self) -> Option<ScriptTradeInfo> {
        unsafe { (self.current_trade_info)(self.data) }
    }

    unsafe fn party(self) -> Option<ScriptPartyView> {
        unsafe { (self.party)(self.data) }
    }
}

const BOOTSTRAP_JS: &str = r#"
const __holtburgerHandlers = [];

globalThis.Holtburger = Object.freeze({
  onEvent(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Holtburger.onEvent expects a function");
    }
    __holtburgerHandlers.push(handler);
  },
  selfEntity() {
    return Deno.core.ops.op_hb_self_entity();
  },
    attack(guid) {
        Deno.core.ops.op_hb_attack(Number(guid) >>> 0);
    },
    follow(guid) {
        Deno.core.ops.op_hb_follow(Number(guid) >>> 0);
    },
    cancelInteraction() {
        Deno.core.ops.op_hb_cancel_interaction();
    },
    currentInteraction() {
        return Deno.core.ops.op_hb_current_interaction();
    },
    enchantments() {
        return Deno.core.ops.op_hb_enchantments();
    },
    distance(from, to) {
        return Deno.core.ops.op_hb_distance(from, to);
    },
    combatInfo() {
        return Deno.core.ops.op_hb_combat_info();
    },
    nearbyEntities(maxDistance = null, classifications = null) {
        return Deno.core.ops.op_hb_nearby_entities(
            maxDistance == null || maxDistance == undefined ? null : Number(maxDistance),
            classifications == null || classifications == undefined ? null : classifications.map(String),
        );
  },
    inventory() {
        return Deno.core.ops.op_hb_inventory();
    },
    currentOpenContainer() {
        return Deno.core.ops.op_hb_current_open_container();
    },
    openContainer(guid) {
        Deno.core.ops.op_hb_open_container(Number(guid) >>> 0);
    },
    closeContainer(guid) {
        Deno.core.ops.op_hb_close_container(Number(guid) >>> 0);
    },
    currentTradeInfo() {
        return Deno.core.ops.op_hb_current_trade_info();
    },
    party() {
        return Deno.core.ops.op_hb_party();
    },
    equipment() {
        return new Map(
            Deno.core.ops.op_hb_equipment().map(({ slot, equipMask, itemGuid }) => [
                slot,
                {
                    equipMask,
                    itemGuid,
                },
            ]),
        );
    },
    spellbook() {
        return Deno.core.ops.op_hb_spellbook();
    },
    inSpellbook(spellId) {
        return Deno.core.ops.op_hb_in_spellbook(Number(spellId) >>> 0);
    },
    headingTo(from, to) {
        return Deno.core.ops.op_hb_heading_to(from, to);
    },
    entityExists(guid) {
        return Deno.core.ops.op_hb_entity_exists(Number(guid) >>> 0);
    },
    entity(guid) {
        return Deno.core.ops.op_hb_entity(Number(guid) >>> 0);
    },
    equip(guid, slot) {
        Deno.core.ops.op_hb_equip(Number(guid) >>> 0, String(slot));
    },
    unequip(guid) {
        Deno.core.ops.op_hb_unequip(Number(guid) >>> 0);
    },
    entityBoolProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_bool_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityIntProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_int_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityInt64Prop(guid, prop) {
        return Deno.core.ops.op_hb_entity_int64_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityFloatProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_float_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityStringProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_string_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityDataProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_data_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
    entityInstanceProp(guid, prop) {
        return Deno.core.ops.op_hb_entity_instance_prop(Number(guid) >>> 0, Number(prop) >>> 0);
    },
  log(level, message) {
    Deno.core.ops.op_hb_log(String(level), String(message));
  },
    debugLog(message) {
        Deno.core.ops.op_hb_debug_log(String(message));
    },
    debug_log(message) {
        Deno.core.ops.op_hb_debug_log(String(message));
    },
  say(message) {
    Deno.core.ops.op_hb_say(String(message));
  },
    emote(message) {
        Deno.core.ops.op_hb_emote(String(message));
    },
        openTrade(guid) {
            Deno.core.ops.op_hb_open_trade(Number(guid) >>> 0);
        },
        addToTrade(item) {
            Deno.core.ops.op_hb_add_to_trade(Number(item) >>> 0);
        },
        acceptTrade() {
            Deno.core.ops.op_hb_accept_trade();
        },
        declineTrade() {
            Deno.core.ops.op_hb_decline_trade();
        },
        resetTrade() {
            Deno.core.ops.op_hb_reset_trade();
        },
        exitTrade() {
            Deno.core.ops.op_hb_exit_trade();
        },
    snapHeading(heading) {
        Deno.core.ops.op_hb_snap_heading(Number(heading));
    },
    scoot(distanceMeters) {
        Deno.core.ops.op_hb_scoot(Number(distanceMeters));
    },
    combine(source, dest) {
        Deno.core.ops.op_hb_combine(Number(source) >>> 0, Number(dest) >>> 0);
    },
    useWith(source, dest) {
        Deno.core.ops.op_hb_combine(Number(source) >>> 0, Number(dest) >>> 0);
    },
    salvage(tool, items) {
        Deno.core.ops.op_hb_salvage(
            Number(tool) >>> 0,
            JSON.stringify(items.map((item) => Number(item) >>> 0)),
        );
    },
    assess(target) {
        Deno.core.ops.op_hb_assess(Number(target) >>> 0);
    },
    drop(item) {
        Deno.core.ops.op_hb_drop(Number(item) >>> 0);
    },
    pickup(item, container = null) {
        Deno.core.ops.op_hb_pickup(
            Number(item) >>> 0,
            container == null ? 0 : Number(container) >>> 0,
        );
    },
  targetEntity(guid) {
    Deno.core.ops.op_hb_target_entity(Number(guid) >>> 0);
  },
  approach(guid) {
    Deno.core.ops.op_hb_approach(Number(guid) >>> 0);
  },
});

globalThis.__holtburgerDispatch = (event) => {
  for (const handler of __holtburgerHandlers) {
    handler(event);
  }
};
"#;

deno_core::extension!(
    holtburger_script_ext,
    ops = [
        op_hb_self_entity,
        op_hb_nearby_entities,
        op_hb_entity_bool_prop,
        op_hb_entity_int_prop,
        op_hb_entity_int64_prop,
        op_hb_entity_float_prop,
        op_hb_entity_string_prop,
        op_hb_entity_data_prop,
        op_hb_entity_instance_prop,
        op_hb_log,
        op_hb_debug_log,
        op_hb_say,
        op_hb_emote,
        op_hb_combat_info,
        op_hb_current_interaction,
        op_hb_enchantments,
        op_hb_distance,
        op_hb_current_trade_info,
        op_hb_current_open_container,
        op_hb_open_container,
        op_hb_close_container,
        op_hb_equipment,
        op_hb_inventory,
        op_hb_spellbook,
        op_hb_in_spellbook,
        op_hb_heading_to,
        op_hb_entity_exists,
        op_hb_entity,
        op_hb_equip,
        op_hb_unequip,
        op_hb_open_trade,
        op_hb_add_to_trade,
        op_hb_accept_trade,
        op_hb_decline_trade,
        op_hb_reset_trade,
        op_hb_party,
        op_hb_exit_trade,
        op_hb_snap_heading,
        op_hb_scoot,
        op_hb_combine,
        op_hb_salvage,
        op_hb_assess,
        op_hb_drop,
        op_hb_pickup,
        op_hb_attack,
        op_hb_follow,
        op_hb_cancel_interaction,
        op_hb_target_entity,
        op_hb_approach,
    ]
);

struct HostRuntimeState {
    outputs: Rc<RefCell<Vec<ScriptIntent>>>,
    current_context: Cell<Option<ScriptClientViewPtr>>,
}

impl HostRuntimeState {
    fn new(outputs: Rc<RefCell<Vec<ScriptIntent>>>) -> Self {
        Self {
            outputs,
            current_context: Cell::new(None),
        }
    }
}

struct ActiveScriptContextGuard {
    op_state: Rc<RefCell<OpState>>,
    previous: Option<ScriptClientViewPtr>,
}

impl Drop for ActiveScriptContextGuard {
    fn drop(&mut self) {
        let mut op_state = self.op_state.borrow_mut();
        op_state
            .borrow_mut::<HostRuntimeState>()
            .current_context
            .set(self.previous);
    }
}

fn install_script_context<T: ScriptClientView>(
    op_state: Rc<RefCell<OpState>>,
    context: &T,
) -> ActiveScriptContextGuard {
    let previous = {
        let mut op_state_ref = op_state.borrow_mut();
        op_state_ref
            .borrow_mut::<HostRuntimeState>()
            .current_context
            .replace(Some(ScriptClientViewPtr::from_ref(context)))
    };

    ActiveScriptContextGuard { op_state, previous }
}

fn with_current_script_client_view<T>(
    state: &mut OpState,
    f: impl FnOnce(ScriptClientViewPtr) -> T,
) -> Option<T> {
    let context_ptr = state.borrow::<HostRuntimeState>().current_context.get()?;
    Some(f(context_ptr))
}

#[op2]
#[serde]
fn op_hb_self_entity(state: &mut OpState) -> Option<ScriptSelfView> {
    with_current_script_client_view(state, |view| unsafe { view.self_entity() }).flatten()
}

#[op2]
#[serde]
fn op_hb_nearby_entities(
    state: &mut OpState,
    max_distance: Option<f64>,
    #[serde] classifications: Option<Vec<String>>,
) -> Vec<ScriptEntityView> {
    let classifications = classifications.map(|classifications| {
        classifications
            .into_iter()
            .filter_map(parse_script_entity_kind)
            .collect()
    });

    with_current_script_client_view(state, |view| unsafe {
        view.nearby_entities(
            max_distance.map(|distance| distance as f32),
            classifications,
        )
    })
    .unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_equipment(state: &mut OpState) -> Vec<ScriptEquipmentSlotView> {
    with_current_script_client_view(state, |view| unsafe { view.equipment() }).unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_inventory(state: &mut OpState) -> Vec<ScriptContainerView> {
    with_current_script_client_view(state, |view| unsafe { view.inventory() }).unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_current_open_container(state: &mut OpState) -> Option<Guid> {
    with_current_script_client_view(state, |view| unsafe { view.current_open_container() })
        .flatten()
}

#[op2]
#[serde]
fn op_hb_spellbook(state: &mut OpState) -> Vec<u32> {
    with_current_script_client_view(state, |view| unsafe { view.spellbook() }).unwrap_or_default()
}

#[op2(fast)]
fn op_hb_in_spellbook(state: &mut OpState, spell_id: u32) -> bool {
    with_current_script_client_view(state, |view| unsafe { view.in_spellbook(spell_id) })
        .unwrap_or_default()
}

#[op2]
fn op_hb_distance(
    state: &mut OpState,
    #[serde] from: ScriptPositionRef,
    #[serde] to: ScriptPositionRef,
) -> f32 {
    with_current_script_client_view(state, |view| unsafe { view.distance(from, to) })
        .unwrap_or_default()
}

#[op2]
fn op_hb_heading_to(
    state: &mut OpState,
    #[serde] from: ScriptPositionRef,
    #[serde] to: ScriptPositionRef,
) -> f32 {
    with_current_script_client_view(state, |view| unsafe { view.heading_to(from, to) })
        .unwrap_or_default()
}

#[op2(fast)]
fn op_hb_entity_exists(state: &mut OpState, guid: u32) -> bool {
    with_current_script_client_view(state, |view| unsafe { view.entity_exists(Guid(guid)) })
        .unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_entity(state: &mut OpState, guid: u32) -> Option<ScriptEntityView> {
    with_current_script_client_view(state, |view| unsafe { view.entity(Guid(guid)) }).flatten()
}

#[op2]
#[serde]
fn op_hb_current_trade_info(state: &mut OpState) -> Option<ScriptTradeInfo> {
    with_current_script_client_view(state, |view| unsafe { view.current_trade_info() }).flatten()
}

#[op2]
#[serde]
fn op_hb_party(state: &mut OpState) -> Option<crate::ScriptPartyView> {
    with_current_script_client_view(state, |view| unsafe { view.party() }).flatten()
}

#[op2]
#[serde]
fn op_hb_combat_info(state: &mut OpState) -> ScriptCombatInfo {
    with_current_script_client_view(state, |view| unsafe { view.combat_info() }).unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_current_interaction(state: &mut OpState) -> Option<ScriptClientInteraction> {
    with_current_script_client_view(state, |view| unsafe { view.current_interaction() }).flatten()
}

#[op2]
#[serde]
fn op_hb_enchantments(state: &mut OpState) -> Vec<ScriptEnchantmentView> {
    with_current_script_client_view(state, |view| unsafe { view.enchantments() })
        .unwrap_or_default()
}

#[op2(fast)]
fn op_hb_open_container(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::OpenContainer { guid: Guid(guid) });
}

#[op2(fast)]
fn op_hb_close_container(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::CloseContainer { guid: Guid(guid) });
}

#[op2(fast)]
fn op_hb_equip(state: &mut OpState, guid: u32, #[string] slot: String) {
    let slot = match parse_script_equipment_slot_kind(&slot) {
        Some(slot) => slot,
        None => {
            state
                .borrow::<HostRuntimeState>()
                .outputs
                .borrow_mut()
                .push(ScriptIntent::Log {
                    level: ScriptLogLevel::Error,
                    message: format!("invalid equipment slot for equip intent: {slot}"),
                });
            return;
        }
    };

    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Equip {
            guid: Guid(guid),
            slot,
        });
}

#[op2(fast)]
fn op_hb_unequip(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Unequip { guid: Guid(guid) });
}

#[op2]
#[serde]
fn op_hb_entity_bool_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyBool::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_bool_prop(Guid(guid), prop)
    })
    .flatten()
    .map(Value::Bool)
}

#[op2]
#[serde]
fn op_hb_entity_int_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyInt::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_int_prop(Guid(guid), prop)
    })
    .flatten()
    .map(|value| json!(value))
}

#[op2]
#[serde]
fn op_hb_entity_int64_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyInt64::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_int64_prop(Guid(guid), prop)
    })
    .flatten()
    .map(|value| json!(value))
}

#[op2]
#[serde]
fn op_hb_entity_float_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyFloat::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_float_prop(Guid(guid), prop)
    })
    .flatten()
    .and_then(deno_core::serde_json::Number::from_f64)
    .map(Value::Number)
}

#[op2]
#[serde]
fn op_hb_entity_string_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyString::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_string_prop(Guid(guid), prop)
    })
    .flatten()
    .map(Value::String)
}

#[op2]
#[serde]
fn op_hb_entity_data_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyDataId::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_data_prop(Guid(guid), prop)
    })
    .flatten()
    .map(|value| json!(value.0))
}

#[op2]
#[serde]
fn op_hb_entity_instance_prop(state: &mut OpState, guid: u32, prop: u32) -> Option<Value> {
    let prop = PropertyInstanceId::from_repr(prop)?;
    with_current_script_client_view(state, |view| unsafe {
        view.entity_instance_prop(Guid(guid), prop)
    })
    .flatten()
    .map(|value| json!(value.0))
}

#[op2(fast)]
fn op_hb_log(state: &mut OpState, #[string] level: String, #[string] message: String) {
    let level = parse_script_log_level(&level);
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Log { level, message });
}

#[op2(fast)]
fn op_hb_debug_log(state: &mut OpState, #[string] message: String) {
    with_current_script_client_view(state, |view| unsafe { view.debug_log(message) });
}

#[op2(fast)]
fn op_hb_say(state: &mut OpState, #[string] message: String) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Say { message });
}

#[op2(fast)]
fn op_hb_emote(state: &mut OpState, #[string] message: String) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Emote { message });
}

#[op2(fast)]
fn op_hb_open_trade(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::OpenTrade { guid: Guid(guid) });
}

#[op2(fast)]
fn op_hb_add_to_trade(state: &mut OpState, item: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::AddToTrade { item: Guid(item) });
}

#[op2(fast)]
fn op_hb_accept_trade(state: &mut OpState) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::AcceptTrade);
}

#[op2(fast)]
fn op_hb_decline_trade(state: &mut OpState) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::DeclineTrade);
}

#[op2(fast)]
fn op_hb_reset_trade(state: &mut OpState) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::ResetTrade);
}

#[op2(fast)]
fn op_hb_exit_trade(state: &mut OpState) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::ExitTrade);
}

#[op2(fast)]
fn op_hb_snap_heading(state: &mut OpState, heading: f64) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::SnapHeading {
            heading: heading as f32,
        });
}

#[op2(fast)]
fn op_hb_scoot(state: &mut OpState, distance_m: f64) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Scoot {
            distance_m: distance_m as f32,
        });
}

#[op2(fast)]
fn op_hb_combine(state: &mut OpState, source: u32, dest: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Combine {
            source: Guid(source),
            dest: Guid(dest),
        });
}

#[op2(fast)]
fn op_hb_salvage(state: &mut OpState, tool: u32, #[string] item_guids_json: String) {
    let item_guids = match deno_core::serde_json::from_str::<Vec<u32>>(&item_guids_json) {
        Ok(item_guids) => item_guids.into_iter().map(Guid).collect(),
        Err(error) => {
            state
                .borrow::<HostRuntimeState>()
                .outputs
                .borrow_mut()
                .push(ScriptIntent::Log {
                    level: ScriptLogLevel::Error,
                    message: format!("failed to parse salvage item list: {error}"),
                });
            return;
        }
    };

    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Salvage {
            tool: Guid(tool),
            items: item_guids,
        });
}

#[op2(fast)]
fn op_hb_assess(state: &mut OpState, target: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Assess {
            target: Guid(target),
        });
}

#[op2(fast)]
fn op_hb_drop(state: &mut OpState, item: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Drop { item: Guid(item) });
}

#[op2(fast)]
fn op_hb_pickup(state: &mut OpState, item: u32, container: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Pickup {
            item: Guid(item),
            container: (container != 0).then_some(Guid(container)),
        });
}

#[op2(fast)]
fn op_hb_attack(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Client(ScriptClientIntent::Attack {
            guid: Guid(guid),
        }));
}

#[op2(fast)]
fn op_hb_follow(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Client(ScriptClientIntent::Follow {
            guid: Guid(guid),
        }));
}

#[op2(fast)]
fn op_hb_cancel_interaction(state: &mut OpState) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Client(ScriptClientIntent::CancelInteraction));
}

#[op2(fast)]
fn op_hb_target_entity(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Client(ScriptClientIntent::TargetEntity {
            guid: Guid(guid),
        }));
}

#[op2(fast)]
fn op_hb_approach(state: &mut OpState, guid: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Client(ScriptClientIntent::Approach {
            guid: Guid(guid),
        }));
}

fn parse_script_log_level(level: &str) -> ScriptLogLevel {
    match level.trim().to_ascii_lowercase().as_str() {
        "trace" => ScriptLogLevel::Trace,
        "debug" => ScriptLogLevel::Debug,
        "warn" | "warning" => ScriptLogLevel::Warn,
        "error" => ScriptLogLevel::Error,
        _ => ScriptLogLevel::Info,
    }
}

fn parse_script_equipment_slot_kind(slot: &str) -> Option<ScriptEquipmentSlotKind> {
    match slot.trim().to_ascii_lowercase().as_str() {
        "head_wear" => Some(ScriptEquipmentSlotKind::HeadWear),
        "chest_wear" => Some(ScriptEquipmentSlotKind::ChestWear),
        "abdomen_wear" => Some(ScriptEquipmentSlotKind::AbdomenWear),
        "upper_arm_wear" => Some(ScriptEquipmentSlotKind::UpperArmWear),
        "lower_arm_wear" => Some(ScriptEquipmentSlotKind::LowerArmWear),
        "hand_wear" => Some(ScriptEquipmentSlotKind::HandWear),
        "upper_leg_wear" => Some(ScriptEquipmentSlotKind::UpperLegWear),
        "lower_leg_wear" => Some(ScriptEquipmentSlotKind::LowerLegWear),
        "foot_wear" => Some(ScriptEquipmentSlotKind::FootWear),
        "chest_armor" => Some(ScriptEquipmentSlotKind::ChestArmor),
        "abdomen_armor" => Some(ScriptEquipmentSlotKind::AbdomenArmor),
        "upper_arm_armor" => Some(ScriptEquipmentSlotKind::UpperArmArmor),
        "lower_arm_armor" => Some(ScriptEquipmentSlotKind::LowerArmArmor),
        "upper_leg_armor" => Some(ScriptEquipmentSlotKind::UpperLegArmor),
        "lower_leg_armor" => Some(ScriptEquipmentSlotKind::LowerLegArmor),
        "neck_wear" => Some(ScriptEquipmentSlotKind::NeckWear),
        "left_wrist" => Some(ScriptEquipmentSlotKind::LeftWrist),
        "right_wrist" => Some(ScriptEquipmentSlotKind::RightWrist),
        "left_finger" => Some(ScriptEquipmentSlotKind::LeftFinger),
        "right_finger" => Some(ScriptEquipmentSlotKind::RightFinger),
        "melee_weapon" => Some(ScriptEquipmentSlotKind::MeleeWeapon),
        "shield" => Some(ScriptEquipmentSlotKind::Shield),
        "missile_weapon" => Some(ScriptEquipmentSlotKind::MissileWeapon),
        "missile_ammo" => Some(ScriptEquipmentSlotKind::MissileAmmo),
        "caster" => Some(ScriptEquipmentSlotKind::Caster),
        "two_handed" => Some(ScriptEquipmentSlotKind::TwoHanded),
        "trinket_one" => Some(ScriptEquipmentSlotKind::TrinketOne),
        "cloak" => Some(ScriptEquipmentSlotKind::Cloak),
        "sigil_one" => Some(ScriptEquipmentSlotKind::SigilOne),
        "sigil_two" => Some(ScriptEquipmentSlotKind::SigilTwo),
        "sigil_three" => Some(ScriptEquipmentSlotKind::SigilThree),
        _ => None,
    }
}

fn parse_script_entity_kind(kind: String) -> Option<ScriptEntityKind> {
    from_value(Value::String(kind)).ok()
}

fn ensure_v8_platform_initialized() {
    V8_PLATFORM_INIT.call_once(|| {
        JsRuntime::init_platform(None, false);
    });
}

fn create_js_runtime(outputs: Rc<RefCell<Vec<ScriptIntent>>>) -> JsRuntime {
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![holtburger_script_ext::init_ops_and_esm()],
        ..Default::default()
    });

    js_runtime
        .op_state()
        .borrow_mut()
        .put(HostRuntimeState::new(outputs));

    js_runtime
}

fn run_js_script(
    js_runtime: &mut JsRuntime,
    engine_name: &'static str,
    display_name: &str,
    source: String,
) -> Result<()> {
    js_runtime
        .execute_script(engine_name, source)
        .with_context(|| format!("failed to execute script {display_name}"))?;
    block_on(js_runtime.run_event_loop(Default::default()))
        .with_context(|| format!("failed to drive script event loop for {display_name}"))?;
    Ok(())
}

fn build_dispatch_source(event: &ScriptEvent) -> Result<String> {
    let event_json =
        deno_core::serde_json::to_string(event).context("failed to serialize script event")?;
    let event_json_literal = deno_core::serde_json::to_string(&event_json)
        .context("failed to serialize script event JSON literal")?;
    let event_json_literal = escape_js_string_separators(&event_json_literal);

    Ok(format!(
        "globalThis.__holtburgerDispatch(JSON.parse({event_json_literal}));"
    ))
}

fn escape_js_string_separators(value: &str) -> String {
    value
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

pub struct ScriptHost {
    js_runtime: JsRuntime,
    outputs: Rc<RefCell<Vec<ScriptIntent>>>,
}

impl ScriptHost {
    pub fn spawn<T: ScriptClientView>(source: ScriptSource, context: &T) -> Result<Self> {
        ensure_v8_platform_initialized();

        let outputs = Rc::new(RefCell::new(Vec::new()));
        let mut js_runtime = create_js_runtime(outputs.clone());
        let ScriptSource { name, source } = source;

        with_active_script_context(&mut js_runtime, context, |js_runtime| {
            run_js_script(
                js_runtime,
                BOOTSTRAP_SCRIPT_NAME,
                BOOTSTRAP_SCRIPT_NAME,
                BOOTSTRAP_JS.to_string(),
            )?;
            run_js_script(js_runtime, USER_SCRIPT_NAME, &name, source)
        })?;

        Ok(Self {
            js_runtime,
            outputs,
        })
    }

    pub fn dispatch_event(
        &mut self,
        context: &impl ScriptClientView,
        event: ScriptEvent,
    ) -> Result<()> {
        let dispatch_source = build_dispatch_source(&event)?;

        with_active_script_context(&mut self.js_runtime, context, |js_runtime| {
            run_js_script(
                js_runtime,
                EVENT_SCRIPT_NAME,
                EVENT_SCRIPT_NAME,
                dispatch_source,
            )
        })
    }

    pub fn drain_outputs(&mut self) -> Vec<ScriptIntent> {
        std::mem::take(&mut *self.outputs.borrow_mut())
    }

    pub fn shutdown(self) {}
}

fn with_active_script_context<T, V>(
    js_runtime: &mut JsRuntime,
    context: &V,
    f: impl FnOnce(&mut JsRuntime) -> Result<T>,
) -> Result<T>
where
    V: ScriptClientView,
{
    let op_state = js_runtime.op_state();
    let _guard = install_script_context(op_state, context);
    f(js_runtime)
}

#[cfg(test)]
mod tests {
    use super::build_dispatch_source;
    use crate::{
        ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent, ScriptClientIntent,
        ScriptClientInteraction, ScriptCombatInfo, ScriptContainerView, ScriptEnchantmentView,
        ScriptEntityKind, ScriptEntityView, ScriptEquipmentSlotKind, ScriptEquipmentSlotView,
        ScriptEvent, ScriptIntent, ScriptPartyMemberView, ScriptPartyView, ScriptPositionRef,
        ScriptSelfView, ScriptSource, ScriptTradeInfo,
    };
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        EquipMask, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt,
        PropertyInt64, PropertyString,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};

    #[derive(Default)]
    struct TestView;

    fn resolve_position(reference: ScriptPositionRef) -> Option<WorldPosition> {
        match reference {
            ScriptPositionRef::Position(position) => Some(position),
            ScriptPositionRef::Guid(guid) => match guid {
                Guid(7) => Some(WorldPosition {
                    landblock_id: Guid(0x0100_0000),
                    coords: Vector3::new(0.0, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                }),
                Guid(42) => Some(WorldPosition {
                    landblock_id: Guid(0x0100_0000),
                    coords: Vector3::new(0.0, 10.0, 0.0),
                    rotation: Quaternion::identity(),
                }),
                _ => None,
            },
        }
    }

    impl crate::ScriptClientView for TestView {
        fn self_entity(&self) -> Option<ScriptSelfView> {
            None
        }

        fn combat_info(&self) -> ScriptCombatInfo {
            ScriptCombatInfo {
                combat_mode: CombatMode::Melee,
                is_engaged: true,
                target: Some(Guid(7)),
                power: 0.75,
                height: AttackHeight::High,
                last_attack_time: Some(123.5),
            }
        }

        fn current_interaction(&self) -> Option<ScriptClientInteraction> {
            Some(ScriptClientInteraction::Attack { guid: Guid(7) })
        }

        fn enchantments(&self) -> Vec<ScriptEnchantmentView> {
            vec![
                ScriptEnchantmentView {
                    spell_id: 7,
                    end_time: 123.5,
                },
                ScriptEnchantmentView {
                    spell_id: 11,
                    end_time: 222.25,
                },
            ]
        }

        fn target_entity(&self) -> Option<ScriptEntityView> {
            None
        }

        fn entity_bool_prop(&self, _guid: Guid, _prop: PropertyBool) -> Option<bool> {
            None
        }

        fn entity_int_prop(&self, _guid: Guid, _prop: PropertyInt) -> Option<i32> {
            None
        }

        fn entity_int64_prop(&self, _guid: Guid, _prop: PropertyInt64) -> Option<i64> {
            None
        }

        fn entity_float_prop(&self, _guid: Guid, _prop: PropertyFloat) -> Option<f64> {
            None
        }

        fn entity_string_prop(&self, _guid: Guid, _prop: PropertyString) -> Option<String> {
            None
        }

        fn entity_data_prop(&self, _guid: Guid, _prop: PropertyDataId) -> Option<Guid> {
            None
        }

        fn entity_instance_prop(&self, _guid: Guid, _prop: PropertyInstanceId) -> Option<Guid> {
            None
        }

        fn nearby_entities(
            &self,
            _max_distance: Option<f32>,
            _classifications: Option<Vec<ScriptEntityKind>>,
        ) -> Vec<ScriptEntityView> {
            Vec::new()
        }

        fn inventory(&self) -> Vec<ScriptContainerView> {
            vec![ScriptContainerView {
                container_guid: Guid(17),
                slots: 4,
                items: vec![Guid(11), Guid(12)],
            }]
        }

        fn current_open_container(&self) -> Option<Guid> {
            Some(Guid(17))
        }

        fn equipment(&self) -> Vec<ScriptEquipmentSlotView> {
            vec![ScriptEquipmentSlotView {
                slot: ScriptEquipmentSlotKind::HeadWear,
                equip_mask: EquipMask::HEAD_WEAR,
                item_guid: Some(Guid(42)),
            }]
        }

        fn spellbook(&self) -> Vec<u32> {
            vec![7, 11, 13]
        }

        fn in_spellbook(&self, spell_id: u32) -> bool {
            [7, 11, 13].contains(&spell_id)
        }

        fn distance(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
            let Some(from) = resolve_position(from) else {
                return 0.0;
            };

            let Some(to) = resolve_position(to) else {
                return 0.0;
            };

            from.distance_to(&to)
        }

        fn heading_to(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
            let Some(from) = resolve_position(from) else {
                return 0.0;
            };

            let Some(to) = resolve_position(to) else {
                return 0.0;
            };

            from.heading_to(&to)
        }

        fn entity_exists(&self, guid: Guid) -> bool {
            guid == Guid(42)
        }

        fn entity(&self, guid: Guid) -> Option<ScriptEntityView> {
            (guid == Guid(11)).then_some(ScriptEntityView {
                guid,
                name: Some("Lesser Healing Kit".to_string()),
                kind: ScriptEntityKind::HealingKit,
                position: WorldPosition::default(),
                profile: None,
                container: Guid::NULL,
                wielder: Guid::NULL,
                distance_to_self: 0.0,
                motion_command: Default::default(),
            })
        }

        fn current_trade_info(&self) -> Option<ScriptTradeInfo> {
            Some(ScriptTradeInfo {
                partner_guid: Guid(7),
                partner_name: Some("Buddy".to_string()),
                our_items: vec![Guid(11)],
                their_items: vec![Guid(21), Guid(22)],
            })
        }

        fn party(&self) -> Option<crate::ScriptPartyView> {
            Some(ScriptPartyView {
                leader_guid: Guid(7),
                members: vec![
                    ScriptPartyMemberView {
                        guid: Guid(7),
                        name: Some("Buddy".to_string()),
                        health_percent: Some(0.5),
                        stamina_percent: Some(0.75),
                        mana_percent: Some(0.25),
                    },
                    ScriptPartyMemberView {
                        guid: Guid(42),
                        name: Some("Tank".to_string()),
                        health_percent: Some(0.9),
                        stamina_percent: Some(0.8),
                        mana_percent: Some(0.1),
                    },
                ],
            })
        }

        fn active_spells(&self) -> Vec<crate::ScriptSpellEffectView> {
            Vec::new()
        }

        fn server_time(&self) -> Option<f64> {
            None
        }

        fn pending_confirmation(&self) -> Option<crate::ScriptConfirmation> {
            None
        }

        fn busy_operation(&self) -> ScriptBusyOperation {
            ScriptBusyOperation::None
        }
    }

    #[test]
    // Keep all V8-backed host checks inside this single test.
    // Adding separate #[test] functions here can run them in parallel and trigger V8 platform teardown races.
    fn v8_script_tests_run_in_single_thread_to_avoid_v8_platform_teardown() {
        dispatch_source_escapes_javascript_line_separators();
        equipment_helper_returns_js_map();
        spellbook_helper_returns_js_array();
        inventory_helper_returns_js_array_of_container_views();
        current_open_container_helper_returns_js_option();
        current_interaction_helper_returns_js_object();
        enchantments_helper_returns_js_array();
        entity_helper_returns_js_object();
        debug_log_helper_emits_no_script_outputs();
        party_helper_returns_js_object();
        distance_and_heading_helpers_accept_guids_and_positions();
        combat_info_helper_returns_js_object();
        spellbook_membership_helper_returns_boolean();
        heading_to_helper_returns_expected_heading();
        entity_exists_helper_returns_boolean();
        open_and_close_container_intents_are_emitted();
        attack_follow_and_cancel_helpers_emit_client_intents();
        current_trade_info_helper_returns_js_object();
    }

    fn dispatch_source_escapes_javascript_line_separators() {
        let event = ScriptEvent::ChatMessage(ScriptChatEvent {
            channel: ScriptChatChannelKind::Say,
            sender: Some("Buddy".to_string()),
            message: "line\u{2028}para\u{2029}".to_string(),
        });

        let source = build_dispatch_source(&event).expect("dispatch source should serialize");

        assert!(!source.contains('\u{2028}'));
        assert!(!source.contains('\u{2029}'));
        assert!(source.contains("\\u2028"));
        assert!(source.contains("\\u2029"));
        assert!(source.contains("JSON.parse("));
    }

    fn equipment_helper_returns_js_map() {
        let source = ScriptSource::new(
            "equipment-map-test",
            r#"
                const equipment = Holtburger.equipment();
                Holtburger.log(
                    "info",
                    JSON.stringify([
                        equipment instanceof Map,
                        equipment.has("head_wear"),
                        equipment.get("head_wear").itemGuid,
                    ]),
                );
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[true,true,42]"
        ));
    }

    fn spellbook_helper_returns_js_array() {
        let source = ScriptSource::new(
            "spellbook-array-test",
            r#"
                const spellbook = Holtburger.spellbook();
                Holtburger.log("info", JSON.stringify(spellbook));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[7,11,13]"
        ));
    }

    fn inventory_helper_returns_js_array_of_container_views() {
        let source = ScriptSource::new(
            "inventory-array-test",
            r#"
                const inventory = Holtburger.inventory();
                Holtburger.log(
                    "info",
                    JSON.stringify([
                        Array.isArray(inventory),
                        inventory.length,
                        inventory[0].containerGuid,
                        inventory[0].slots,
                        inventory[0].items,
                    ]),
                );
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[true,1,17,4,[11,12]]"
        ));
    }

    fn current_open_container_helper_returns_js_option() {
        let source = ScriptSource::new(
            "current-open-container-test",
            r#"
                Holtburger.log("info", String(Holtburger.currentOpenContainer()));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "17"
        ));
    }

    fn current_interaction_helper_returns_js_object() {
        let source = ScriptSource::new(
            "current-interaction-test",
            r#"
                const interaction = Holtburger.currentInteraction();
                Holtburger.log("info", JSON.stringify(interaction));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "{\"kind\":\"Attack\",\"data\":{\"guid\":7}}"
        ));
    }

    fn enchantments_helper_returns_js_array() {
        let source = ScriptSource::new(
            "enchantments-test",
            r#"
                const enchantments = Holtburger.enchantments();
                Holtburger.log("info", JSON.stringify(enchantments));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[{\"spellId\":7,\"endTime\":123.5},{\"spellId\":11,\"endTime\":222.25}]"
        ));
    }

    fn entity_helper_returns_js_object() {
        let source = ScriptSource::new(
            "entity-test",
            r#"
                const entity = Holtburger.entity(11);
                Holtburger.log("info", JSON.stringify([entity.guid, entity.name, entity.kind]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[11,\"Lesser Healing Kit\",\"healing_kit\"]"
        ));
    }

    fn debug_log_helper_emits_no_script_outputs() {
        let source = ScriptSource::new(
            "debug-log-test",
            r#"
                Holtburger.debugLog("script diagnostics");
                Holtburger.log("info", "after debug log");
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "after debug log"
        ));
    }

    fn party_helper_returns_js_object() {
        let source = ScriptSource::new(
            "party-test",
            r#"
                const party = Holtburger.party();
                Holtburger.log("info", JSON.stringify(party));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message.contains("\"leaderGuid\":7")
                    && message.contains("\"members\"")
                    && message.contains("\"guid\":7")
                    && message.contains("\"name\":\"Buddy\"")
                    && message.contains("\"healthPercent\":0.5")
                    && message.contains("\"guid\":42")
                    && message.contains("\"name\":\"Tank\"")
                    && message.contains("\"manaPercent\":0.1")
        ));
    }

    fn distance_and_heading_helpers_accept_guids_and_positions() {
        let source = ScriptSource::new(
            "distance-heading-test",
            r#"
                const distance = Holtburger.distance(7, 42);
                const heading = Holtburger.headingTo(7, 42);
                Holtburger.log("info", JSON.stringify([distance, heading]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if deno_core::serde_json::from_str::<Vec<f64>>(message).is_ok_and(|values| {
                    values.len() == 2
                        && (values[0] - 10.0).abs() < 1e-6
                        && (values[1] - 90.0_f64.to_radians()).abs() < 1e-6
                })
        ));
    }

    fn combat_info_helper_returns_js_object() {
        let source = ScriptSource::new(
            "combat-info-test",
            r#"
                const combatInfo = Holtburger.combatInfo();
                Holtburger.log(
                    "info",
                    JSON.stringify([
                        combatInfo.combatMode,
                        combatInfo.isEngaged,
                        combatInfo.target,
                        combatInfo.power,
                        combatInfo.height,
                        combatInfo.lastAttackTime,
                    ]),
                );
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[\"Melee\",true,7,0.75,\"High\",123.5]"
        ));
    }

    fn open_and_close_container_intents_are_emitted() {
        let source = ScriptSource::new(
            "container-intents-test",
            r#"
                Holtburger.openContainer(17);
                Holtburger.closeContainer(19);
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [
                ScriptIntent::OpenContainer { guid },
                ScriptIntent::CloseContainer { guid: close_guid },
            ] if *guid == Guid(17) && *close_guid == Guid(19)
        ));
    }

    fn attack_follow_and_cancel_helpers_emit_client_intents() {
        let source = ScriptSource::new(
            "client-intents-test",
            r#"
                Holtburger.attack(7);
                Holtburger.follow(11);
                Holtburger.cancelInteraction();
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [
                ScriptIntent::Client(ScriptClientIntent::Attack { guid }),
                ScriptIntent::Client(ScriptClientIntent::Follow { guid: follow_guid }),
                ScriptIntent::Client(ScriptClientIntent::CancelInteraction),
            ] if *guid == Guid(7) && *follow_guid == Guid(11)
        ));
    }

    fn spellbook_membership_helper_returns_boolean() {
        let source = ScriptSource::new(
            "spellbook-membership-test",
            r#"
                Holtburger.log("info", JSON.stringify([
                    Holtburger.inSpellbook(7),
                    Holtburger.inSpellbook(99),
                ]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[true,false]"
        ));
    }

    fn heading_to_helper_returns_expected_heading() {
        let source = ScriptSource::new(
            "heading-to-test",
            r#"
                const heading = Holtburger.headingTo(
                    { landblock_id: 16777216, coords: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
                    { landblock_id: 16777216, coords: { x: 0, y: 10, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
                );
                Holtburger.log("info", String(heading));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message
                    .parse::<f64>()
                    .is_ok_and(|heading| (heading - 90.0_f64.to_radians()).abs() < 1e-6)
        ));
    }

    fn entity_exists_helper_returns_boolean() {
        let source = ScriptSource::new(
            "entity-exists-test",
            r#"
                Holtburger.log("info", JSON.stringify([
                    Holtburger.entityExists(42),
                    Holtburger.entityExists(7),
                ]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[true,false]"
        ));
    }

    fn current_trade_info_helper_returns_js_object() {
        let source = ScriptSource::new(
            "current-trade-info-test",
            r#"
                const trade = Holtburger.currentTradeInfo();
                Holtburger.log(
                    "info",
                    JSON.stringify([
                        trade.partnerGuid,
                        trade.partnerName,
                        trade.ourItems,
                        trade.theirItems,
                    ]),
                );
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Log { message, .. }]
                if message == "[7,\"Buddy\",[11],[21,22]]"
        ));
    }
}
