# CEF Native Popups Fail in Tauri's Linux Child-Window Embedding

Investigation handoff. The popup trigger has been isolated by an A/B test against the exact pinned
Tauri and CEF versions. The internal Chromium mechanism that fails remains unknown. DevTools is
tracked here because it is another native-window defect, but it has not been proven to share the
popup root cause.

## The Defects

Three symptoms occur in `apps/holtburger-3d` when it runs on the CEF runtime. Rendering, WebGL2,
IPC, keyboard input, ordinary pointer input, and focus otherwise work.

1. **`<select>` dropdowns do not render.** Keyboard selection still works.
2. **Context menus do not appear for physical right-clicks.** The DOM event and CEF callback both
   occur, but no menu becomes visible.
3. **Opening embedded DevTools kills the GPU process:**

   ```text
   ERROR:ui/gl/egl_util.cc:92] EGL Driver message (Error) eglSwapBuffers: Failed to retrieve the size of the parent window.
   ERROR:components/viz/service/gl/exit_code.cc:13] Restarting GPU process due to unrecoverable error. Context was lost.
   ERROR:content/browser/gpu/gpu_process_host.cc:1089] GPU process exited unexpectedly: exit_code=8704
   ```

## Why We Are On CEF

The app previously ran on wry/WebKitGTK. The outdoor reference scene was CPU-bound in JavaScript,
and replacing JSC with V8 improved the same-vantage result by **2.35x**, from roughly 200 fps to
nearly 500 fps. See `holtburger-3d-object-draw-state-reduction-plan.md` for those measurements.

The performance case for CEF is unaffected by this investigation. The remaining question is how to
embed it without breaking native child widgets.

## Environment

- Arch Linux, kernel 7.1.8-arch1-3
- GNOME Shell 50.4 on Wayland; the app runs through XWayland because the runtime forces both
  `--ozone-platform=x11` and winit's X11 event loop
- Mesa 26.1.8, AMD RX 7900 XT (RADV NAVI31)
- CEF 150.0.10 and cef-rs 150.0.0
- Tauri pinned at `f5bf953fe2a259f2d176491f50ec2930fb73e03d`
- rustc 1.95.0
- GNOME Mutter fractional-scaling features disabled; GNOME text scaling is `0.9`
- CEF reports `devicePixelRatio = 0.90625`, close to the configured text scale; the relationship
  was not independently proven

Forcing `--force-device-scale-factor=1` made CEF report the expected primary-monitor dimensions and
`devicePixelRatio = 1`, but did not restore either popup. Scaling is therefore observable but not
causal for this defect.

Source for the pinned Tauri revision lives at
`~/.cargo/git/checkouts/tauri-69fbbe4d0942e697/f5bf953/`. File and line references below are under
`crates/tauri-runtime-cef/src/` in that checkout. CEF's linked-version headers are in
`.cef-cache/150.0.10/cef_linux_x86_64/include/`.

## Proven Failure Boundary

The trigger is Tauri's Linux child-window embedding:

```text
winit-owned X11 window
└── CEF browser created with set_as_child(parent_xid, bounds)
    └── physical-input native popups fail after the CEF context-menu callback
```

The exact failure inside Chromium's native widget path is not yet known. A failed X11 grab, invalid
root coordinates, or another child-host assumption remain possible mechanisms. They are no longer
needed to establish which integration choice triggers the defect.

### Exact Tauri A/B

Both runs used Holtburger's framework-free popup probe, pinned Tauri commit, CEF 150.0.10, runtime
settings, X11 backend, and external message pump. The only behavioral difference was the
`CefWindowInfo` construction in `webview.rs`.

**A — current child embedding, broken:**

```rust
let mut window_info = cef::WindowInfo::default().set_as_child(parent, &bounds);
```

- Physical `<select>` click: no dropdown
- Physical right-click: no context menu

**B — CEF-owned top-level window, working:**

```rust
let mut window_info = cef::WindowInfo::default();
```

- Physical `<select>` click: dropdown renders and operates normally
- Physical right-click: context menu renders and operates normally

B also leaves the winit-owned Tauri window visible as a black shell because its CEF child was
intentionally removed. The working page appears in a second window titled
`Holtburger 3D Popup Probe - Chromium`. This makes B a causal control, not a usable workaround.

### Input and callback trace

In the broken child-embedded run, a physical right-click produces:

```text
pointerdown target=P button=2 prevented=false
mousedown target=P button=2 prevented=false
contextmenu target=P button=2 prevented=false
CEF_CONTEXT_MENU_CALLBACK
```

The callback marker was captured by breaking on cef-rs's generated
`impl_cef_context_menu_handler_t::on_before_context_menu` binding. This proves that neither the
frontend nor Tauri's registration of the CEF context-menu handler drops the request.

A CDP-injected right-click in the same broken child-embedded run reaches the same DOM and CEF
callback boundaries **and displays a native context menu**. CEF can therefore construct and show a
menu in this process. The physical-input/native-child interaction is the distinguishing path.

The earlier `<select>` focus trace remains useful supporting evidence:

```text
pointerdown target=SELECT button=0 prevented=false
mousedown  target=SELECT button=0 prevented=false
select blur  value=alpha
select focus value=alpha
click      target=SELECT button=0 prevented=false
```

The blur/focus sequence is consistent with a popup that is immediately cancelled, but it does not
by itself prove that an X11 grab failed.

## Exact cef-rs Controls

The `tauri-apps/cef-rs` sample was built from commit
`c73f792f245d71ac1716448cdb7c165c8009e20c`, the 150.0.10 release, and loaded the same popup probe.

The sample contains an inverted switch at that revision:

```rust
// The comment says --use-native disables Views, but the condition does the opposite.
let use_views = command_line.has_switch(Some(&CefString::from("use-native"))) != 0;
```

Consequently, the runs were identified by the branch actually executed rather than the flag name:

| Control                  | Actual browser path               | Pump                              | Result                         |
| ------------------------ | --------------------------------- | --------------------------------- | ------------------------------ |
| No flag                  | Native CEF-owned top-level window | `run_message_loop()`              | Dropdown and context menu work |
| `--use-native`           | CEF Views top-level window        | `run_message_loop()`              | Dropdown and context menu work |
| No flag, modified sample | Native CEF-owned top-level window | External pump with GLib servicing | Dropdown and context menu work |

The first attempted external-pump harness called only `do_message_loop_work()` and froze because it
did not service a host platform loop. That invalid result was discarded. The valid control serviced
GLib's default `MainContext` and polled CEF work every millisecond.

These controls rule out CEF 150's general native-popup implementation, Views, this machine's Linux
graphics stack, and external-pump mode by itself. The exact Tauri A/B additionally preserves
Tauri's own pump and isolates the child-window topology.

## Already Ruled Out

Do not repeat these without a materially different question.

| Hypothesis                                                   | Verdict | Evidence                                                                                           |
| ------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| Frontend code suppresses popup events                        | **No**  | A framework-free, WebGL-free probe reproduces the defect and reports no `defaultPrevented` events. |
| Explorer camera input eats right-click                       | **No**  | The framework-free probe reproduces it; the physical event also reaches CEF's callback.            |
| Tauri failed to install or call its CEF context-menu handler | **No**  | GDB records `OnBeforeContextMenu` for both physical and CDP right-clicks.                          |
| CEF cannot construct a native menu in this process           | **No**  | CDP injection displays one in the broken child-embedded run.                                       |
| CEF runtime style                                            | **No**  | Default, `RuntimeStyle::Chrome`, and `RuntimeStyle::Alloy` behave identically.                     |
| GNOME text scaling / CEF DPR                                 | **No**  | Forcing DPR 1 changes the reported geometry but fixes neither popup.                               |
| XWayland, GNOME, Mesa, GPU, or CEF 150 generally             | **No**  | Exact CEF 150 native and Views top-level controls work on the same machine and session.            |
| External message-pump mode itself                            | **No**  | The valid cef-rs native top-level external-pump control works.                                     |
| Tauri's exact external-pump implementation                   | **No**  | The working B run preserves Tauri's runtime and pump; only child parenting changes.                |
| A stale or arbitrary Tauri pin                               | **No**  | The pin matched the `feat/cef` tip when checked, and the A/B uses the exact pinned revision.       |
| Tauri core refocuses the window                              | **No**  | `crates/tauri/src/app.rs` only maps the runtime focus event to Tauri's public event.               |

## Relevant Runtime Code

All paths are under `crates/tauri-runtime-cef/src/`.

- **Child embedding:** `webview.rs:417` calls
  `WindowInfo::default().set_as_child(parent, &bounds)`. This is the proven trigger.
- **X11 selection:** `runtime.rs:1421` appends `("ozone-platform", "x11")` and configures winit's
  X11 event loop. App-provided command-line arguments are added earlier, so they cannot override the
  runtime's final Ozone choice.
- **External pump:** `runtime.rs:1478` enables `external_message_pump`; `service_glib` around
  `runtime.rs:898` services GLib's default `MainContext` from the winit loop. The pump is not the
  popup trigger.
- **GTK use:** GTK itself is not initialized; the runtime uses `gtk::glib` for pump integration.
- **DevTools:** `webview.rs:768` calls
  `child.host.show_dev_tools(None, None, None, None)`. Passing no `CefWindowInfo` is permitted by the
  CEF API, so this call alone does not prove the DevTools root cause. The GPU error still points to
  invalid native-window geometry or parenting and warrants a separate A/B.

## Retracted Leads and Corrections

- The claim that fractional scaling was absent was not measured. Mutter fractional scaling is
  disabled, but GNOME text scaling is `0.9`.
- The cef-rs sample's source comment and `--use-native` flag behavior are inverted. Earlier branch
  descriptions based on the comment were wrong.
- The `<select>` blur/focus trace does not prove that an X11 grab failed.
- GNU `xtrace` on this machine is a function-call tracer, not the X11 protocol tracer expected by
  the original plan. A synthetic XTest click was also invalidated by XWayland coordinate
  translation and was abandoned.
- A missing `CefWindowInfo` argument to `show_dev_tools` is API-supported and is not independently a
  smoking gun.

## Next Work

### 1. Produce the upstream popup reproducer

Create a minimal Tauri CEF example with one `<select>` and an ordinary context-menu target. Include
the one-line child-versus-top-level A/B and the physical-versus-CDP callback evidence.

Acceptance criteria:

- The report identifies the exact Tauri and CEF revisions.
- A reviewer can reproduce A broken and B working without Holtburger assets.
- The report distinguishes the proven trigger from unproven grab/coordinate mechanisms.

### 2. Determine the failing native-widget mechanism

Trace Chromium/X11 popup creation after `OnBeforeContextMenu`, preferably with Chromium logging, an
actual X11 protocol tracer, or a narrowly instrumented CEF build. Do not use desktop-wide pointer
injection; XWayland's transformed multi-monitor coordinates made that unsafe and non-diagnostic.

Acceptance criteria:

- The failing operation and return/error state are captured for physical input under child
  embedding.
- The same operation is compared with CDP input or the working top-level control.

### 3. Evaluate an integration fix

The desired fix must retain one normal Tauri window. Simply adopting the B control would leave a
black host shell and split window ownership, focus, sizing, lifecycle, and input policy.

Candidate directions to evaluate upstream:

- Correct the X11 child-host information or coordinate conversion supplied to CEF.
- Identify and satisfy Chromium's native-widget ownership/grab assumptions for foreign parents.
- Use a CEF-supported embedding architecture that preserves GPU-accelerated windowed rendering.
- Consider app-rendered menus and selects only as a scoped interim workaround, not as proof that
  native embedding is healthy.

### 4. Investigate DevTools independently

Run a separate DevTools A/B under child and CEF-owned top-level window configurations. Do not assume
the popup result proves the DevTools cause.

Acceptance criteria:

- Capture whether the GPU process survives in the top-level B configuration.
- If it still fails, vary the optional `CefWindowInfo` passed to `show_dev_tools` and record the
  resulting native window geometry.

### 5. Cleanup after resolution

Once an upstream fix or intentional local workaround lands, remove the popup probe registration and
its package scripts unless they remain a justified regression harness.

## Workaround Available Now

**DevTools via remote debugging:** `Builder::<Cef>::command_line_args` accepts
`("remote-debugging-port", Some("9222"))`. Opening `http://localhost:9222` in another browser gives
DevTools access without creating CEF's embedded DevTools window. Gate this behind
`#[cfg(debug_assertions)]`; an exposed debugging port grants control of the browser.

No production-quality workaround is known for native dropdowns and physical context menus. The
top-level B control is not acceptable because it leaves the Tauri shell black and creates a second,
independently owned browser window.

## Reproduction Assets

- `apps/holtburger-3d/popup-probe/` is a framework-free probe with an instrumented event log,
  registered in `vite.config.ts` and `scripts/entry-paths.mjs`.
- Run it with `npm run --prefix apps/holtburger-3d dev:popup-probe`.
- The exact Tauri A/B changes only `webview.rs` as shown above. Use an isolated checkout or Cargo
  patch; do not modify the shared Cargo git checkout.

## Upstream

- **#15764** `[bug] [cef] IPC broken when opening DevTools on Linux` remains relevant to the
  DevTools symptom. Its reporter used X11/Cinnamon, so that defect is not Wayland-specific.
- **#15868** requests exposure of `windowless_rendering_enabled`.
- No existing issue was found for Tauri CEF's Linux child-embedded native popup failure. The report
  should be framed around the proven one-line A/B.

## Open Decisions

- File the minimal popup reproducer upstream.
- Take the debug-only remote DevTools workaround or wait for an upstream fix.
- Decide whether app-rendered dropdowns/context menus are an acceptable interim measure or whether
  the client should temporarily return to wry. The CEF performance advantage remains substantial,
  but a second top-level browser window is not a viable product architecture.
