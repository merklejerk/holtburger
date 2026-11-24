//! Dedicated-OS-thread V8 `ScriptHost` bound directly to `LiveApiEngine` via 3 generic ops.

use std::collections::HashSet;
use std::io::Read;
use std::sync::{Arc, Mutex, Once, OnceLock, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use holtburger_live_api::LiveApiEngine;
use holtburger_live_api::types::{ApiCommand, ApiEventTopic, ApiQuery, WaitPolicy};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    ScriptFetchPolicy, ScriptHostConfig, ScriptPostError, ScriptPostErrorCode, ScriptPostRequest,
    ScriptPostResponse, ScriptSource, ScriptStorage,
};

const BOOTSTRAP_SCRIPT_NAME: &str = "<holtburger-bootstrap>";
const USER_SCRIPT_NAME: &str = "<holtburger-user-script>";
const EVENT_SCRIPT_NAME: &str = "<holtburger-event>";
const FETCH_COMPLETION_SCRIPT_NAME: &str = "<holtburger-fetch-completion>";
const SCRIPT_FETCH_ORIGIN: &str = "https://holtburger.invalid";
const SCRIPT_FETCH_USER_AGENT: &str =
    concat!("Holtburger/", env!("CARGO_PKG_VERSION"), " ScriptFetch");
const SCRIPT_FETCH_WORKER_COUNT: usize = 2;
static V8_PLATFORM_INIT: Once = Once::new();
static FETCH_WORKER_POOL: OnceLock<FetchWorkerPool> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptFetchOpOutcome {
    response: Option<ScriptPostResponse>,
    error: Option<ScriptPostError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptFetchStartOutcome {
    request_id: Option<u64>,
    error: Option<ScriptPostError>,
}

struct PreparedFetchRequest {
    request: ScriptPostRequest,
    url: reqwest::Url,
    timeout: Duration,
    max_response_bytes: usize,
}

struct PendingFetchRequest {
    request_id: u64,
    prepared: PreparedFetchRequest,
    completion_tx: mpsc::Sender<CompletedFetchRequest>,
}

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
        let shared_rx = Arc::new(Mutex::new(job_rx));
        for worker_index in 0..SCRIPT_FETCH_WORKER_COUNT {
            let worker_rx = shared_rx.clone();
            thread::Builder::new()
                .name(format!("script-fetch-worker-{worker_index}"))
                .spawn(move || {
                    loop {
                        let job = {
                            let guard = worker_rx.lock().expect("fetch worker mutex poisoned");
                            guard.recv()
                        };
                        let Ok(job) = job else { break };
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

    fn submit(&self, req: PendingFetchRequest) -> Result<(), Box<PendingFetchRequest>> {
        self.job_tx.send(req).map_err(|e| Box::new(e.0))
    }
}

fn fetch_worker_pool() -> &'static FetchWorkerPool {
    FETCH_WORKER_POOL.get_or_init(FetchWorkerPool::new)
}

struct ScriptOpContext {
    engine: LiveApiEngine,
    rt: tokio::runtime::Handle,
    storage: ScriptStorage,
    fetch_policy: ScriptFetchPolicy,
    fetch_completion_tx: mpsc::Sender<CompletedFetchRequest>,
    next_fetch_id: u64,
}

/// Generic Live API query op: parses `ApiQuery` JSON and returns serialized JSON result.
#[op2]
#[string]
fn op_api_query(state: &mut OpState, #[string] query_json: String) -> String {
    let ctx = state.borrow::<ScriptOpContext>();
    let query: ApiQuery = match serde_json::from_str(&query_json) {
        Ok(q) => q,
        Err(error) => {
            return json!({ "error": { "code": "invalid_request", "message": error.to_string() } })
                .to_string();
        }
    };
    let engine = ctx.engine.clone();
    let rt = ctx.rt.clone();
    match rt.block_on(engine.query(query)) {
        Ok(value) => json!({ "ok": value }).to_string(),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

/// Generic Live API command op: parses `ApiCommand` + optional `WaitPolicy` JSON.
#[op2]
#[string]
fn op_api_command(
    state: &mut OpState,
    #[string] command_json: String,
    #[string] wait_json: String,
) -> String {
    let ctx = state.borrow::<ScriptOpContext>();
    let command: ApiCommand = match serde_json::from_str(&command_json) {
        Ok(c) => c,
        Err(error) => {
            return json!({ "error": { "code": "invalid_request", "message": error.to_string() } })
                .to_string();
        }
    };
    let wait: WaitPolicy = if wait_json.trim().is_empty() || wait_json == "null" {
        WaitPolicy::default()
    } else {
        match serde_json::from_str(&wait_json) {
            Ok(w) => w,
            Err(error) => {
                return json!({ "error": { "code": "invalid_request", "message": error.to_string() } })
                    .to_string();
            }
        }
    };
    let engine = ctx.engine.clone();
    let rt = ctx.rt.clone();
    match rt.block_on(engine.execute(command, wait)) {
        Ok(resp) => json!({ "ok": resp }).to_string(),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

/// Generic Live API semantic event poll op reading from the `EventLog` ring buffer.
#[op2]
#[string]
fn op_api_poll_events(
    state: &mut OpState,
    #[bigint] since: u64,
    #[string] topics_json: String,
    limit: u32,
) -> String {
    let ctx = state.borrow::<ScriptOpContext>();
    let topics: Option<HashSet<ApiEventTopic>> = if topics_json.trim().is_empty()
        || topics_json == "null"
    {
        None
    } else {
        let names: Vec<String> = match serde_json::from_str(&topics_json) {
            Ok(names) => names,
            Err(error) => {
                return json!({ "error": { "code": "invalid_request", "message": format!("invalid topics list: {error}") } })
                    .to_string();
            }
        };
        let mut parsed = HashSet::with_capacity(names.len());
        for name in &names {
            let Some(topic) = ApiEventTopic::parse_name(name) else {
                return json!({ "error": { "code": "invalid_request", "message": format!("unknown event topic `{name}`") } })
                    .to_string();
            };
            parsed.insert(topic);
        }
        Some(parsed)
    };
    let page = ctx
        .engine
        .event_log()
        .read_since(since, topics.as_ref(), limit.clamp(1, 500) as usize);
    json!({ "ok": page }).to_string()
}

#[op2]
#[string]
fn op_load_config(state: &mut OpState) -> Option<String> {
    let ctx = state.borrow::<ScriptOpContext>();
    ctx.storage
        .load_config()
        .and_then(|v| serde_json::to_string(&v).ok())
}

#[op2(fast)]
fn op_write_config(state: &mut OpState, #[string] contents: String) -> bool {
    let ctx = state.borrow::<ScriptOpContext>();
    ctx.storage.write_config(&contents)
}

#[op2]
#[string]
fn op_load_data(state: &mut OpState) -> Option<String> {
    let ctx = state.borrow::<ScriptOpContext>();
    ctx.storage
        .load_data()
        .and_then(|v| serde_json::to_string(&v).ok())
}

#[op2]
#[serde]
fn op_load_data_bin(state: &mut OpState) -> Option<Vec<u8>> {
    let ctx = state.borrow::<ScriptOpContext>();
    ctx.storage.load_data_bin()
}

#[op2(fast)]
fn op_debug_log(#[string] message: String) {
    log::info!("[script] {message}");
}

#[op2]
#[string]
fn op_start_post_json(state: &mut OpState, #[string] request_json: String) -> String {
    let ctx = state.borrow_mut::<ScriptOpContext>();
    let request: ScriptPostRequest = match serde_json::from_str(&request_json) {
        Ok(r) => r,
        Err(error) => {
            return serde_json::to_string(&ScriptFetchStartOutcome {
                request_id: None,
                error: Some(ScriptPostError {
                    code: ScriptPostErrorCode::InvalidRequest,
                    message: error.to_string(),
                }),
            })
            .unwrap_or_default();
        }
    };
    let prepared = match prepare_post_request(request, &ctx.fetch_policy) {
        Ok(p) => p,
        Err(error) => {
            return serde_json::to_string(&ScriptFetchStartOutcome {
                request_id: None,
                error: Some(error),
            })
            .unwrap_or_default();
        }
    };
    ctx.next_fetch_id = ctx.next_fetch_id.saturating_add(1);
    let request_id = ctx.next_fetch_id;
    let pending = PendingFetchRequest {
        request_id,
        prepared,
        completion_tx: ctx.fetch_completion_tx.clone(),
    };
    if fetch_worker_pool().submit(pending).is_err() {
        return serde_json::to_string(&ScriptFetchStartOutcome {
            request_id: None,
            error: Some(ScriptPostError {
                code: ScriptPostErrorCode::Transport,
                message: "script fetch worker pool unavailable".into(),
            }),
        })
        .unwrap_or_default();
    }
    serde_json::to_string(&ScriptFetchStartOutcome {
        request_id: Some(request_id),
        error: None,
    })
    .unwrap_or_default()
}

deno_core::extension!(
    holtburger_live_scripting,
    ops = [
        op_api_query,
        op_api_command,
        op_api_poll_events,
        op_load_config,
        op_write_config,
        op_load_data,
        op_load_data_bin,
        op_debug_log,
        op_start_post_json,
    ],
);

const BOOTSTRAP_JS: &str = r#"
(() => {
  const ops = Deno.core.ops;
  const listeners = [];
  const pendingFetches = new Map();

  function unwrap(raw) {
    const parsed = JSON.parse(raw);
    if (parsed.error) {
      const err = new Error(parsed.error.message || "Live API error");
      err.code = parsed.error.code;
      throw err;
    }
    return parsed.ok;
  }

  function query(q) {
    return unwrap(ops.op_api_query(JSON.stringify(q)));
  }

  function command(cmd, wait) {
    return unwrap(ops.op_api_command(JSON.stringify(cmd), wait ? JSON.stringify(wait) : "null"));
  }

  function pollEvents(since, topics, limit) {
    return unwrap(
      ops.op_api_poll_events(
        BigInt(since ?? 0),
        topics ? JSON.stringify(topics) : "null",
        limit ?? 200,
      ),
    );
  }

  function resolvePos(ref) {
    if (ref == null) return null;
    if (typeof ref === "number") {
      const ent = query({ kind: "entity-detail", guid: ref, includeProperties: false });
      return ent?.summary?.position ?? null;
    }
    if (typeof ref === "object" && ref.position) return ref.position;
    if (typeof ref === "object" && ref.coords) return ref;
    return null;
  }

  function worldPoint(pos) {
    const lb = pos.landblock_id ?? pos.landblockId ?? 0;
    const bx = (lb >>> 24) & 0xff;
    const by = (lb >>> 16) & 0xff;
    return {
      x: bx * 192 + (pos.coords?.x ?? 0),
      y: by * 192 + (pos.coords?.y ?? 0),
      z: pos.coords?.z ?? 0,
    };
  }

  function distance(from, to) {
    const a = resolvePos(from);
    const b = resolvePos(to);
    if (!a || !b) return Infinity;
    const pa = worldPoint(a);
    const pb = worldPoint(b);
    return Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
  }

  function headingTo(from, to) {
    const a = resolvePos(from);
    const b = resolvePos(to);
    if (!a || !b) return 0;
    const pa = worldPoint(a);
    const pb = worldPoint(b);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    if (dx * dx + dy * dy < 1e-6) return 0;
    // Match holtburger-common Vector3::heading_to: radians with 0 = West, pi/2 = North, pi = East, 3pi/2 = South.
    const mathRad = Math.atan2(-dx, dy);
    let deg = (450 - (mathRad * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return (deg * Math.PI) / 180;
  }

  globalThis.__hbDispatchEvent = (event) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  globalThis.__hbCompleteFetch = (requestId, outcome) => {
    const pending = pendingFetches.get(requestId);
    if (!pending) return;
    pendingFetches.delete(requestId);
    if (outcome.error) {
      const err = new Error(outcome.error.message || "postJson failed");
      err.code = outcome.error.code;
      pending.reject(err);
    } else {
      pending.resolve(outcome.response);
    }
  };

  const api = {
    onEvent(handler) {
      if (typeof handler === "function") listeners.push(handler);
    },
    query,
    command,
    pollEvents,

    // --- Live API Reads ---
    info: () => query({ kind: "info" }),
    characters: () => query({ kind: "characters" }),
    self: () => query({ kind: "self-state" }),
    sheet: () => query({ kind: "character-sheet" }),
    enchantments: () => query({ kind: "enchantments" }),
    spellbook: () => query({ kind: "spellbook" }),
    recalls: () => query({ kind: "recalls" }),
    deathLocations: () => query({ kind: "death-locations" }),
    entities: (filter) => query({ kind: "entities", filter: filter ?? {} }),
    entity: (guid, includeProperties = false) => {
      try {
        return query({ kind: "entity-detail", guid, includeProperties });
      } catch (e) {
        if (e && e.code === "not_found") return null;
        throw e;
      }
    },
    inventory: () => query({ kind: "inventory" }),
    equipment: () => query({ kind: "equipment" }),
    combat: () => query({ kind: "combat" }),
    trade: () => query({ kind: "trade" }),
    vendor: () => query({ kind: "vendor" }),
    social: () => query({ kind: "social" }),
    selection: () => query({ kind: "selection" }).guid ?? null,
    spells: (search, school) => query({ kind: "content-spells", search: search ?? null, school: school ?? null }),
    spell: (id) => query({ kind: "content-spell", id }),
    skills: () => query({ kind: "content-skills" }),

    // --- Live API Commands ---
    setCombatMode: (mode) => command({ kind: "set-combat-mode", mode }),
    beginCombat: (target, profile) => command({ kind: "begin-combat", target, profile }),
    updateCombatProfile: (profile) => command({ kind: "update-combat-profile", profile }),
    stopCombat: () => command({ kind: "stop-combat" }),
    castSpell: (spellId, targetGuid) =>
      command({
        kind: "cast-spell",
        spellId,
        aim: targetGuid == null ? { kind: "untargeted" } : { kind: "target", target: targetGuid },
      }),
    useEntity: (guid, unrestricted = false) => command({ kind: "use-entity", guid, unrestricted }),
    useItem: (source, target = null) => command({ kind: "use-item", source, target }),
    salvage: (items, tool = null) => command({ kind: "salvage", tool, items }),
    requestAppraisal: (guid, factsOnly = false) =>
      command({ kind: "request-appraisal", guid, factsOnly }),
    queryHealth: (guid) => command({ kind: "query-health", guid }),
    inventoryIntent: (intent) => command({ kind: "inventory", ...intent }),
    tradeAction: (action) => command({ kind: "trade", action }),
    vendorTrade: (trade) => command({ kind: "vendor-trade", ...trade }),
    respondConfirmation: (requestId, accepted) =>
      command({ kind: "respond-confirmation", requestId, accepted }),
    chat: (action) => command({ kind: "chat", action }),
    say: (message) => command({ kind: "chat", action: { kind: "say", message } }),
    emote: (message) => command({ kind: "chat", action: { kind: "emote", message } }),
    soulEmote: (token) => command({ kind: "chat", action: { kind: "soul-emote", token } }),
    steer: (goal, opts = {}) =>
      command({
        kind: "steer",
        goal,
        ...(opts.stuckTimeoutMs != null ? { stuckTimeoutMs: opts.stuckTimeoutMs } : {}),
        ...(opts.maxDurationMs != null ? { maxDurationMs: opts.maxDurationMs } : {}),
      }),
    moveTo: (destination, opts = {}) =>
      api.steer(
        {
          kind: "move-to",
          destination,
          ...(opts.arrivalDistance != null ? { arrivalDistance: opts.arrivalDistance } : {}),
          ...(opts.gait != null ? { gait: opts.gait } : {}),
          ...(opts.finalHeading != null ? { finalHeading: opts.finalHeading } : {}),
        },
        opts,
      ),
    approach: (target, opts = {}) =>
      api.steer(
        {
          kind: "approach",
          target,
          ...(opts.arrivalDistance != null ? { arrivalDistance: opts.arrivalDistance } : {}),
          ...(opts.gait != null ? { gait: opts.gait } : {}),
        },
        opts,
      ),
    follow: (target, opts = {}) =>
      api.steer(
        {
          kind: "follow",
          target,
          ...(opts.followDistance != null ? { followDistance: opts.followDistance } : {}),
          ...(opts.gait != null ? { gait: opts.gait } : {}),
        },
        opts,
      ),
    faceHeading: (heading) => api.steer({ kind: "face-heading", heading }),
    faceEntity: (target) => api.steer({ kind: "face-entity", target }),
    stopMovement: () => command({ kind: "stop-movement" }),
    snapFacing: (heading) => command({ kind: "snap-facing", heading }),
    setSelection: (guid) => command({ kind: "set-selection", guid }),
    print: (message, style = "info") =>
      command({ kind: "ui-print", message: String(message), style }),

    // --- Geometry & Script-Local Helpers ---
    distance,
    headingTo,
    debugLog: (message) => ops.op_debug_log(String(message)),
    loadConfig: () => {
      const raw = ops.op_load_config();
      return raw == null ? null : JSON.parse(raw);
    },
    writeConfig: (value) =>
      ops.op_write_config(typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    loadData: () => {
      const raw = ops.op_load_data();
      return raw == null ? null : JSON.parse(raw);
    },
    loadDataBin: () => {
      const bytes = ops.op_load_data_bin();
      return bytes == null ? null : new Uint8Array(bytes);
    },
    postJson: (request) =>
      new Promise((resolve, reject) => {
        const outcome = JSON.parse(ops.op_start_post_json(JSON.stringify(request)));
        if (outcome.error) {
          const err = new Error(outcome.error.message || "postJson failed");
          err.code = outcome.error.code;
          reject(err);
          return;
        }
        pendingFetches.set(outcome.requestId, { resolve, reject });
      }),
  };

  globalThis.HB = api;
  globalThis.Holtburger = api;
})();
"#;

enum WorkerMessage {
    Tick { elapsed_secs: f64 },
    Command { msg: String },
    Stop,
}

/// Handle to a running V8 script executing on its own dedicated non-Tokio OS thread.
pub struct ScriptHost {
    tx: mpsc::Sender<WorkerMessage>,
    worker: Option<JoinHandle<()>>,
    error: Arc<Mutex<Option<String>>>,
}

impl ScriptHost {
    /// Spawns a dedicated V8 OS thread bound directly to `LiveApiEngine`.
    pub fn spawn(
        source: ScriptSource,
        start_args: String,
        engine: LiveApiEngine,
        rt: tokio::runtime::Handle,
        config: ScriptHostConfig,
        storage: ScriptStorage,
    ) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<WorkerMessage>();
        let (init_tx, init_rx) = mpsc::channel::<Result<()>>();
        let error_slot = Arc::new(Mutex::new(None));
        let worker_error_slot = Arc::clone(&error_slot);

        let worker = thread::Builder::new()
            .name(format!("hb-script-{}", source.name))
            .spawn(move || {
                V8_PLATFORM_INIT.call_once(|| {
                    // Use V8's unprotected platform so isolates created on newly spawned OS threads
                    // do not fault on Intel PKU (pkey_mprotect) pages initialized on an earlier
                    // script worker thread (e.g. when reloading scripts with `/run`).
                    let platform =
                        deno_core::v8::new_unprotected_default_platform(0, false).make_shared();
                    JsRuntime::init_platform(Some(platform), false);
                });
                let (fetch_tx, fetch_rx) = mpsc::channel::<CompletedFetchRequest>();
                let mut runtime = JsRuntime::new(RuntimeOptions {
                    extensions: vec![holtburger_live_scripting::init_ops()],
                    ..Default::default()
                });
                let initial_cursor = engine.event_log().latest_seq();
                runtime.op_state().borrow_mut().put(ScriptOpContext {
                    engine: engine.clone(),
                    rt,
                    storage,
                    fetch_policy: config.fetch_policy,
                    fetch_completion_tx: fetch_tx,
                    next_fetch_id: 0,
                });

                let init_result = (|| -> Result<()> {
                    runtime
                        .execute_script(BOOTSTRAP_SCRIPT_NAME, BOOTSTRAP_JS)
                        .context("failed to initialize scripting prelude")?;
                    runtime
                        .execute_script(USER_SCRIPT_NAME, source.source)
                        .with_context(|| format!("failed to load script {}", source.name))?;
                    Ok(())
                })();

                match init_result {
                    Ok(()) => {
                        let _ = init_tx.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = init_tx.send(Err(error));
                        return;
                    }
                }

                // Dispatch `started` AFTER signaling spawn completion so the caller's thread
                // (especially on a single-threaded Tokio runtime or TUI event loop) is never
                // blocked while `started` calls `HB.query(...)` / `HB.command(...)`.
                if let Err(error) = dispatch_js_event(
                    &mut runtime,
                    &json!({ "kind": "started", "args": start_args }),
                ) {
                    record_worker_error(&worker_error_slot, error);
                }

                let mut cursor = initial_cursor;
                while let Ok(msg) = rx.recv() {
                    drain_fetch_completions(&mut runtime, &fetch_rx, &worker_error_slot);
                    match msg {
                        WorkerMessage::Tick { elapsed_secs } => {
                            let page = engine.event_log().read_since(cursor, None, 200);
                            cursor = page.next_seq;
                            for env in page.events {
                                let payload = json!({
                                    "kind": "api",
                                    "seq": env.seq,
                                    "timestampMs": env.timestamp_ms,
                                    "topic": env.topic,
                                    "event": env.event,
                                });
                                if let Err(error) = dispatch_js_event(&mut runtime, &payload) {
                                    record_worker_error(&worker_error_slot, error);
                                }
                            }
                            if let Err(error) = dispatch_js_event(
                                &mut runtime,
                                &json!({ "kind": "tick", "elapsed": elapsed_secs }),
                            ) {
                                record_worker_error(&worker_error_slot, error);
                            }
                        }
                        WorkerMessage::Command { msg } => {
                            if let Err(error) = dispatch_js_event(
                                &mut runtime,
                                &json!({ "kind": "command", "msg": msg }),
                            ) {
                                record_worker_error(&worker_error_slot, error);
                            }
                        }
                        WorkerMessage::Stop => {
                            let _ = dispatch_js_event(&mut runtime, &json!({ "kind": "stopped" }));
                            break;
                        }
                    }
                    drain_fetch_completions(&mut runtime, &fetch_rx, &worker_error_slot);
                }
            })
            .context("failed to spawn V8 script worker thread")?;

        match init_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                tx,
                worker: Some(worker),
                error: error_slot,
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(_) => {
                let _ = worker.join();
                Err(anyhow!("script worker exited during initialization"))
            }
        }
    }

    pub fn tick(&self, elapsed_secs: f64) {
        let _ = self.tx.send(WorkerMessage::Tick { elapsed_secs });
    }

    pub fn send_command(&self, msg: String) {
        let _ = self.tx.send(WorkerMessage::Command { msg });
    }

    pub fn take_last_error(&self) -> Option<String> {
        self.error.lock().expect("script error mutex poisoned").take()
    }

    pub fn stop(mut self) {
        let _ = self.tx.send(WorkerMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    /// Signals the V8 OS thread to run its `stopped` handler and exit asynchronously.
    pub fn request_stop(&self) {
        let _ = self.tx.send(WorkerMessage::Stop);
    }
}

impl Drop for ScriptHost {
    fn drop(&mut self) {
        let _ = self.tx.send(WorkerMessage::Stop);
    }
}

fn record_worker_error(slot: &Arc<Mutex<Option<String>>>, error: anyhow::Error) {
    let text = format!("{error:#}");
    log::error!("Script runtime error: {text}");
    *slot.lock().expect("script error mutex poisoned") = Some(text);
}

fn dispatch_js_event(runtime: &mut JsRuntime, payload: &Value) -> Result<()> {
    let serialized = serde_json::to_string(payload)?;
    let script = format!("globalThis.__hbDispatchEvent({serialized});");
    runtime.execute_script(EVENT_SCRIPT_NAME, script)?;
    runtime.run_event_loop_sync_microtasks();
    Ok(())
}

trait MicrotaskHelper {
    fn run_event_loop_sync_microtasks(&mut self);
}

impl MicrotaskHelper for JsRuntime {
    fn run_event_loop_sync_microtasks(&mut self) {
        let waker = std::task::Waker::noop();
        let mut cx = std::task::Context::from_waker(waker);
        let _ = self.poll_event_loop(&mut cx, Default::default());
    }
}

fn drain_fetch_completions(
    runtime: &mut JsRuntime,
    rx: &mpsc::Receiver<CompletedFetchRequest>,
    error_slot: &Arc<Mutex<Option<String>>>,
) {
    while let Ok(done) = rx.try_recv() {
        let serialized = serde_json::to_string(&done.outcome).unwrap_or_else(|_| "{}".into());
        let script = format!("globalThis.__hbCompleteFetch({}, {serialized});", done.request_id);
        if let Err(error) = runtime.execute_script(FETCH_COMPLETION_SCRIPT_NAME, script) {
            record_worker_error(error_slot, error.into());
        } else {
            runtime.run_event_loop_sync_microtasks();
        }
    }
}

fn prepare_post_request(
    request: ScriptPostRequest,
    policy: &ScriptFetchPolicy,
) -> std::result::Result<PreparedFetchRequest, ScriptPostError> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| ScriptPostError {
        code: ScriptPostErrorCode::InvalidRequest,
        message: format!("invalid URL: {error}"),
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ScriptPostError {
            code: ScriptPostErrorCode::InvalidRequest,
            message: "only http and https URLs are supported".into(),
        });
    }
    let host = url.host_str().ok_or_else(|| ScriptPostError {
        code: ScriptPostErrorCode::InvalidRequest,
        message: "URL is missing a host".into(),
    })?;
    let port = url.port_or_known_default().ok_or_else(|| ScriptPostError {
        code: ScriptPostErrorCode::InvalidRequest,
        message: "URL is missing a known port".into(),
    })?;
    if !policy.allows(host, port) {
        return Err(ScriptPostError {
            code: ScriptPostErrorCode::PolicyDenied,
            message: format!("host {host}:{port} is not in --script-fetch-allow-host"),
        });
    }
    let timeout = Duration::from_millis(policy.effective_timeout_ms(request.timeout_ms));
    Ok(PreparedFetchRequest {
        request,
        url,
        timeout,
        max_response_bytes: policy.max_response_bytes,
    })
}

fn execute_prepared_post_request(prepared: PreparedFetchRequest) -> ScriptFetchOpOutcome {
    let client = match reqwest::blocking::Client::builder()
        .timeout(prepared.timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(SCRIPT_FETCH_USER_AGENT)
        .build()
    {
        Ok(c) => c,
        Err(error) => {
            return ScriptFetchOpOutcome {
                response: None,
                error: Some(ScriptPostError {
                    code: ScriptPostErrorCode::Transport,
                    message: error.to_string(),
                }),
            };
        }
    };

    let mut req = client
        .post(prepared.url)
        .header(reqwest::header::ORIGIN, SCRIPT_FETCH_ORIGIN);
    if let Some(body) = &prepared.request.body_json {
        req = req.json(body);
    }
    let response = match req.send() {
        Ok(resp) => resp,
        Err(error) => {
            let code = if error.is_timeout() {
                ScriptPostErrorCode::Timeout
            } else {
                ScriptPostErrorCode::Transport
            };
            return ScriptFetchOpOutcome {
                response: None,
                error: Some(ScriptPostError {
                    code,
                    message: error.to_string(),
                }),
            };
        }
    };

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let mut bytes = Vec::new();
    let limit = prepared.max_response_bytes.saturating_add(1) as u64;
    if let Err(error) = response.take(limit).read_to_end(&mut bytes) {
        return ScriptFetchOpOutcome {
            response: None,
            error: Some(ScriptPostError {
                code: ScriptPostErrorCode::Transport,
                message: error.to_string(),
            }),
        };
    }
    if bytes.len() > prepared.max_response_bytes {
        return ScriptFetchOpOutcome {
            response: None,
            error: Some(ScriptPostError {
                code: ScriptPostErrorCode::ResponseTooLarge,
                message: format!(
                    "response exceeded {} byte limit",
                    prepared.max_response_bytes
                ),
            }),
        };
    }
    let body_json = if bytes.is_empty() {
        None
    } else {
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) => Some(v),
            Err(error) => {
                return ScriptFetchOpOutcome {
                    response: None,
                    error: Some(ScriptPostError {
                        code: ScriptPostErrorCode::InvalidJsonResponse,
                        message: error.to_string(),
                    }),
                };
            }
        }
    };

    ScriptFetchOpOutcome {
        response: Some(ScriptPostResponse {
            ok,
            status,
            body_json,
        }),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{ItemType, ObjectDescriptionFlag, PropertyInt};
    use holtburger_core::ClientRuntime;
    use holtburger_live_api::LiveApiEngineConfig;
    use holtburger_live_api::hooks::{ApiResult, ClientUiHook, UiPrintRequest};
    use holtburger_world::entity::Entity;

    #[derive(Default)]
    struct CaptureUi {
        prints: Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl ClientUiHook for CaptureUi {
        async fn get_selection(&self) -> ApiResult<Option<Guid>> {
            Ok(None)
        }
        async fn set_selection(&self, _guid: Option<Guid>) -> ApiResult<()> {
            Ok(())
        }
        async fn print(&self, req: UiPrintRequest) -> ApiResult<()> {
            self.prints.lock().unwrap().push(req.message);
            Ok(())
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn script_runs_on_os_thread_over_live_api_engine() {
        let mut client = ClientRuntime::synthetic_in_world("acct", Some("Coldeve".into()));
        let player_guid = Guid(0x5000_0001);
        {
            let world = client.world_mut();
            world.player.guid = player_guid;
            let mut player = Entity::new(player_guid, "ScriptBot".into(), WorldPosition::default());
            player.flags = ObjectDescriptionFlag::PLAYER;
            player
                .properties
                .ints
                .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            world.entities.insert(player);
        }
        let handle = client.create_handle();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let rt_task = tokio::spawn(client.run_synthetic(shutdown_rx));

        let ui = Arc::new(CaptureUi::default());
        let engine = LiveApiEngine::start(
            handle,
            LiveApiEngineConfig {
                client_kind: "tui",
                catalogs: None,
                ui: Some(ui.clone()),
                hud: None,
            },
        );

        let dir = tempfile::tempdir().unwrap();
        let storage = ScriptStorage {
            config_path: Some(dir.path().join("bot.json")),
            data_json_paths: vec![],
            data_bin_paths: vec![],
        };

        let host = ScriptHost::spawn(
            ScriptSource::new(
                "smoke.js",
                r#"
                HB.onEvent((ev) => {
                  if (ev.kind === "started") {
                    const me = HB.self();
                    HB.writeConfig({ seen: me.name, args: ev.args });
                    HB.print("hello " + me.name);
                  } else if (ev.kind === "tick") {
                    const cfg = HB.loadConfig();
                    HB.print("tick " + cfg.seen);
                  }
                });
                "#,
            ),
            "aggro=12".into(),
            engine,
            tokio::runtime::Handle::current(),
            ScriptHostConfig::default(),
            storage,
        )
        .unwrap();

        host.tick(0.1);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(host.take_last_error().is_none());
        host.stop();

        let prints = ui.prints.lock().unwrap().clone();
        assert_eq!(prints, vec!["hello ScriptBot", "tick ScriptBot"]);

        let _ = shutdown_tx.send(());
        let _ = rt_task.await;
    }
}
