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
    ScriptClientIntent, ScriptClientView, ScriptEntityKind, ScriptEntityView,
    ScriptEquipmentSlotKind, ScriptEquipmentSlotView, ScriptEvent, ScriptIntent, ScriptLogLevel,
    ScriptSelfView, ScriptSource, ScriptTradeInfo,
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
    #[allow(clippy::type_complexity)]
    nearby_entities:
        unsafe fn(*const (), Option<f32>, Option<Vec<ScriptEntityKind>>) -> Vec<ScriptEntityView>,
    equipment: unsafe fn(*const ()) -> Vec<ScriptEquipmentSlotView>,
    spellbook: unsafe fn(*const ()) -> Vec<u32>,
    #[allow(clippy::type_complexity)]
    current_trade_info: unsafe fn(*const ()) -> Option<ScriptTradeInfo>,
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

        unsafe fn nearby_entities<T: ScriptClientView>(
            data: *const (),
            max_distance: Option<f32>,
            classifications: Option<Vec<ScriptEntityKind>>,
        ) -> Vec<ScriptEntityView> {
            unsafe { (&*data.cast::<T>()).nearby_entities(max_distance, classifications) }
        }

        unsafe fn equipment<T: ScriptClientView>(
            data: *const (),
        ) -> Vec<ScriptEquipmentSlotView> {
            unsafe { (&*data.cast::<T>()).equipment() }
        }

        unsafe fn spellbook<T: ScriptClientView>(data: *const ()) -> Vec<u32> {
            unsafe { (&*data.cast::<T>()).spellbook() }
        }

        unsafe fn current_trade_info<T: ScriptClientView>(
            data: *const (),
        ) -> Option<ScriptTradeInfo> {
            unsafe { (&*data.cast::<T>()).current_trade_info() }
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
            nearby_entities: nearby_entities::<T>,
            equipment: equipment::<T>,
            spellbook: spellbook::<T>,
            current_trade_info: current_trade_info::<T>,
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

    unsafe fn nearby_entities(
        self,
        max_distance: Option<f32>,
        classifications: Option<Vec<ScriptEntityKind>>,
    ) -> Vec<ScriptEntityView> {
        unsafe { (self.nearby_entities)(self.data, max_distance, classifications) }
    }

    unsafe fn equipment(self) -> Vec<ScriptEquipmentSlotView> {
        unsafe { (self.equipment)(self.data) }
    }

    unsafe fn spellbook(self) -> Vec<u32> {
        unsafe { (self.spellbook)(self.data) }
    }

    unsafe fn current_trade_info(self) -> Option<ScriptTradeInfo> {
        unsafe { (self.current_trade_info)(self.data) }
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
    nearbyEntities(maxDistance = null, classifications = null) {
        return Deno.core.ops.op_hb_nearby_entities(
            maxDistance == null || maxDistance == undefined ? null : Number(maxDistance),
            classifications == null || classifications == undefined ? null : classifications.map(String),
        );
  },
    currentTradeInfo() {
        const tradeInfo = Deno.core.ops.op_hb_current_trade_info();
        if (tradeInfo == null) {
            return null;
        }

        return {
            partnerGuid: tradeInfo.partner_guid,
            partnerName: tradeInfo.partner_name,
            ourItems: tradeInfo.our_items,
            theirItems: tradeInfo.their_items,
        };
    },
    equipment() {
        return new Map(
            Deno.core.ops.op_hb_equipment().map(({ slot, equip_mask, item_guid }) => [
                slot,
                {
                    equipMask: equip_mask,
                    itemGuid: item_guid,
                },
            ]),
        );
    },
    spellbook() {
        return Deno.core.ops.op_hb_spellbook();
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
        op_hb_say,
        op_hb_emote,
        op_hb_current_trade_info,
        op_hb_equipment,
        op_hb_spellbook,
        op_hb_equip,
        op_hb_unequip,
        op_hb_open_trade,
        op_hb_add_to_trade,
        op_hb_accept_trade,
        op_hb_decline_trade,
        op_hb_reset_trade,
        op_hb_exit_trade,
        op_hb_snap_heading,
        op_hb_scoot,
        op_hb_combine,
        op_hb_salvage,
        op_hb_assess,
        op_hb_drop,
        op_hb_pickup,
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
    with_current_script_client_view(state, |view| unsafe { view.equipment() })
        .unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_spellbook(state: &mut OpState) -> Vec<u32> {
    with_current_script_client_view(state, |view| unsafe { view.spellbook() })
        .unwrap_or_default()
}

#[op2]
#[serde]
fn op_hb_current_trade_info(state: &mut OpState) -> Option<ScriptTradeInfo> {
    with_current_script_client_view(state, |view| unsafe { view.current_trade_info() }).flatten()
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
        ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent, ScriptEntityKind,
        ScriptEntityView, ScriptEquipmentSlotKind, ScriptEquipmentSlotView, ScriptEvent,
        ScriptIntent, ScriptSelfView, ScriptSource, ScriptTradeInfo,
    };
    use holtburger_common::Guid;
    use holtburger_common::properties::{
        EquipMask, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt,
        PropertyInt64, PropertyString,
    };

    #[derive(Default)]
    struct TestView;

    impl crate::ScriptClientView for TestView {
        fn self_entity(&self) -> Option<ScriptSelfView> {
            None
        }

        fn target_entity(&self) -> Option<ScriptEntityView> {
            None
        }

        fn entity(&self, _guid: Guid) -> Option<ScriptEntityView> {
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

        fn inventory_items(&self) -> Vec<crate::ScriptInventoryItemView> {
            Vec::new()
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

        fn current_trade_info(&self) -> Option<ScriptTradeInfo> {
            Some(ScriptTradeInfo {
                partner_guid: Guid(7),
                partner_name: Some("Buddy".to_string()),
                our_items: vec![Guid(11)],
                their_items: vec![Guid(21), Guid(22)],
            })
        }

        fn fellowship(&self) -> Option<crate::ScriptPartyView> {
            None
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
    fn v8_script_tests_run_in_single_thread_to_avoid_v8_platform_teardown() {
        dispatch_source_escapes_javascript_line_separators();
        equipment_helper_returns_js_map();
        spellbook_helper_returns_js_array();
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
