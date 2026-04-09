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
static V8_PLATFORM_INIT: Once = Once::new();

#[repr(C)]
#[derive(Clone, Copy)]
struct ScriptClientViewPtr {
    data: *const (),
    vtable: *const (),
}

impl ScriptClientViewPtr {
    fn from_ref(view: &dyn ScriptClientView) -> Self {
        // SAFETY: `ScriptClientViewPtr` is a private `#[repr(C)]` mirror of Rust's
        // current trait-object fat pointer layout: data pointer + vtable pointer.
        // We only create this from a live borrowed reference and keep it installed in
        // `HostRuntimeState.current_context` for the duration of a single host call.
        let (data, vtable): (*const (), *const ()) = unsafe { std::mem::transmute(view) };
        Self { data, vtable }
    }

    // SAFETY: The caller must guarantee the original borrowed `ScriptClientView`
    // is still alive and that this pointer pair was produced by `from_ref`.
    unsafe fn as_ref<'a>(self) -> &'a dyn ScriptClientView {
        // SAFETY: See the function contract above. We only reconstruct the trait
        // object while `with_active_script_context` has installed a borrow-scoped
        // context, and `ActiveScriptContextGuard` restores the previous pointer on
        // every exit path.
        unsafe { std::mem::transmute((self.data, self.vtable)) }
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

fn install_script_context(
    op_state: Rc<RefCell<OpState>>,
    context: &dyn ScriptClientView,
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
    f: impl FnOnce(&dyn ScriptClientView) -> T,
) -> Option<T> {
    let context_ptr = state.borrow::<HostRuntimeState>().current_context.get()?;
    // SAFETY: `current_context` is only populated by `install_script_context`, which
    // stores a pointer derived from a live borrowed `ScriptClientView` for the span
    // of a single script host call. `ActiveScriptContextGuard` clears or restores it
    // before that borrow ends.
    let context = unsafe { context_ptr.as_ref() };
    Some(f(context))
}

#[op2]
#[serde]
fn op_hb_self_entity(state: &mut OpState) -> Option<ScriptSelfView> {
    with_current_script_client_view(state, |view| view.self_entity()).flatten()
}

#[op2]
#[serde]
fn op_hb_nearby_entities(state: &mut OpState) -> Vec<ScriptEntityView> {
    with_current_script_client_view(state, |view| view.nearby_entities()).unwrap_or_default()
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

fn run_js_script(js_runtime: &mut JsRuntime, name: &'static str, source: String) -> Result<()> {
    js_runtime
        .execute_script(name, source)
        .with_context(|| format!("failed to execute script {name}"))?;
    block_on(js_runtime.run_event_loop(Default::default()))
        .with_context(|| format!("failed to drive script event loop for {name}"))?;
    Ok(())
}

pub struct ScriptHost {
    js_runtime: JsRuntime,
    outputs: Rc<RefCell<Vec<ScriptIntent>>>,
}

impl ScriptHost {
    pub fn spawn(source: ScriptSource, context: &dyn ScriptClientView) -> Result<Self> {
        ensure_v8_platform_initialized();

        let outputs = Rc::new(RefCell::new(Vec::new()));
        let mut js_runtime = create_js_runtime(outputs.clone());
        let script_name: &'static str = Box::leak(source.name.into_boxed_str());

        with_active_script_context(&mut js_runtime, context, |js_runtime| {
            run_js_script(js_runtime, BOOTSTRAP_SCRIPT_NAME, BOOTSTRAP_JS.to_string())?;
            run_js_script(js_runtime, script_name, source.source)
        })?;

        Ok(Self {
            js_runtime,
            outputs,
        })
    }

    pub fn dispatch_event(
        &mut self,
        context: &dyn ScriptClientView,
        event: ScriptEvent,
    ) -> Result<()> {
        let event_json =
            deno_core::serde_json::to_string(&event).context("failed to serialize script event")?;
        let dispatch_source = format!("globalThis.__holtburgerDispatch({event_json});");

        with_active_script_context(&mut self.js_runtime, context, |js_runtime| {
            run_js_script(js_runtime, EVENT_SCRIPT_NAME, dispatch_source)
        })
    }

    pub fn drain_outputs(&mut self) -> Vec<ScriptIntent> {
        std::mem::take(&mut *self.outputs.borrow_mut())
    }

    pub fn shutdown(self) {}
}

fn with_active_script_context<T>(
    js_runtime: &mut JsRuntime,
    context: &dyn ScriptClientView,
    f: impl FnOnce(&mut JsRuntime) -> Result<T>,
) -> Result<T> {
    let op_state = js_runtime.op_state();
    let _guard = install_script_context(op_state, context);
    f(js_runtime)
}
