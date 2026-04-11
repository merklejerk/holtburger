use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Once;

use anyhow::{Context, Result};
use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use futures::executor::block_on;
use holtburger_common::Guid;

use crate::{
    ScriptClientIntent, ScriptClientView, ScriptEntityView, ScriptEvent, ScriptIntent,
    ScriptLogLevel, ScriptSelfView, ScriptSource,
};

const BOOTSTRAP_SCRIPT_NAME: &str = "<holtburger-bootstrap>";
const EVENT_SCRIPT_NAME: &str = "<holtburger-event>";
const USER_SCRIPT_NAME: &str = "<holtburger-user-script>";
static V8_PLATFORM_INIT: Once = Once::new();

#[derive(Clone, Copy)]
struct ScriptClientViewPtr {
    data: *const (),
    self_entity: unsafe fn(*const ()) -> Option<ScriptSelfView>,
    nearby_entities: unsafe fn(*const ()) -> Vec<ScriptEntityView>,
}

impl ScriptClientViewPtr {
    fn from_ref<T: ScriptClientView>(view: &T) -> Self {
        unsafe fn self_entity<T: ScriptClientView>(data: *const ()) -> Option<ScriptSelfView> {
            unsafe { (&*data.cast::<T>()).self_entity() }
        }

        unsafe fn nearby_entities<T: ScriptClientView>(data: *const ()) -> Vec<ScriptEntityView> {
            unsafe { (&*data.cast::<T>()).nearby_entities() }
        }

        Self {
            data: (view as *const T).cast(),
            self_entity: self_entity::<T>,
            nearby_entities: nearby_entities::<T>,
        }
    }

    unsafe fn self_entity(self) -> Option<ScriptSelfView> {
        unsafe { (self.self_entity)(self.data) }
    }

    unsafe fn nearby_entities(self) -> Vec<ScriptEntityView> {
        unsafe { (self.nearby_entities)(self.data) }
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
  nearbyEntities() {
    return Deno.core.ops.op_hb_nearby_entities();
  },
  log(level, message) {
    Deno.core.ops.op_hb_log(String(level), String(message));
  },
  say(message) {
    Deno.core.ops.op_hb_say(String(message));
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
        op_hb_log,
        op_hb_say,
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
fn op_hb_nearby_entities(state: &mut OpState) -> Vec<ScriptEntityView> {
    with_current_script_client_view(state, |view| unsafe { view.nearby_entities() })
        .unwrap_or_default()
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
    use crate::{ScriptChatChannelKind, ScriptChatEvent, ScriptEvent};

    #[test]
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
}
