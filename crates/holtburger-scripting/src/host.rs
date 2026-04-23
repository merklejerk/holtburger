use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::io::Read;
use std::rc::Rc;
use std::sync::{Once, OnceLock, mpsc};
use std::thread;
use std::time::Duration;

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
    ScriptBusyOperation, ScriptCharacterSheetView, ScriptClientIntent, ScriptClientInteraction,
    ScriptClientView, ScriptCombatInfo, ScriptConfirmation, ScriptContainerView,
    ScriptEnchantmentView, ScriptEntityKind, ScriptEntityView, ScriptEquipmentSlotKind,
    ScriptEquipmentSlotView, ScriptEvent, ScriptFetchPolicy, ScriptHostConfig, ScriptIntent,
    ScriptJsonValue, ScriptMessageStyle, ScriptPartyView, ScriptPositionRef, ScriptPostError,
    ScriptPostErrorCode, ScriptPostRequest, ScriptPostResponse, ScriptSelfView, ScriptSource,
    ScriptTradeInfo,
};

const BOOTSTRAP_SCRIPT_NAME: &str = "<holtburger-bootstrap>";
const EVENT_SCRIPT_NAME: &str = "<holtburger-event>";
const USER_SCRIPT_NAME: &str = "<holtburger-user-script>";
const FETCH_COMPLETION_SCRIPT_NAME: &str = "<holtburger-fetch-completion>";
const SCRIPT_FETCH_ORIGIN: &str = "https://holtburger.invalid";
const SCRIPT_FETCH_USER_AGENT: &str =
    concat!("Holtburger/", env!("CARGO_PKG_VERSION"), " ScriptFetch");
const SCRIPT_FETCH_WORKER_COUNT: usize = 2;
static V8_PLATFORM_INIT: Once = Once::new();
static FETCH_WORKER_POOL: OnceLock<FetchWorkerPool> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptFetchOpOutcome {
    response: Option<ScriptPostResponse>,
    error: Option<ScriptPostError>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptFetchStartOutcome {
    request_id: Option<u64>,
    error: Option<ScriptPostError>,
}

impl ScriptFetchStartOutcome {
    fn queued(request_id: u64) -> Self {
        Self {
            request_id: Some(request_id),
            error: None,
        }
    }

    fn failure(code: ScriptPostErrorCode, message: impl Into<String>) -> Self {
        Self {
            request_id: None,
            error: Some(ScriptPostError {
                code,
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug)]
struct PreparedFetchRequest {
    request: ScriptPostRequest,
    url: reqwest::Url,
    timeout: Duration,
    max_response_bytes: usize,
}

#[derive(Debug)]
struct PendingFetchRequest {
    request_id: u64,
    prepared: PreparedFetchRequest,
    completion_tx: mpsc::Sender<CompletedFetchRequest>,
}

#[derive(Debug, Clone)]
struct CompletedFetchRequest {
    request_id: u64,
    outcome: ScriptFetchOpOutcome,
}

struct FetchWorkerPool {
    job_tx: mpsc::Sender<PendingFetchRequest>,
}

impl FetchWorkerPool {
    fn new() -> Self {
        let (job_tx, job_rx) = mpsc::channel::<PendingFetchRequest>();
        let shared_rx = std::sync::Arc::new(std::sync::Mutex::new(job_rx));

        for worker_index in 0..SCRIPT_FETCH_WORKER_COUNT {
            let worker_rx = shared_rx.clone();
            thread::Builder::new()
                .name(format!("script-fetch-worker-{worker_index}"))
                .spawn(move || {
                    loop {
                        let job = {
                            let receiver =
                                worker_rx.lock().expect("fetch worker receiver poisoned");
                            receiver.recv()
                        };

                        let Ok(job) = job else {
                            break;
                        };

                        let outcome = execute_prepared_post_request(job.prepared);
                        let _ = job.completion_tx.send(CompletedFetchRequest {
                            request_id: job.request_id,
                            outcome,
                        });
                    }
                })
                .expect("spawn script fetch worker thread");
        }

        Self { job_tx }
    }

    fn submit(
        &self,
        request: PendingFetchRequest,
    ) -> std::result::Result<(), Box<PendingFetchRequest>> {
        self.job_tx.send(request).map_err(|error| Box::new(error.0))
    }
}

fn fetch_worker_pool() -> &'static FetchWorkerPool {
    FETCH_WORKER_POOL.get_or_init(FetchWorkerPool::new)
}

impl ScriptFetchOpOutcome {
    fn success(response: ScriptPostResponse) -> Self {
        Self {
            response: Some(response),
            error: None,
        }
    }

    fn failure(code: ScriptPostErrorCode, message: impl Into<String>) -> Self {
        Self {
            response: None,
            error: Some(ScriptPostError {
                code,
                message: message.into(),
            }),
        }
    }
}

#[derive(Clone, Copy)]
struct ScriptClientViewPtr {
    data: *const (),
    self_entity: unsafe fn(*const ()) -> Option<ScriptSelfView>,
    character_sheet: unsafe fn(*const ()) -> Option<ScriptCharacterSheetView>,
    entity_bool_prop: unsafe fn(*const (), Guid, PropertyBool) -> Option<bool>,
    entity_int_prop: unsafe fn(*const (), Guid, PropertyInt) -> Option<i32>,
    entity_int64_prop: unsafe fn(*const (), Guid, PropertyInt64) -> Option<i64>,
    entity_float_prop: unsafe fn(*const (), Guid, PropertyFloat) -> Option<f64>,
    entity_string_prop: unsafe fn(*const (), Guid, PropertyString) -> Option<String>,
    entity_data_prop: unsafe fn(*const (), Guid, PropertyDataId) -> Option<Guid>,
    entity_instance_prop: unsafe fn(*const (), Guid, PropertyInstanceId) -> Option<Guid>,
    load_config: unsafe fn(*const ()) -> Option<ScriptJsonValue>,
    load_data: unsafe fn(*const ()) -> Option<ScriptJsonValue>,
    load_data_bin: unsafe fn(*const ()) -> Option<Vec<u8>>,
    write_config: unsafe fn(*const (), String) -> bool,
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
    server_time: unsafe fn(*const ()) -> Option<f64>,
    pending_confirmation: unsafe fn(*const ()) -> Option<ScriptConfirmation>,
    busy_operation: unsafe fn(*const ()) -> ScriptBusyOperation,
}

impl ScriptClientViewPtr {
    fn from_ref<T: ScriptClientView>(view: &T) -> Self {
        unsafe fn self_entity<T: ScriptClientView>(data: *const ()) -> Option<ScriptSelfView> {
            unsafe { (&*data.cast::<T>()).self_entity() }
        }

        unsafe fn character_sheet<T: ScriptClientView>(
            data: *const (),
        ) -> Option<ScriptCharacterSheetView> {
            unsafe { (&*data.cast::<T>()).character_sheet() }
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

        unsafe fn load_config<T: ScriptClientView>(data: *const ()) -> Option<ScriptJsonValue> {
            unsafe { (&*data.cast::<T>()).load_config() }
        }

        unsafe fn load_data<T: ScriptClientView>(data: *const ()) -> Option<ScriptJsonValue> {
            unsafe { (&*data.cast::<T>()).load_data() }
        }

        unsafe fn load_data_bin<T: ScriptClientView>(data: *const ()) -> Option<Vec<u8>> {
            unsafe { (&*data.cast::<T>()).load_data_bin() }
        }

        unsafe fn write_config<T: ScriptClientView>(data: *const (), contents: String) -> bool {
            unsafe { (&*data.cast::<T>()).write_config(contents) }
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

        unsafe fn server_time<T: ScriptClientView>(data: *const ()) -> Option<f64> {
            unsafe { (&*data.cast::<T>()).server_time() }
        }

        unsafe fn pending_confirmation<T: ScriptClientView>(
            data: *const (),
        ) -> Option<ScriptConfirmation> {
            unsafe { (&*data.cast::<T>()).pending_confirmation() }
        }

        unsafe fn busy_operation<T: ScriptClientView>(data: *const ()) -> ScriptBusyOperation {
            unsafe { (&*data.cast::<T>()).busy_operation() }
        }

        Self {
            data: (view as *const T).cast(),
            self_entity: self_entity::<T>,
            character_sheet: character_sheet::<T>,
            entity_bool_prop: entity_bool_prop::<T>,
            entity_int_prop: entity_int_prop::<T>,
            entity_int64_prop: entity_int64_prop::<T>,
            entity_float_prop: entity_float_prop::<T>,
            entity_string_prop: entity_string_prop::<T>,
            entity_data_prop: entity_data_prop::<T>,
            entity_instance_prop: entity_instance_prop::<T>,
            load_config: load_config::<T>,
            load_data: load_data::<T>,
            load_data_bin: load_data_bin::<T>,
            write_config: write_config::<T>,
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
            server_time: server_time::<T>,
            pending_confirmation: pending_confirmation::<T>,
            busy_operation: busy_operation::<T>,
        }
    }

    unsafe fn self_entity(self) -> Option<ScriptSelfView> {
        unsafe { (self.self_entity)(self.data) }
    }

    unsafe fn character_sheet(self) -> Option<ScriptCharacterSheetView> {
        unsafe { (self.character_sheet)(self.data) }
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

    unsafe fn load_config(self) -> Option<ScriptJsonValue> {
        unsafe { (self.load_config)(self.data) }
    }

    unsafe fn load_data(self) -> Option<ScriptJsonValue> {
        unsafe { (self.load_data)(self.data) }
    }

    unsafe fn load_data_bin(self) -> Option<Vec<u8>> {
        unsafe { (self.load_data_bin)(self.data) }
    }

    unsafe fn write_config(self, contents: String) -> bool {
        unsafe { (self.write_config)(self.data, contents) }
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

    unsafe fn server_time(self) -> Option<f64> {
        unsafe { (self.server_time)(self.data) }
    }

    unsafe fn pending_confirmation(self) -> Option<ScriptConfirmation> {
        unsafe { (self.pending_confirmation)(self.data) }
    }

    unsafe fn busy_operation(self) -> ScriptBusyOperation {
        unsafe { (self.busy_operation)(self.data) }
    }
}

const BOOTSTRAP_JS: &str = r#"
const __holtburgerHandlers = [];
const __holtburgerPendingFetches = new Map();

globalThis.__holtburgerCompleteFetch = (requestId, result) => {
    const pending = __holtburgerPendingFetches.get(requestId);
    if (!pending) {
        return;
    }

    __holtburgerPendingFetches.delete(requestId);

    if (result.error) {
        const error = new Error(result.error.message);
        error.code = result.error.code;
        pending.reject(error);
        return;
    }

    pending.resolve(result.response);
};

globalThis.Holtburger = globalThis.HB = Object.freeze({
  onEvent(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Holtburger.onEvent expects a function");
    }
    __holtburgerHandlers.push(handler);
    },
    selfEntity() {
        return Deno.core.ops.op_hb_self_entity();
    },
    characterSheet() {
        return Deno.core.ops.op_hb_character_sheet();
    },
    postJson(request) {
        if (request == null || typeof request !== "object" || Array.isArray(request)) {
            return Promise.reject(new TypeError("Holtburger.postJson expects a request object"));
        }

        const result = Deno.core.ops.op_hb_post_json_start(request);
        if (result.error) {
            const error = new Error(result.error.message);
            error.code = result.error.code;
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            __holtburgerPendingFetches.set(result.requestId, { resolve, reject });
        });
    },
    attack(guid) {
        Deno.core.ops.op_hb_attack(Number(guid) >>> 0);
    },
    setCombatMode(on) {
        Deno.core.ops.op_hb_set_combat_mode(Boolean(on));
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
    serverTime() {
        return Deno.core.ops.op_hb_server_time();
    },
    pendingConfirmation() {
        return Deno.core.ops.op_hb_pending_confirmation();
    },
    busyOperation() {
        return Deno.core.ops.op_hb_busy_operation();
    },
    respondToConfirmation(accepted) {
        Deno.core.ops.op_hb_respond_to_confirmation(Boolean(accepted));
    },
    castSpell(spellId, target = null) {
        Deno.core.ops.op_hb_cast_spell(
            Number(spellId) >>> 0,
            target == null ? 0 : Number(target) >>> 0,
        );
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
    loadConfig() {
        return Deno.core.ops.op_hb_load_config();
    },
    loadData() {
        return Deno.core.ops.op_hb_load_data();
    },
    loadDataBin() {
        return Deno.core.ops.op_hb_load_data_bin();
    },
    writeConfig(contents) {
        const serialized = typeof contents === "string" ? contents : JSON.stringify(contents);
        return Deno.core.ops.op_hb_write_config(serialized);
    },
    print(style, message) {
        Deno.core.ops.op_hb_print(String(style), String(message));
    },
    debugLog(message) {
        Deno.core.ops.op_hb_debug_log(String(message));
    },
    say(message) {
        Deno.core.ops.op_hb_say(String(message));
    },
    emote(message) {
        Deno.core.ops.op_hb_emote(String(message));
    },
    soulEmote(token) {
        Deno.core.ops.op_hb_soul_emote(String(token));
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
    moveItem(item, container) {
        Deno.core.ops.op_hb_move_item(Number(item) >>> 0, Number(container) >>> 0);
    },
    stackItems(source, destination, amount) {
        Deno.core.ops.op_hb_stack_items(
            Number(source) >>> 0,
            Number(destination) >>> 0,
            Number(amount) >>> 0,
        );
    },
    splitItem(item, container, amount) {
        Deno.core.ops.op_hb_split_item(
            Number(item) >>> 0,
            Number(container) >>> 0,
            Number(amount) >>> 0,
        );
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
        op_hb_character_sheet,
        op_hb_post_json_start,
        op_hb_nearby_entities,
        op_hb_entity_bool_prop,
        op_hb_entity_int_prop,
        op_hb_entity_int64_prop,
        op_hb_entity_float_prop,
        op_hb_entity_string_prop,
        op_hb_entity_data_prop,
        op_hb_entity_instance_prop,
        op_hb_load_config,
        op_hb_load_data,
        op_hb_load_data_bin,
        op_hb_write_config,
        op_hb_print,
        op_hb_debug_log,
        op_hb_say,
        op_hb_emote,
        op_hb_soul_emote,
        op_hb_combat_info,
        op_hb_current_interaction,
        op_hb_enchantments,
        op_hb_distance,
        op_hb_current_trade_info,
        op_hb_current_open_container,
        op_hb_server_time,
        op_hb_pending_confirmation,
        op_hb_busy_operation,
        op_hb_respond_to_confirmation,
        op_hb_cast_spell,
        op_hb_set_combat_mode,
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
        op_hb_move_item,
        op_hb_stack_items,
        op_hb_split_item,
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
    config: ScriptHostConfig,
    fetch_completion_tx: mpsc::Sender<CompletedFetchRequest>,
    fetch_completion_rx: mpsc::Receiver<CompletedFetchRequest>,
    next_fetch_request_id: u64,
}

impl HostRuntimeState {
    fn new(outputs: Rc<RefCell<Vec<ScriptIntent>>>, config: ScriptHostConfig) -> Self {
        let (fetch_completion_tx, fetch_completion_rx) = mpsc::channel();
        Self {
            outputs,
            current_context: Cell::new(None),
            config,
            fetch_completion_tx,
            fetch_completion_rx,
            next_fetch_request_id: 1,
        }
    }

    fn start_post_request(&mut self, request: ScriptPostRequest) -> ScriptFetchStartOutcome {
        let prepared = match prepare_post_request(&self.config.fetch_policy, request) {
            Ok(prepared) => prepared,
            Err(error) => {
                return ScriptFetchStartOutcome {
                    request_id: None,
                    error: error.error,
                };
            }
        };

        let request_id = self.next_fetch_request_id;
        self.next_fetch_request_id += 1;

        let pending = PendingFetchRequest {
            request_id,
            prepared,
            completion_tx: self.fetch_completion_tx.clone(),
        };

        if fetch_worker_pool().submit(pending).is_err() {
            return ScriptFetchStartOutcome::failure(
                ScriptPostErrorCode::Transport,
                "failed to queue post request",
            );
        }

        ScriptFetchStartOutcome::queued(request_id)
    }

    fn drain_fetch_completions(&mut self) -> Vec<CompletedFetchRequest> {
        self.fetch_completion_rx.try_iter().collect()
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
fn op_hb_character_sheet(state: &mut OpState) -> Option<ScriptCharacterSheetView> {
    with_current_script_client_view(state, |view| unsafe { view.character_sheet() }).flatten()
}

#[op2]
#[serde]
fn op_hb_post_json_start(
    state: &mut OpState,
    #[serde] request: deno_core::serde_json::Value,
) -> ScriptFetchStartOutcome {
    match from_value::<ScriptPostRequest>(request) {
        Ok(request) => state
            .borrow_mut::<HostRuntimeState>()
            .start_post_request(request),
        Err(error) => ScriptFetchStartOutcome::failure(
            ScriptPostErrorCode::InvalidRequest,
            format!("invalid postJson request: {error}"),
        ),
    }
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
fn op_hb_server_time(state: &mut OpState) -> Option<Value> {
    let server_time = with_current_script_client_view(state, |view| unsafe { view.server_time() })
        .flatten()
        .unwrap_or_default();

    Some(json!(server_time))
}

#[op2]
#[serde]
fn op_hb_pending_confirmation(state: &mut OpState) -> Option<ScriptConfirmation> {
    with_current_script_client_view(state, |view| unsafe { view.pending_confirmation() }).flatten()
}

#[op2]
#[serde]
fn op_hb_busy_operation(state: &mut OpState) -> ScriptBusyOperation {
    with_current_script_client_view(state, |view| unsafe { view.busy_operation() })
        .unwrap_or_default()
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
fn op_hb_respond_to_confirmation(state: &mut OpState, accepted: bool) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::RespondToConfirmation { accepted });
}

#[op2(fast)]
fn op_hb_cast_spell(state: &mut OpState, spell_id: u32, target: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::CastSpell {
            spell_id,
            target: (target != 0).then_some(Guid(target)),
        });
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
                .push(ScriptIntent::Print {
                    style: ScriptMessageStyle::Error,
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

#[op2]
#[serde]
fn op_hb_load_config(state: &mut OpState) -> Option<ScriptJsonValue> {
    with_current_script_client_view(state, |view| unsafe { view.load_config() }).flatten()
}

#[op2]
#[serde]
fn op_hb_load_data(state: &mut OpState) -> Option<ScriptJsonValue> {
    with_current_script_client_view(state, |view| unsafe { view.load_data() }).flatten()
}

#[op2]
#[serde]
fn op_hb_load_data_bin(state: &mut OpState) -> Option<Vec<u8>> {
    with_current_script_client_view(state, |view| unsafe { view.load_data_bin() }).flatten()
}

#[op2(fast)]
fn op_hb_write_config(state: &mut OpState, #[string] contents: String) -> bool {
    with_current_script_client_view(state, |view| unsafe { view.write_config(contents) })
        .unwrap_or(false)
}

#[op2(fast)]
fn op_hb_print(state: &mut OpState, #[string] style: String, #[string] message: String) {
    let style = parse_script_message_style(&style);
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::Print { style, message });
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
fn op_hb_soul_emote(state: &mut OpState, #[string] token: String) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::SoulEmote { token });
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
fn op_hb_move_item(state: &mut OpState, item: u32, container: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::MoveItem {
            item: Guid(item),
            container: Guid(container),
        });
}

#[op2(fast)]
fn op_hb_stack_items(state: &mut OpState, source: u32, destination: u32, amount: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::StackItems {
            source: Guid(source),
            destination: Guid(destination),
            amount,
        });
}

#[op2(fast)]
fn op_hb_split_item(state: &mut OpState, item: u32, container: u32, amount: u32) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::SplitItem {
            item: Guid(item),
            container: Guid(container),
            amount,
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
                .push(ScriptIntent::Print {
                    style: ScriptMessageStyle::Error,
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
fn op_hb_set_combat_mode(state: &mut OpState, on: bool) {
    state
        .borrow::<HostRuntimeState>()
        .outputs
        .borrow_mut()
        .push(ScriptIntent::SetCombatMode { on });
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

fn parse_script_message_style(style: &str) -> ScriptMessageStyle {
    match style.trim().to_ascii_lowercase().as_str() {
        "trace" => ScriptMessageStyle::Trace,
        "debug" => ScriptMessageStyle::Debug,
        "system" => ScriptMessageStyle::System,
        "chat" => ScriptMessageStyle::Chat,
        "combat" => ScriptMessageStyle::Combat,
        "tell" => ScriptMessageStyle::Tell,
        "emote" => ScriptMessageStyle::Emote,
        "party" | "fellowship" => ScriptMessageStyle::Party,
        "guild" | "allegiance" | "vassals" | "patron" | "monarch" | "covassals" => {
            ScriptMessageStyle::Guild
        }
        "trade" => ScriptMessageStyle::Trade,
        "help" => ScriptMessageStyle::Help,
        "society" => ScriptMessageStyle::Society,
        "magic" => ScriptMessageStyle::Magic,
        "warn" | "warning" => ScriptMessageStyle::Warn,
        "error" => ScriptMessageStyle::Error,
        _ => ScriptMessageStyle::Info,
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

fn script_post_error(
    code: ScriptPostErrorCode,
    message: impl Into<String>,
) -> ScriptFetchOpOutcome {
    ScriptFetchOpOutcome::failure(code, message)
}

fn prepare_post_request(
    policy: &ScriptFetchPolicy,
    request: ScriptPostRequest,
) -> std::result::Result<PreparedFetchRequest, ScriptFetchOpOutcome> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| {
        script_post_error(
            ScriptPostErrorCode::InvalidRequest,
            format!("invalid postJson URL: {error}"),
        )
    })?;

    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(script_post_error(
                ScriptPostErrorCode::InvalidRequest,
                format!("unsupported postJson URL scheme: {scheme}"),
            ));
        }
    }

    let host = url.host_str().ok_or_else(|| {
        script_post_error(
            ScriptPostErrorCode::InvalidRequest,
            "postJson URL must include a host",
        )
    })?;
    let port = url.port_or_known_default().ok_or_else(|| {
        script_post_error(
            ScriptPostErrorCode::InvalidRequest,
            "postJson URL must resolve to a network port",
        )
    })?;

    if !policy.allows(host, port) {
        return Err(script_post_error(
            ScriptPostErrorCode::PolicyDenied,
            format!("postJson denied for host {host}:{port}"),
        ));
    }

    Ok(PreparedFetchRequest {
        timeout: Duration::from_millis(policy.effective_timeout_ms(request.timeout_ms)),
        max_response_bytes: policy.max_response_bytes,
        request,
        url,
    })
}

fn read_limited_response_body(
    response: &mut reqwest::blocking::Response,
    max_response_bytes: usize,
) -> std::result::Result<Vec<u8>, ScriptFetchOpOutcome> {
    let mut body = Vec::new();
    let mut chunk = [0_u8; 8 * 1024];

    loop {
        let bytes_read = response.read(&mut chunk).map_err(|error| {
            script_post_error(
                ScriptPostErrorCode::Transport,
                format!("failed to read postJson response body: {error}"),
            )
        })?;

        if bytes_read == 0 {
            break;
        }

        if bytes_read > max_response_bytes.saturating_sub(body.len()) {
            return Err(script_post_error(
                ScriptPostErrorCode::ResponseTooLarge,
                format!(
                    "postJson response exceeded max size of {} bytes",
                    max_response_bytes
                ),
            ));
        }

        body.extend_from_slice(&chunk[..bytes_read]);
    }

    Ok(body)
}

fn parse_fetch_response_body(
    body: &[u8],
) -> std::result::Result<Option<ScriptJsonValue>, ScriptFetchOpOutcome> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }

    deno_core::serde_json::from_slice::<ScriptJsonValue>(body)
        .map(Some)
        .map_err(|error| {
            script_post_error(
                ScriptPostErrorCode::InvalidJsonResponse,
                format!("postJson response was not valid JSON: {error}"),
            )
        })
}

fn execute_prepared_post_request(prepared: PreparedFetchRequest) -> ScriptFetchOpOutcome {
    let PreparedFetchRequest {
        request,
        url,
        timeout,
        max_response_bytes,
    } = prepared;

    let client = match reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return script_post_error(
                ScriptPostErrorCode::Transport,
                format!("failed to create postJson client: {error}"),
            );
        }
    };

    let mut request_builder = client
        .post(url)
        .header(reqwest::header::ORIGIN, SCRIPT_FETCH_ORIGIN)
        .header(reqwest::header::USER_AGENT, SCRIPT_FETCH_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json");

    let body_json = request.body_json.unwrap_or(Value::Null);
    request_builder = request_builder
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body_json);

    let mut response = match request_builder.send() {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return script_post_error(
                ScriptPostErrorCode::Timeout,
                format!(
                    "postJson request timed out after {} ms",
                    timeout.as_millis()
                ),
            );
        }
        Err(error) => {
            return script_post_error(
                ScriptPostErrorCode::Transport,
                format!("postJson request failed: {error}"),
            );
        }
    };

    let status = response.status();
    let body = match read_limited_response_body(&mut response, max_response_bytes) {
        Ok(body) => body,
        Err(error) => return error,
    };
    let body_json = match parse_fetch_response_body(&body) {
        Ok(body_json) => body_json,
        Err(error) => return error,
    };

    ScriptFetchOpOutcome::success(ScriptPostResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        body_json,
    })
}

fn ensure_v8_platform_initialized() {
    V8_PLATFORM_INIT.call_once(|| {
        JsRuntime::init_platform(None, false);
    });
}

fn create_js_runtime(
    outputs: Rc<RefCell<Vec<ScriptIntent>>>,
    config: ScriptHostConfig,
) -> JsRuntime {
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![holtburger_script_ext::init_ops_and_esm()],
        ..Default::default()
    });

    js_runtime
        .op_state()
        .borrow_mut()
        .put(HostRuntimeState::new(outputs, config));

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
    run_js_event_loop(js_runtime, display_name)
}

fn run_js_event_loop(js_runtime: &mut JsRuntime, display_name: &str) -> Result<()> {
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

fn build_fetch_completion_source(completions: &[CompletedFetchRequest]) -> Result<Option<String>> {
    if completions.is_empty() {
        return Ok(None);
    }

    let mut statements = VecDeque::with_capacity(completions.len());
    for completion in completions {
        let outcome_json = deno_core::serde_json::to_string(&completion.outcome)
            .context("failed to serialize fetch completion outcome")?;
        let outcome_literal = deno_core::serde_json::to_string(&outcome_json)
            .context("failed to serialize fetch completion JSON literal")?;
        let outcome_literal = escape_js_string_separators(&outcome_literal);

        statements.push_back(format!(
            "globalThis.__holtburgerCompleteFetch({}, JSON.parse({outcome_literal}));",
            completion.request_id
        ));
    }

    Ok(Some(statements.into_iter().collect::<Vec<_>>().join("\n")))
}

fn drain_completed_fetches(js_runtime: &mut JsRuntime) -> Result<()> {
    let completions = {
        let op_state = js_runtime.op_state();
        let mut op_state_ref = op_state.borrow_mut();
        op_state_ref
            .borrow_mut::<HostRuntimeState>()
            .drain_fetch_completions()
    };

    let Some(source) = build_fetch_completion_source(&completions)? else {
        return Ok(());
    };

    js_runtime
        .execute_script(FETCH_COMPLETION_SCRIPT_NAME, source)
        .context("failed to execute fetch completion script")?;
    run_js_event_loop(js_runtime, FETCH_COMPLETION_SCRIPT_NAME)
}

pub struct ScriptHost {
    js_runtime: JsRuntime,
    outputs: Rc<RefCell<Vec<ScriptIntent>>>,
}

impl ScriptHost {
    pub fn spawn<T: ScriptClientView>(source: ScriptSource, context: &T) -> Result<Self> {
        Self::spawn_with_config(source, context, ScriptHostConfig::default())
    }

    pub fn spawn_with_config<T: ScriptClientView>(
        source: ScriptSource,
        context: &T,
        config: ScriptHostConfig,
    ) -> Result<Self> {
        ensure_v8_platform_initialized();

        let outputs = Rc::new(RefCell::new(Vec::new()));
        let mut js_runtime = create_js_runtime(outputs.clone(), config);
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
            drain_completed_fetches(js_runtime)?;
            run_js_script(
                js_runtime,
                EVENT_SCRIPT_NAME,
                EVENT_SCRIPT_NAME,
                dispatch_source,
            )?;
            drain_completed_fetches(js_runtime)
        })
    }

    pub fn pump(&mut self, context: &impl ScriptClientView) -> Result<()> {
        with_active_script_context(&mut self.js_runtime, context, drain_completed_fetches)
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
        ScriptClientInteraction, ScriptCombatInfo, ScriptConfirmation, ScriptContainerView,
        ScriptEnchantmentView, ScriptEntityKind, ScriptEntityView, ScriptEquipmentSlotKind,
        ScriptEquipmentSlotView, ScriptEvent, ScriptFetchAllowedHost, ScriptHostConfig,
        ScriptIntent, ScriptLifecycleEvent, ScriptLocalConfirmation, ScriptLocalConfirmationKind,
        ScriptPartyMemberView, ScriptPartyView, ScriptPositionRef, ScriptSelfView, ScriptSource,
        ScriptTradeInfo,
    };
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        EquipMask, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt,
        PropertyInt64, PropertyString,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct TestView;

    fn resolve_position(reference: ScriptPositionRef) -> Option<WorldPosition> {
        match reference {
            ScriptPositionRef::Position(position) => Some(position.into()),
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

        fn server_time(&self) -> Option<f64> {
            Some(123.5)
        }

        fn pending_confirmation(&self) -> Option<ScriptConfirmation> {
            Some(ScriptConfirmation::Local(ScriptLocalConfirmation {
                kind: ScriptLocalConfirmationKind::Unswear,
                text: "Please unswear first".to_string(),
            }))
        }

        fn busy_operation(&self) -> ScriptBusyOperation {
            ScriptBusyOperation::Sell
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
                weenie_id: None,
                position: WorldPosition::default().into(),
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
        server_time_pending_confirmation_and_busy_operation_helpers_return_js_values();
        distance_and_heading_helpers_accept_guids_and_positions();
        combat_info_helper_returns_js_object();
        respond_to_confirmation_helper_emits_script_intent();
        spellbook_membership_helper_returns_boolean();
        heading_to_helper_returns_expected_heading();
        entity_exists_helper_returns_boolean();
        open_and_close_container_intents_are_emitted();
        attack_follow_and_cancel_helpers_emit_client_intents();
        current_trade_info_helper_returns_js_object();
        set_combat_mode_helper_emits_script_intent();
        post_json_helper_returns_json_response_for_post_without_body();
        post_json_helper_posts_json_body();
        post_json_helper_does_not_block_host_while_request_is_in_flight();
        post_json_helper_rejects_invalid_request_shape();
        post_json_helper_rejects_denied_host();
        post_json_helper_rejects_timeout();
    }

    fn spawn_test_http_server(
        status_line: &str,
        response_body: &str,
        delay_before_response: Duration,
    ) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener");
        let port = listener.local_addr().expect("local addr").port();
        let status_line = status_line.to_string();
        let response_body = response_body.to_string();

        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accepted connection");
            stream
                .set_read_timeout(Some(Duration::from_millis(500)))
                .expect("read timeout");

            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            let mut header_len = None;
            let mut content_length = 0_usize;

            loop {
                let bytes_read = stream.read(&mut buffer).expect("read request bytes");
                if bytes_read == 0 {
                    break;
                }

                request.extend_from_slice(&buffer[..bytes_read]);

                if header_len.is_none()
                    && let Some(position) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    let end = position + 4;
                    header_len = Some(end);
                    let headers = String::from_utf8_lossy(&request[..end]);
                    content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or_default();
                }

                if let Some(header_len) = header_len
                    && request.len() >= header_len + content_length
                {
                    break;
                }
            }

            if !delay_before_response.is_zero() {
                thread::sleep(delay_before_response);
            }

            let response = format!(
                "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");

            String::from_utf8(request).expect("utf8 request")
        });

        (port, handle)
    }

    fn spawn_post_test_host(source: ScriptSource, port: u16, timeout_ms: u64) -> super::ScriptHost {
        super::ScriptHost::spawn_with_config(
            source,
            &TestView,
            ScriptHostConfig {
                fetch_policy: crate::ScriptFetchPolicy {
                    allowed_hosts: vec![ScriptFetchAllowedHost::new("127.0.0.1", port)],
                    timeout_ms,
                    max_response_bytes: 16 * 1024,
                },
            },
        )
        .expect("script host")
    }

    fn pump_post_test_host(host: &mut super::ScriptHost) -> Vec<ScriptIntent> {
        let deadline = Instant::now() + Duration::from_millis(500);

        loop {
            host.pump(&TestView).expect("pump script host");
            let outputs = host.drain_outputs();
            if !outputs.is_empty() || Instant::now() >= deadline {
                return outputs;
            }

            thread::sleep(Duration::from_millis(10));
        }
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

    #[test]
    fn dispatch_source_serializes_command_event() {
        let event = ScriptEvent::Command {
            msg: "ping the script".to_string(),
        };

        let source = build_dispatch_source(&event).expect("dispatch source should serialize");

        assert!(source.contains("\\\"kind\\\":\\\"command\\\""));
        assert!(source.contains("\\\"msg\\\":\\\"ping the script\\\""));
        assert!(source.contains("JSON.parse("));
    }

    #[test]
    fn dispatch_source_serializes_started_lifecycle_args() {
        let event = ScriptEvent::Lifecycle(ScriptLifecycleEvent::Started {
            args: "loot now".to_string(),
        });

        let source = build_dispatch_source(&event).expect("dispatch source should serialize");

        assert!(source.contains("\\\"kind\\\":\\\"started\\\""));
        assert!(source.contains("\\\"args\\\":\\\"loot now\\\""));
        assert!(source.contains("JSON.parse("));
    }

    fn equipment_helper_returns_js_map() {
        let source = ScriptSource::new(
            "equipment-map-test",
            r#"
                const equipment = Holtburger.equipment();
                Holtburger.print(
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
            [ScriptIntent::Print { message, .. }]
                if message == "[true,true,42]"
        ));
    }

    fn spellbook_helper_returns_js_array() {
        let source = ScriptSource::new(
            "spellbook-array-test",
            r#"
                const spellbook = Holtburger.spellbook();
                Holtburger.print("info", JSON.stringify(spellbook));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "[7,11,13]"
        ));
    }

    fn inventory_helper_returns_js_array_of_container_views() {
        let source = ScriptSource::new(
            "inventory-array-test",
            r#"
                const inventory = Holtburger.inventory();
                Holtburger.print(
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
            [ScriptIntent::Print { message, .. }]
                if message == "[true,1,17,4,[11,12]]"
        ));
    }

    fn current_open_container_helper_returns_js_option() {
        let source = ScriptSource::new(
            "current-open-container-test",
            r#"
                Holtburger.print("info", String(Holtburger.currentOpenContainer()));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "17"
        ));
    }

    fn current_interaction_helper_returns_js_object() {
        let source = ScriptSource::new(
            "current-interaction-test",
            r#"
                const interaction = Holtburger.currentInteraction();
                Holtburger.print("info", JSON.stringify(interaction));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "{\"kind\":\"Attack\",\"data\":{\"guid\":7}}"
        ));
    }

    fn enchantments_helper_returns_js_array() {
        let source = ScriptSource::new(
            "enchantments-test",
            r#"
                const enchantments = Holtburger.enchantments();
                Holtburger.print("info", JSON.stringify(enchantments));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "[{\"spellId\":7,\"endTime\":123.5},{\"spellId\":11,\"endTime\":222.25}]"
        ));
    }

    fn entity_helper_returns_js_object() {
        let source = ScriptSource::new(
            "entity-test",
            r#"
                const entity = Holtburger.entity(11);
                Holtburger.print("info", JSON.stringify([entity.guid, entity.name, entity.kind]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "[11,\"Lesser Healing Kit\",\"healing_kit\"]"
        ));
    }

    fn debug_log_helper_emits_no_script_outputs() {
        let source = ScriptSource::new(
            "debug-log-test",
            r#"
                Holtburger.debugLog("script diagnostics");
                Holtburger.print("info", "after debug log");
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "after debug log"
        ));
    }

    fn party_helper_returns_js_object() {
        let source = ScriptSource::new(
            "party-test",
            r#"
                const party = Holtburger.party();
                Holtburger.print("info", JSON.stringify(party));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
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

    fn server_time_pending_confirmation_and_busy_operation_helpers_return_js_values() {
        let source = ScriptSource::new(
            "script-state-test",
            r#"
                const values = [
                    Holtburger.serverTime(),
                    Holtburger.pendingConfirmation(),
                    Holtburger.busyOperation(),
                ];
                Holtburger.print("info", JSON.stringify(values));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        match outputs.as_slice() {
            [ScriptIntent::Print { message, .. }]
                if message
                    == "[123.5,{\"kind\":\"local\",\"data\":{\"kind\":{\"kind\":\"unswear\"},\"text\":\"Please unswear first\"}},\"sell\"]" =>
                {}
            [ScriptIntent::Print { message, .. }] => {
                panic!("unexpected script-state output: {message}")
            }
            other => panic!("unexpected outputs: {other:?}"),
        }
    }

    fn distance_and_heading_helpers_accept_guids_and_positions() {
        let source = ScriptSource::new(
            "distance-heading-test",
            r#"
                const distance = Holtburger.distance(7, 42);
                const heading = Holtburger.headingTo(7, 42);
                Holtburger.print("info", JSON.stringify([distance, heading]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
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
                Holtburger.print(
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
            [ScriptIntent::Print { message, .. }]
                if message == "[\"Melee\",true,7,0.75,\"High\",123.5]"
        ));
    }

    fn set_combat_mode_helper_emits_script_intent() {
        let source = ScriptSource::new(
            "set-combat-mode-test",
            r#"
                Holtburger.setCombatMode(false);
                Holtburger.setCombatMode(true);
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [
                ScriptIntent::SetCombatMode { on: false },
                ScriptIntent::SetCombatMode { on: true },
            ]
        ));
    }

    fn post_json_helper_returns_json_response_for_post_without_body() {
        let (port, server) = spawn_test_http_server("200 OK", "{\"pong\":true}", Duration::ZERO);
        let source = ScriptSource::new(
            "post-json-post-without-body-test",
            format!(
                r#"
                (async () => {{
                    const response = await Holtburger.postJson({{ url: "http://127.0.0.1:{port}/status" }});
                    Holtburger.print("info", JSON.stringify(response));
                }})().catch((error) => Holtburger.print("error", `${{error.code}}:${{error.message}}`));
            "#
            ),
        );

        let mut host = spawn_post_test_host(source, port, 1_000);
        assert!(host.drain_outputs().is_empty());
        let request = server.join().expect("server join");
        let outputs = pump_post_test_host(&mut host);
        let lower_request = request.to_ascii_lowercase();
        let expected_user_agent = format!(
            "user-agent: holtburger/{} scriptfetch\r\n",
            env!("CARGO_PKG_VERSION")
        );

        assert!(request.starts_with("POST /status HTTP/1.1\r\n"));
        assert!(lower_request.contains("origin: https://holtburger.invalid\r\n"));
        assert!(lower_request.contains(&expected_user_agent));
        assert!(lower_request.contains("content-type: application/json\r\n"));
        assert!(request.ends_with("null"));
        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "{\"ok\":true,\"status\":200,\"bodyJson\":{\"pong\":true}}"
        ));
    }

    fn post_json_helper_posts_json_body() {
        let (port, server) =
            spawn_test_http_server("202 Accepted", "{\"accepted\":true}", Duration::ZERO);
        let source = ScriptSource::new(
            "post-json-post-body-test",
            format!(
                r#"
                (async () => {{
                    const response = await Holtburger.postJson({{
                        url: "http://127.0.0.1:{port}/submit",
                        bodyJson: {{ action: "ping", count: 2 }},
                    }});
                    Holtburger.print("info", JSON.stringify(response));
                }})().catch((error) => Holtburger.print("error", `${{error.code}}:${{error.message}}`));
            "#
            ),
        );

        let mut host = spawn_post_test_host(source, port, 1_000);
        assert!(host.drain_outputs().is_empty());
        let request = server.join().expect("server join");
        let outputs = pump_post_test_host(&mut host);
        let lower_request = request.to_ascii_lowercase();

        assert!(request.starts_with("POST /submit HTTP/1.1\r\n"));
        assert!(lower_request.contains("content-type: application/json\r\n"));
        assert!(request.ends_with("{\"action\":\"ping\",\"count\":2}"));
        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "{\"ok\":true,\"status\":202,\"bodyJson\":{\"accepted\":true}}"
        ));
    }

    fn post_json_helper_rejects_denied_host() {
        let source = ScriptSource::new(
            "post-json-denied-test",
            r#"
                (async () => {
                    await Holtburger.postJson({ url: "http://127.0.0.1:6553/blocked" });
                })().catch((error) => Holtburger.print("error", `${error.code}:${error.message}`));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { style, message }]
                if *style == crate::ScriptMessageStyle::Error
                    && message.starts_with("policy_denied:postJson denied for host 127.0.0.1:6553")
        ));
    }

    fn post_json_helper_rejects_invalid_request_shape() {
        let source = ScriptSource::new(
            "post-json-invalid-request-test",
            r#"
                (async () => {
                    await Holtburger.postJson({ url: 7 });
                })().catch((error) => Holtburger.print("error", `${error.code}:${error.message}`));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { style, message }]
                if *style == crate::ScriptMessageStyle::Error
                    && message.starts_with("invalid_request:invalid postJson request:")
        ));
    }

    fn post_json_helper_rejects_timeout() {
        let (port, server) =
            spawn_test_http_server("200 OK", "{\"slow\":true}", Duration::from_millis(150));
        let source = ScriptSource::new(
            "post-json-timeout-test",
            format!(
                r#"
                (async () => {{
                    await Holtburger.postJson({{ url: "http://127.0.0.1:{port}/slow" }});
                }})().catch((error) => Holtburger.print("error", `${{error.code}}:${{error.message}}`));
            "#
            ),
        );

        let mut host = spawn_post_test_host(source, port, 25);
        assert!(host.drain_outputs().is_empty());
        let _ = server.join();
        let outputs = pump_post_test_host(&mut host);

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { style, message }]
                if *style == crate::ScriptMessageStyle::Error
                    && message.starts_with("timeout:postJson request timed out after 25 ms")
        ));
    }

    fn post_json_helper_does_not_block_host_while_request_is_in_flight() {
        let response_delay = Duration::from_millis(500);
        let (port, server) = spawn_test_http_server("200 OK", "{\"slow\":true}", response_delay);
        let source = ScriptSource::new(
            "post-json-non-blocking-test",
            format!(
                r#"
                (async () => {{
                    const response = await Holtburger.postJson({{ url: "http://127.0.0.1:{port}/slow" }});
                    Holtburger.print("info", JSON.stringify(response));
                }})().catch((error) => Holtburger.print("error", `${{error.code}}:${{error.message}}`));
            "#
            ),
        );

        let started_at = Instant::now();
        let mut host = spawn_post_test_host(source, port, 1_000);
        let spawn_elapsed = started_at.elapsed();

        assert!(spawn_elapsed < Duration::from_millis(250));
        assert!(host.drain_outputs().is_empty());

        let _ = server.join();
        let outputs = pump_post_test_host(&mut host);

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "{\"ok\":true,\"status\":200,\"bodyJson\":{\"slow\":true}}"
        ));
    }

    fn respond_to_confirmation_helper_emits_script_intent() {
        let source = ScriptSource::new(
            "respond-to-confirmation-test",
            r#"
                Holtburger.respondToConfirmation(true);
                Holtburger.respondToConfirmation(false);
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [
                ScriptIntent::RespondToConfirmation { accepted: true },
                ScriptIntent::RespondToConfirmation { accepted: false },
            ]
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
                Holtburger.print("info", JSON.stringify([
                    Holtburger.inSpellbook(7),
                    Holtburger.inSpellbook(99),
                ]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "[true,false]"
        ));
    }

    fn heading_to_helper_returns_expected_heading() {
        let source = ScriptSource::new(
            "heading-to-test",
            r#"
                const heading = Holtburger.headingTo(
                    { landblockId: 16777216, coords: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
                    { landblockId: 16777216, coords: { x: 0, y: 10, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
                );
                Holtburger.print("info", String(heading));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message
                    .parse::<f64>()
                    .is_ok_and(|heading| (heading - 90.0_f64.to_radians()).abs() < 1e-6)
        ));
    }

    fn entity_exists_helper_returns_boolean() {
        let source = ScriptSource::new(
            "entity-exists-test",
            r#"
                Holtburger.print("info", JSON.stringify([
                    Holtburger.entityExists(42),
                    Holtburger.entityExists(7),
                ]));
            "#,
        );

        let mut host = super::ScriptHost::spawn(source, &TestView).expect("script host");
        let outputs = host.drain_outputs();

        assert!(matches!(
            outputs.as_slice(),
            [ScriptIntent::Print { message, .. }]
                if message == "[true,false]"
        ));
    }

    fn current_trade_info_helper_returns_js_object() {
        let source = ScriptSource::new(
            "current-trade-info-test",
            r#"
                const trade = Holtburger.currentTradeInfo();
                Holtburger.print(
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
            [ScriptIntent::Print { message, .. }]
                if message == "[7,\"Buddy\",[11],[21,22]]"
        ));
    }
}
