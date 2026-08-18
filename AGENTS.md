The ultimate goal of this project is to develop a third-party client for Asheron's Call.
- We also need to reverse engineer and document the Asheron's Call protocol and file formats. Those docs should be detailed enough for others to implement their own clients or tools from scratch, but expect docs to lag code. The ultimate source of truth is the ACE Server code.
- Included in this repository are submodules for the [ACE Server](ACE/) and the [AC DAT viewer](ACViewer/), which we should use as ground truth references. For client behavior, the [retail AC client decompile](acclient-eor-source/), is the most authoritative reference, though it may be incomplete. Do not guess. If you find yourself guessing, stop and prove the answer from these references. You may modify ACE and ACViewer for diagnostics and tests, but DO NOT modify the retail client decompile.
- DO NOT RUN THE TUI CLIENT for diagnostics/testing. It is interactive so will just hang. That's for me to use. You can just write your own bespoke client in the [harness](crates/holtburger-debug-harness/) if you need live data.
- Temporary planning docs can go into the [plan folder](docs/plans/). Old plans are retained for posterity and may no longer represent the code.

## Architectural Direction

- Treat the TUI as a proving ground, not the destination architecture.
- The real target is a traditional 3D client that can replace the closed-source retail client. Judge shared APIs and abstractions against that future client, not just today's TUI.
- Do not let the TUI's lower-fidelity needs push shared crates toward narrow models that will block richer rendering, motion, visibility, animation, or interaction later.
- Shared crates should contain behavior, data, and APIs that are plausibly common to both the TUI and a future 3D client. Frontend-specific UX or control policy should stay in the frontend.
- Don't sacrifice cleaner design for backwards compatibility, especially for tests.

## Retail Behavior Markers

Where we knowingly match or depart from retail behavior, mark it so the compatibility surface can be
enumerated with `grep -rn "RETAIL QUIRK\|RETAIL DIVERGENCE" apps crates`:

- `RETAIL QUIRK:` — a retail defect reproduced on purpose, because content was tuned against it.
- `RETAIL DIVERGENCE:` — a deliberate departure, because the defect is provable and content cannot
  observe the difference.

Both need an `acclient.c:` citation, the consequence of "correcting" it, and the census that sized
the blast radius. See `apps/holtburger-3d/AGENTS.md` for the full convention.

## Crate Boundaries

- `holtburger-common`: shared primitives and traits only.
- `holtburger-protocol`: wire-level protocol types and deterministic serialization only.
- `holtburger-session`: transport, sequencing, fragmentation, crypto, and socket concerns only.
- `holtburger-dat`: static client data access and decoding only.
- `holtburger-content`: runtime content discovery, parsed bootstrap assembly, and frontend-owned static reference-data queries.
- `holtburger-world`: authoritative world state, hydration, retention/spatial rules, and shared world-derived semantics.
- `holtburger-core`: orchestration plus reusable client behaviors, commands, and controllers that are likely useful across multiple clients.
- `holtburger-cli`: TUI-only rendering, input mapping, local view state, layout, and UX/control policy.
- `holtburger-tools` and `holtburger-debug-harness`: diagnostics, reverse-engineering, and focused experiments.

## App Boundaries

- `apps/holtburger-3d`: explorer/Tauri 3D client app shell, Svelte UI, WebGL2 renderer integration, explorer-mode controls, frontend view state, debug overlays, panels, tabs, layout, and explorer-specific UX policy.
- Keep explorer-mode presentation and interaction decisions inside `apps/holtburger-3d`. Floating panels, tabbed inspectors, viewport HUDs, camera gestures, explorer navigation controls, selection affordances, and debug UI are app-local concerns.
- `apps/holtburger-3d/src-tauri`: app-local host adapter and Tauri command boundary. Keep it narrow and typed; do not promote adapter shapes into shared crates unless they represent reusable client behavior proven outside the explorer app.

## Decision Rules

- Before adding code to a shared crate, ask whether it is likely to be shared by both the TUI and a future 3D client.
- Distinguish authoritative game understanding from frontend presentation. Shared semantics belong in `world` or `core`; presentation and UX belong in the frontend.
- Do not move explorer-mode UX or frontend control policy out of `apps/holtburger-3d` just because it consumes shared world, content, or core data.
- Keep runtime content discovery and static reference-data queries in `holtburger-content`; `core` should consume parsed bootstrap data rather than disk paths or archive policy.
- Do not move code into a lower-level crate just because there is only one caller today.
- Do not leave logic in the TUI just because the TUI is the only current consumer if that logic represents authoritative world semantics or reusable client behavior.
- Prefer extensible, lossless shared representations. A frontend can ignore detail it does not need; adding missing shared detail later is harder.
- If a change weakens crate separation, call that out explicitly and choose a cleaner design or explain the tradeoff.
- Use the per-crate architecture docs for details, but treat the code and ACE/ACViewer references as the final source of truth when docs lag. Use the retail client decompile as a secondary reference where appropriate.
- Do not retain tests that depend on runtime assets which do not get checked in with the repo. It's fine to create them temporarily for debugging or investigation, but they should be removed afterwards.

# Lint Rules
- Treat clippy warnings as errors that must be addressed.
