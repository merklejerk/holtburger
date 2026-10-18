# Player corpse commands and recent death history

Status: implemented and automatically verified; visual acceptance remains with the user.

## Goal and boundaries

Provide on-demand death-location information and corpse permission management through
chat in both clients, plus grant/revoke actions in the 3D selected-player HUD.

In scope:

- Retain ACE's saved `LastOutsideDeath` position from login and subsequent updates.
- Keep a bounded, session-local history of observed local-player deaths, including indoors.
- Support `/corpse`, `/corpses`, `/permit`, `/unpermit`, `/consent`, and `/die` in
  both clients, accepting corresponding `@` forms and retaining `/rip` as an alias.
  Each frontend owns its parser, command names/aliases, usage text, and help catalog.
- Provide `/help death` in both clients through frontend-owned help handling. H3d
  currently has no client help catalog; add a small app-local entry point/topic without
  requiring catalog parity or moving help into shared crates.
- Move existing recall chat parsing out of core and into each frontend, preserving
  supported recall spellings while retaining typed recall execution/eligibility in core.
- Print outdoor coordinates in the format already consumed by the 3D chat-to-waypoint flow.
- Expose grant/revoke for another selected player through the existing interaction HUD.
- Add focused protocol, state, command, lifecycle, host, and frontend verification.

Out of scope:

- Automatic map markers, a dedicated corpse tab, disk persistence of recent deaths,
  an authoritative list of extant corpses, recovery/decay status, or expiry estimates.
- Listing outgoing grants: ACE supplies no such client action.
- ACE changes, including permission defects discovered during the survey.
- Changing the existing successful-open corpse history or its nameplate/traversal behavior.
- A shared command parser/help framework, migration of commands beyond the existing
  recall parser and this feature, or a complete
  h3d catalog of every existing command. Future frontend command sets may differ.

Here, retaining the bookmark means retaining server-supplied data in client memory.
ACE persists that bookmark between logins; the client does not need its own disk copy.
Recent deaths intentionally disappear after logout/disconnect, including reconnecting to
the same character. Portal travel and respawn do not clear them.

## Ground truth and existing patterns

Read these sources before implementing the corresponding phase:

| Source | Contract or precedent |
| --- | --- |
| `ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs:498–635` | Corpse victim/killer identity, dropped contents, persistence, outdoor bookmark update, and coordinate messages. The ordinary outdoor path updates the bookmark even when no items drop. Olthoi handling is separate. |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPlayerDescription.cs:202` | Login includes the saved `LastOutsideDeath` position when present. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Death.cs:34–74,148–235,299–344` | `Die()` increments/sends `NumDeaths` before scheduling corpse creation and respawn. Suicide calls `Die()` directly, bypassing the victim notification in `OnDeath()`. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Death.cs:734–892` | Grant/revoke, incoming consent lists, one-hour grants, accept option, and textual responses. |
| `ACE/Source/ACE.Server/WorldObjects/Corpse.cs:150–249` | Server access checks and actual close behavior. Do not infer public access from our opened indicator. |
| `acclient-eor-source/acclient.c:399720–399870,404415` | Retail consent help/dispatch and local last-outdoor-death lookup. Never modify this reference. |
| `acclient-eor-source/acclient.c:402565,406354` | Retail death-help group and `/die` confirmation before the suicide action. |
| `crates/holtburger-protocol/src/messages/player/events.rs` | Login position table already decodes; its current equipment-oriented field comment is misleading. |
| `crates/holtburger-world/src/player/{types,mutations}.rs` | Player-owned position overlays and login hydration. |
| `crates/holtburger-world/src/state/mutations.rs` | Live private position retention and login world-state application. |
| `crates/holtburger-core/src/client/{commands,types,messages,recall}.rs` | Typed behavior commands, property handling, and output events. `RecallDestination::from_chat` and the `Talk` interception are the existing syntax paths to remove in phase 0; recall eligibility/execution remain here. |
| `crates/holtburger-core/src/client/event_ordering.rs` and `client/messages.rs:283` | Numbered game events can wait while independent property/position messages continue; victim-notification handling is not a safe position-sampling boundary. |
| `crates/holtburger-world/src/state/types.rs:111` | Existing `player_position()` reads the retained authoritative entity position, separate from the predicted runtime pose. |
| `ACE/Source/ACE.Server/Network/{NetworkSession.cs,GameMessageGroup.cs}` | UI and movement messages use separate bundles; server enqueue order does not establish a universal cross-queue observation order. |
| `crates/holtburger-core/src/client/world_container.rs` | Existing opened-corpse history is an unrelated convenience; do not repurpose it. |
| `apps/holtburger-cli/src/pages/game/input/commands.rs` | Existing permit/unpermit handling and help; consolidate execution through core. |
| `apps/holtburger-3d/host/src/{client_runtime,client_projection}.rs` | Chat enters through `Talk`; narrow typed host actions and chat projection. |
| `apps/holtburger-3d/src/client/client-lifecycle-session.ts:1057` and `host/src/client_runtime.rs:1091` | Existing `recall(destination)` / `RecallClient` path already sends `ClientCommand::Recall`; h3d recall chat parsing can reuse it without a new host action. |
| `apps/holtburger-3d/src/client/{ClientApp,ClientChat,ClientSelectedEntityHud,ClientWorldView}.svelte` | Existing local chat interception, coordinate interactions, HUD composition, and social action wiring. |
| `apps/holtburger-3d/src/client/{client-selected-entity,client-navigation-waypoint,client-lifecycle-session}.ts` | `selectedPlayerTarget`, explicit waypoint ownership, and host command lifecycle. |

The surveyed implementation decodes login positions but does not hydrate them into
player position overlays. Live private updates already reach that storage. Neither
the bookmark nor a victim notification contains a corpse GUID. A victim notification
contains text only: any history position captured there is a client observation,
not an exact server-provided death/corpse position. The source investigation rejected
that notification as the recording trigger: suicide bypasses it, and core may delay
it behind missing numbered events while processing respawn positions independently.

Use the live `NumDeaths` property increase instead. ACE sends it from `Die()` for
suicide as well as ordinary deaths, before its delayed corpse/respawn action. Unlike
the victim notification, this property update does not wait in the game-event buffer.
It still carries no position, and its UI queue is separate from movement traffic.
Consequently, an observed position is not guaranteed to precede respawn or equal the
corpse's later physics position. This limitation is accepted; no new correlation or
pose-history subsystem is part of this feature.

ACE caveats relevant to testing: the current close handler unconditionally makes a
corpse public; its comments describe stricter behavior. Removing an outgoing grant
for an offline name can dereference a null player. Do not add client guesses to hide
these server behaviors, and do not promise success before ACE responds.

## Design principles

- Model known facts once at their owning layer. Keep server bookmarks distinct from
  observed deaths; neither represents a live corpse record.
- Keep the ordinary path small. Reuse position storage, character options, typed
  behavior commands, existing request/result conventions, and the waypoint interaction.
- Preserve full cell/position data. Outdoor printed coordinates are presentation;
  an indoor cell must not become an apparently navigable surface waypoint.
- Present information only when requested. A history entry never creates or clears a pin.
- Keep command grammar, help, confirmation, and output presentation in each frontend;
  shared character facts in `world`; and reusable queries/actions/history in `core`.

## Contracts and ownership

```text
ACE login position table / private position update
    -> world: retained LastOutsideDeath bookmark
    -> typed core query/result -> frontend formats /corpse output and coordinates

ACE live local-player NumDeaths increase (login only establishes a baseline)
    -> core: snapshot available world.player_position() as an approximate observation
    -> bounded recent-death history -> typed query/result -> frontend /corpses output

frontend chat parser OR selected-player HUD
    -> same typed core permission command
    -> protocol action -> ACE -> existing chat/error feedback
```

Ownership has a concrete module boundary:

| Owner | Responsibility |
| --- | --- |
| Existing world player state | Retain the bookmark in existing position storage and provide the existing authoritative player position. No new world corpse subsystem. |
| `crates/holtburger-core/src/client/corpse.rs` | Own a small bounded recent-death history value and focused typed query behavior. Prefer functions for stateless work; no chat syntax or help text. |
| `ClientRuntime` | Hold the history value because it owns the session lifetime. Existing command/message/lifecycle dispatch only routes typed requests, records a death, and clears history; feature algorithms stay in `corpse.rs`. |
| Existing core permission/option execution | Execute typed grant/revoke, consent actions, and character-option updates. Reuse these paths from chat and HUD. |
| TUI and 3D frontend | Independently parse their commands, dispatch typed core intents, and format query results into local chat. Each owns help and suicide confirmation. Unhandled text follows existing chat behavior. The 3D frontend additionally owns explicit pins and selected-player HUD controls. |

Both clients run the same core behavior; neither maintains a frontend history copy.
Independent client sessions have independent histories. Add typed bookmark/history
queries and corresponding data results using existing core command/result conventions.
These have concrete TUI and h3d consumers; neither client depends on sending command
strings into core. The h3d host projects requested results through its narrow typed
boundary. No continuous history subscription or frontend-maintained history mirror.
Permission commands are shared by chat and HUD; confirmed suicide uses the existing
`ClientCommand::Suicide` action.

One focused feature module is sufficient. Do not introduce managers, services,
registries, a generic command framework, or a runtime-wide refactor for this work.

Apply the same boundary to existing recalls: each frontend maps its command syntax
to `RecallDestination`, while core owns destination semantics, eligibility, and wire
execution. `ClientCommand::Talk` sends chat text; it does not reinterpret recall
syntax. Remove the shared parser and fallback interception in one cutover after both
frontends are wired. Do not leave a compatibility parser in core.

Use one documented `RECENT_DEATH_LIMIT` constant, initially 20, with FIFO eviction and
newest-first display. Each retained observation needs only its best available full
world position. Represent unavailable position explicitly, so a confirmed death is
still listed without invented coordinates. Store existing `WorldPosition` values and
use existing coordinate/cell helpers when formatting query results in each frontend.
Expose full positions through existing typed host position conventions; no new
classification system, derived location flags, or moving pose cache is needed.
Avoid corpse GUIDs, recovered flags,
permission flags, timestamps, or counters without a concrete display consumer.

Use the existing server bookmark separately; do not synthesize a death-history entry
from login. Its age is unknown and it may duplicate a death seen earlier. Do not
overwrite the bookmark using an indoor observation or infer it from a generic death
message. ACE's position updates remain authoritative.

The canonical recording signal is an accepted live increase in the local player's
`PropertyInt::NumDeaths`. Compare with the retained value before applying the update;
login hydration establishes the baseline without adding history. Do not create a
second counter cache if existing player properties provide that baseline. If no prior
count is available, establish it without inventing an observed death. Equal or lower
values add no entry. A jump greater than one adds one observed entry, not fabricated
positions for deaths we did not observe individually.

Do not also record from zero health, death motion, nearby player-killed broadcasts,
or victim notifications. Keep existing feedback from those messages intact. Do not
deduplicate by message text or position: successive legitimate deaths may share both.
Capture `world.player_position()` at the live update boundary; do not substitute a
predicted/rendered pose or claim the retained server sample is contemporaneous.

## Command and interaction behavior

Both clients must support the commands below and both prefixes for this feature.
This is an explicit product requirement, not a shared parser/catalog contract: TUI
and h3d own independent syntax handling and may grow different command sets later.
They dispatch the same typed behavior intents and format their own output. Preserve
ordinary speech and existing unknown-command forwarding. Recognized malformed
commands fail locally with usage feedback, never falling through to nearby speech.

| Command | Result |
| --- | --- |
| `/corpse` | Print “Last outdoor death: (coordinates). This saved location does not confirm a corpse remains.” If absent, print a specific no-record message. |
| `/corpses` | Print recent deaths newest first, labeled as approximate session observations with no confirmation of remaining corpses/items. Position samples may be stale or reflect a later position. Outdoor entries use linkable coordinates. Indoor entries identify the cell and position without presenting a surface coordinate link. Unknown positions are explicit. Empty history has a specific message. |
| `/permit <player name>` | Existing `AddPlayerPermission` behavior. |
| `/unpermit <player name>` | Existing `RemovePlayerPermission` behavior. |
| `/consent on` / `/consent off` | Set `AcceptCorpseLootingPermissions` through the existing character-option update path; preserve all other option bits. |
| `/consent who` | Send `DisplayPlayerConsentList`; ACE prints incoming grants. |
| `/consent clear` | Send `ClearPlayerConsentList`; clears incoming grants. |
| `/consent remove <player name>` | Send `RemoveFromPlayerConsentList`; remove one incoming grant. |
| `/consent` | Print usage and explain incoming versus outgoing permission semantics. |
| `/die` (alias `/rip`) | Ask for frontend-owned confirmation, then send the existing suicide intent. Cancellation sends no action. Explain that items may drop and vitae may accrue; ACE determines the outcome. |
| `/help death` | List this frontend's supported death commands, including existing relevant recalls. TUI extends its help; h3d adds a minimal local help entry point and death topic. `/help` must make that topic discoverable. |

Support names containing spaces through the existing remainder-of-command convention;
do not introduce a second quoting language. Help must distinguish `/unpermit`
(withdraw access you granted) from `/consent remove` (discard access you received).

In the 3D selected-player interaction HUD, add “Grant corpse access” and “Revoke corpse
access” beside existing social actions. Reuse `selectedPlayerTarget` so actions apply
only to another known player, never self, a corpse, or an unresolved selection.
Capture the target identity at activation, then dispatch the corresponding typed
command. Apply existing lifecycle/busy eligibility and error handling. Display both
actions; do not invent a toggle, outgoing-grant list, or granted-state badge.

## Phased implementation

### Phase 0: Move recall syntax into the frontends

- [x] Inventory `RecallDestination::from_chat` spellings, validation, callers, and tests,
      plus existing TUI recall shortcuts. Preserve the currently supported commands in
      each frontend, including both prefixes, case handling, and nested house/allegiance
      forms. Do not broaden this into migrating every existing command.
- [x] Replace the TUI shared-parser call with focused app-local recall parsing into
      `ClientCommand::Recall`. Consolidate overlapping TUI recall branches where appropriate.
- [x] Add app-local recall parsing to h3d's chat dispatch, calling the existing typed
      `session.recall(destination)` path. Do not send recognized commands as `Talk`,
      including malformed commands; present their usage errors locally.
- [x] Remove `RecallDestination::from_chat` and recall interception from core's `Talk`
      handler in the same change. Keep `RecallDestination`, its wire mapping, and all
      shared recall behavior/eligibility. Inspect remaining `Talk` producers for reliance
      on that interception and move any actual recall intent to the typed command.
- [x] Replace core parser tests with focused frontend parser tests. Keep core tests
      about recall behavior; test ordinary chat submission through its existing path.
      Test the h3d parser-to-existing-host-call boundary without duplicating core rules.

Acceptance: both frontends retain their recall commands through typed requests; no
shared recall syntax parser or core chat fallback remains. Grammar and help stay
frontend-owned, while recall behavior has one core implementation.

### Phase 1: Retain the saved outdoor bookmark

- [x] Fix the protocol position-table comment to describe keyed character positions.
- [x] Hydrate the login-supplied bookmark into world-owned position storage, replacing
      prior baseline data so omitted positions cannot survive from a previous character.
      Use the existing typed position-key conversion policy; do not blindly cast keys.
- [x] Keep live private updates on the same path. Retain full pose data.
- [x] Add focused synthetic tests: login with bookmark, subsequent replacement,
      fresh baseline without bookmark, character switch, and live update without moving
      the player's current location. No new disk persistence.

Acceptance: login and live updates yield the same bookmark lookup, and a new baseline
cannot expose a previous character's bookmark.

### Phase 2: Record session-local recent deaths

- [x] Trace ACE death/suicide paths and core receive ordering. Reject victim notification;
      select live `NumDeaths` increases. Confirm existing `world.player_position()` is
      available, while exact or universally pre-respawn position sampling is unproven.
- [x] Add the small bounded history value and its operations in `client/corpse.rs`,
      with documented location availability. Hold it on `ClientRuntime`; keep message
      and lifecycle integration to short routing calls. Reuse `WorldPosition` and its
      helpers without adding a location contract or another moving pose cache.
- [x] Compare the retained count before the live property update mutates it; record one
      observation for an increase and snapshot `world.player_position()`. Baseline-only,
      repeated, decreased, and multi-count updates follow the rules above. Preserve
      existing combat/chat feedback and keep runtime integration to short routing calls.
- [x] Clear on terminal character/session transitions; preserve through portal travel,
      respawn, and frontend view/renderer reconstruction.
- [x] Test login/missing baselines, repeated/decreased/jumped counts, the suicide count
      path without victim notification, outdoor/indoor/unavailable positions, FIFO
      eviction, and successive deaths at the same position. Include a delayed victim
      event after a position change to prove it does not insert another entry. Verify
      other-player messages, respawn, and session retirement; derive capacity assertions
      from the runtime limit.

Acceptance: history reports observations honestly, is bounded, survives respawn, and
cannot leak across character sessions. Sampling uses the available authoritative
position without promising freshness, pre-respawn timing, or exact corpse placement.

### Phase 3: Complete protocol and shared behavior API

- [x] Enable consent opcodes `0x0216`, `0x0217`, and `0x0218`; implement their payloads,
      action enum dispatch, packing/unpacking, and protocol round-trip tests against ACE
      handlers. The first two have no payload; remove takes the player name.
- [x] Add typed core commands/results for bookmark/history queries and missing consent
      operations. Reuse existing grant/revoke, character-option, and suicide commands.
- [x] Put history/query algorithms in `client/corpse.rs`, reached through short typed
      command dispatch. Return data rather than chat syntax or formatted prose. Keep
      the phase-0 recall boundary intact; do not refactor unrelated command handling.
- [x] Test query results including empty/unknown locations, option-bit preservation,
      permission action payloads, and absence of network actions for local queries.

Acceptance: both clients can invoke every required behavior through typed core APIs
without a shared chat parser. Permission mutations receive ordinary ACE feedback.

### Phase 4: Integrate both clients and the selected-player HUD

- [x] Extend TUI command handling/help and add focused h3d app-local command handling/help.
      Both support every command in the table. Retain frontend-owned parsing; consolidate
      execution through typed core intents rather than core chat interception.
- [x] Add narrow typed host requests/results and lifecycle-session methods for death
      queries, consent, grant/revoke, option updates, and confirmed suicide, reusing
      existing host paths where available. Do not introduce a generic host dispatcher.
- [x] Format query results in each frontend. Use existing position formatting helpers;
      h3d outdoor coordinates must match its clickable-coordinate grammar, while indoor
      output must not offer a surface waypoint. Queries never automatically create pins.
- [x] Add `/die`/`/rip` confirmation through each frontend's existing interaction patterns.
      Route the current immediate TUI `/rip` path through that same confirmation; do
      not leave an alias that bypasses it. Keep confirmation policy out of shared core.
- [x] Wire selected-player HUD controls using existing UI components, social target
      eligibility, keyboard ownership, and error presentation.
- [x] Test host request decoding and inspect direct forwarding to the corresponding core
      commands; test projected results through the real event sink. Extend existing pure
      selected-action tests only for new eligibility behavior; reuse coverage of the
      established `selectedPlayerTarget` predicate and lifecycle infrastructure.
- [x] Test each frontend's own parser/help for both prefixes, case handling, multiword
      names, malformed arguments, unknown passthrough, and help discoverability. Test
      suicide cancellation/acceptance in each frontend. This duplication verifies two
      independent syntax/UI boundaries; core does not repeat their grammar tests.
- [x] Add one focused browser integration scenario exercising HUD grant/revoke dispatch
      and typed query results through frontend chat formatting and coordinate handling.
      Outdoor coordinates create a waypoint only after explicit user interaction;
      indoor/unknown entries do not offer a surface waypoint. Keep history algorithms
      in core tests and parser matrices in frontend tests rather than repeating them
      through the browser or every adapter.

Acceptance: both clients support the required commands using their own catalogs and
shared behavior APIs; the 3D HUD targets the selected
player accurately, and the user controls whether historical coordinates become a pin.

### Phase 5: Cleanup and verification

- [x] Sweep misleading vocabulary: use “recent deaths” for observations and “last outdoor
      death” for the bookmark. Keep the established “opened corpse” convenience separate.
- [x] Remove duplicate behavior execution and any unused fields/adapters introduced during
      implementation. Preserve frontend-owned syntax/help; reassess net line count
      against the small command/history scope.
- [x] Run focused Rust tests for affected packages and targeted TypeScript tests; then
      `cargo fmt --all -- --check` and clippy for affected packages with `-D warnings`.
- [x] In `apps/holtburger-3d`, use existing `npm run test:ts -- <files>`, `npm run check`,
      `npm run lint:ts`, `npm run lint:dead`, and `npm run lint:rust` as applicable. Run
      the relevant noninteractive browser probe through `npm run harness:browser -- ...`.
- [x] Leave visual acceptance to the user. Do not launch the interactive TUI. Any optional
      live ACE experiment must use the debug harness and must not leave asset-dependent tests.
- [x] Update this checklist with results and any evidenced deviations.

Acceptance: relevant checks pass, browser interaction assertions pass, and no unrelated
source/submodule changes are included.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Position sample is stale, post-respawn, or differs from the falling corpse | Label history as approximate observations, retain unavailable positions honestly, and keep ACE's bookmark separate. Do not add correlation machinery to manufacture certainty. |
| Indoor locations accidentally offer surface navigation | Preserve cell identity and test production chat parsing against indoor output. |
| Terminal transitions or missing login properties retain old data | Replace the login baseline and test both same-character reconnect and character switch. |
| Required behavior differs between TUI, h3d chat, and HUD | Shared typed core queries/actions plus frontend-specific tests for the explicitly required commands. Catalogs and grammar remain frontend-owned. |
| Local commands appear in nearby speech | Recognized commands are consumed even when malformed; test that no Talk action is sent. |
| ACE permission errors are mistaken for client state | Keep server feedback visible; no optimistic permission status or local permission cache. |

## Definition of done

All phase acceptance criteria and relevant checks pass. Existing corpse-open indicators,
recall, ordinary chat, and unrelated option bits preserve their behavior. User visual
acceptance remains separate from automated verification.

## Decisions and open questions

- Agreed: chat-first tools, explicit pins, selected-player grant/revoke, and ephemeral history.
- Agreed after scope review: focused `core/client/corpse.rs`, existing world position
  storage/types, and verification concentrated at the layer owning each behavior.
- Latest steering supersedes the earlier shared-parser/no-query-command design:
  frontends own syntax, aliases, formatting, help catalogs, and suicide confirmation;
  core exposes typed behavior/query APIs. Every command in the table is required in
  both clients, without imposing general catalog parity. Include `/die`/`/rip` and
  frontend-local `/help death`; no shared help infrastructure.
- Existing recall parsing follows that boundary too: phase 0 moves syntax into each
  frontend and removes core's parser/interception completely. Reuse the existing typed
  h3d recall host path; shared recall execution and eligibility remain in core.
- Proposed narrow defaults: `/corpses` lists history; retain 20 entries; no timestamp/clear
  command until a concrete need appears. These do not block implementation.
- Source investigation completed: use live `NumDeaths` increases, not victim notification;
  login establishes the baseline. Reuse `world.player_position()`. Approximate sampling
  is accepted, including stale/later samples; exact pre-respawn correlation would require
  additional machinery outside this plan. No code or live experiment was needed to
  establish these source-level limitations.
- No outstanding product decision requires user input before implementing this plan.


## Implementation evidence

- Phase 0: TUI recall grammar is now in `input/recall.rs`; h3d owns
  `client-recall-command.ts`. Both submit typed recalls. Core `Talk` sends ordinary
  speech, and the shared parser was deleted. Remaining `Talk` producers were inspected;
  no checked-in script was found relying on recall syntax through `Say`.
- Phases 1–3: login positions replace the saved-position baseline; `client/corpse.rs`
  owns bounded history and typed queries. Private count observations happen before
  world mutation, with no second counter or position cache. Consent actions are wired
  through deterministic protocol codecs and typed core execution.
- Phase 4: both frontends own command parsing, help, historical output, and suicide
  confirmation. The selected-player HUD exposes grant/revoke using existing selection
  and session eligibility. Result identities prevent retired-character output.
- Rust verification: the full five-package library suite passed with local socket
  access (2,609 tests at that run), followed by focused checks for the two new host
  tests and revised death-history tests. The initial restricted run failed at six
  local UDP socket creations; rerunning with socket access passed.
- TypeScript verification: the complete suite passed (367 files, 3,191 tests). App,
  test, Node, and Electron typechecks, ESLint, and unused-export checks passed.
- Browser verification: `npm run harness:browser -- --client-selected-actions --brief`
  passed, including grant/revoke dispatch and production chat formatting/coordinate
  activation. History interaction is explicitly enabled before links become active;
  the output itself creates no waypoint, and indoor output offers no surface link.
- A baseline TUI compile error was also corrected: the bootstrap error classifier
  omitted the already-existing `EquipmentSet` reason. That interaction feedback is
  ignored by the pre-world classifier, consistent with its in-world scope.
- No ACE/ACViewer modifications, interactive TUI run, visual acceptance, staging, or
  commits were performed. The existing dirty reference submodules were preserved.
- Verification scope adjustment: mechanical host forwarding was inspected directly,
  with request-decoding and real event-sink serialization tests. No content-dependent
  runtime fixture or extra command-conversion abstraction was introduced just to test
  those match arms. Parser matrices stay frontend-local; history algorithms stay in core.

- Final audit: Rust formatting, clippy with warnings denied across all affected targets,
  h3d app/test/Node/Electron typechecks, ESLint, unused-export checks, and formatting
  checks passed. Focused follow-up tests also cover whitespace-prefixed TUI recall
  input and live counter increases at unavailable positions. The implementation and
  automated verification are complete; visual acceptance remains user-owned.

## Follow-up scope and code-quality review

Subsequent user requests expanded the h3d help surface beyond the original minimal
death topic: the index lists all locally handled commands, targeted help explains each
command, and `/?` aliases `/help`. App-authored help uses literal styled text rows with
one timestamp. Submission errors enter chat history; both successful and failed
submissions clear the editor and remain available in input history. Both clients now
accept either command prefix universally. These requests supersede the earlier
restriction against a complete h3d command index; catalogs remain frontend-owned.

Verdict: ready within the reviewed scope after focused ownership cleanup.

- Fixed: generic h3d help was routed through the death controller. The help module now
  owns its stateless entry point, and the app invokes it before session-dependent
  commands. The browser fixture no longer constructs a session to request help.
  TUI death-topic help also uses its existing catalog instead of a second parser route.
- Fixed: suicide submission failures used ordinary system-message styling. They now
  use the existing chat error representation, consistent with other submission errors.
- Seam coverage: traced ACE consent handlers through protocol codecs, core commands,
  host request dispatch, and lifecycle-session methods; inspected selected-player
  targeting through HUD activation and captured-name dispatch. Traced login/live
  position hydration, pre-mutation death-count observation, session retirement,
  typed query projection/serialization, frontend result filtering, and waypoint output.
  Inspected local confirmation acceptance/cancellation and generic chat failure cleanup.
- Consolidation: retained one shared core history and typed behavior API, reused the
  existing world-position schema and dialog/selection/waypoint primitives, and removed
  the shared recall syntax parser. Separate frontend grammars, help catalogs, and
  coordinate presentation are intentional product boundaries, not shared infrastructure.
- Accepted limits: death samples can be stale or post-respawn and never prove that a
  corpse remains. No additional pose/counter cache, permission-state cache, persistent
  marker, or generic command framework was added. Existing ACE permission defects and
  unrelated reference-submodule changes remain outside this change.
- Final review verification: all five affected Rust library suites passed (2,613 tests),
  all TypeScript tests passed (3,219 tests), and app/test/Node/Electron checks, ESLint,
  unused-export checks, and affected-target clippy with warnings denied passed. The
  selected-actions browser probe passed after ownership cleanup; the waypoint browser
  probe passed for prefix parity and submission cleanup. No live ACE or visual acceptance
  pass was performed; these checks do not establish an exact death-position guarantee.
