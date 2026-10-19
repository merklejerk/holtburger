# H3D Chat Interaction and Channel UX Plan

Status: implementation and automated verification complete. The full HUD suite and focused keyboard/chat suite pass. Visual acceptance is handed to the user; a live professor purchase remains unverified.

## Context and boundaries

Goal: make chat interaction predictable and expose ACE-supported messaging through a clear destination picker, manual commands, and faithfully classified history.

In scope:

- Input focus activates history interaction; explicit history activation remains available.
- A distinct active border and a configurable Ctrl+C history toggle.
- Bottom-following scroll behavior independent of activation.
- An evidence-backed inventory of ACE-supported channels and feedback categories.
- Preserve distinctions currently flattened in core or the h3d host projection.
- A persistent destination picker, targeted tells, command previews, manual channel commands, and separate reply/retell targets.
- Tell selected for addressable players and NPCs through the picker or `/tellselected` / `/ts`; NPC-directed tells use TalkDirect and retain NPC reply/retell targets. Treat this as gameplay interaction support, not a sender-context-menu feature.
- Clear receive labels within the existing Chat/Combat filters, command help, an additive shortcut settings migration, focused tests, and browser behavior verification.

Out of scope:

- Implementing channels absent from ACE, rebuilding historical town/staff systems, or changing ACE behavior.
- Multiple chat windows, conversation tabs, persisted conversations, player search services, or a general command framework.
- Nested receive filters and their storage migration, recent-correspondent suggestions, sender context actions, custom scroll anchoring, a general shortcut-priority model, or a channel-permission subsystem. Revisit custom anchoring only if browser evidence shows native anchoring is insufficient.
- Visual acceptance by the implementing agent; the user owns that review.
- TUI UX changes. Update TUI consumers only where shared contract changes require them.

Implementation is authorized by the active goal. No commits or staging are part of this work.

## Ground truth and existing patterns

Paths below are relative to the repository root.

| Layer | Sources and responsibilities |
| --- | --- |
| H3D frontend | `apps/holtburger-3d/src/client/ClientChat.svelte`: editor, history activation, scrolling, picker, and presentation |
| H3D frontend | `client-chat-policy.ts`, `client-chat-input-history.ts`, `ClientApp.svelte` in the same directory: filters, retained lines, sent history, and local command dispatch |
| H3D frontend | `client-host-contract.ts`, `client-lifecycle-session.ts`: host decoding and typed request boundary |
| H3D frontend | `client-binding-catalog.ts`, `client-input-settings.ts`, `client-settings-contract.ts`, and settings persistence/transport: configurable bindings and existing saved filters |
| App input policy | `apps/holtburger-3d/src/lib/input/{keyboard-input-policy,input-contract,input-defaults,input-context}.ts`: keyboard ownership, native copy precedence, binding matching |
| App UI | `apps/holtburger-3d/src/app/{PopupMenu.svelte,UiDialog.svelte,ui-base.css}` and immediate consumers: reuse menus, dialogs, focus handling, and theme chrome |
| H3D host adapter | `apps/holtburger-3d/host/src/{client_runtime,client_contracts,client_projection}.rs`: narrow typed requests and loss-preserving display projection |
| Transport and composition | `apps/holtburger-3d/host/src/protocol.rs`, `src/lib/host/host-transport.ts`, `src/client/ClientWorldView.svelte`, and `scripts/live-client-probe.mjs`: request decoding, command admission, chat props, and probe request fixtures |
| Settings storage | `apps/holtburger-3d/electron/client-settings-store.ts` and `src/client/client-settings-sections.ts`: section envelopes, Electron reads/writes, and canonical values |
| Browser verification | `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte`, `scripts/client-hud-probe.mjs`: existing synthetic chat, sent-history, waypoint, and keyboard ownership probes |
| Shared client behavior | `crates/holtburger-core/src/client/{types,commands,messages}.rs`: semantic messages, send intent, transport routing, and receipt interpretation |
| Wire protocol | `crates/holtburger-protocol/src/messages/chat/`: known and unknown IDs, message types, legacy and Turbine codecs |
| ACE authority | `ACE/Source/ACE.Entity/Enum/{Channel,ChatType,ChatMessageType}.cs` |
| ACE authority | `ACE/Source/ACE.Server/Network/GameAction/Actions/GameAction{Talk,Tell,ChatChannel,Emote,SoulEmote}.cs` |
| NPC direct interaction | `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTalkDirect.cs`, `WorldObjects/Managers/EmoteManager.cs::OnTalkDirect`, and `EmoteType.Tell`: entity-addressed requests trigger ReceiveTalkDirect content and NPC responses retain sender identity |
| ACE authority | `ACE/Source/ACE.Server/Network/Handlers/TurbineChatHandler.cs`, `Network/GameEvent/Events/GameEventTell.cs`, and `WorldObjects/Player_Networking.cs` |

Retail evidence already checked: `acclient-eor-source/acclient.c:399335` documents reply to the last incoming teller; `:399433` implements retell using LastTelleeName; `:399501` documents retell/rt; `:399529` splits tell input at the first comma; `:399598` documents the required comma and tell aliases. Required slash aliases are product requirements; these retail references establish the underlying semantics. Inspect the same source for channel aliases in phase 1. Do not modify the decompile or infer aliases from other games.

Baseline observations (before implementation):

- History interaction is a local boolean. Input focus changes the fade appearance but does not enable history interaction.
- Auto-scroll currently stops whenever history interaction is enabled, regardless of scroll position.
- H3D displays named received channels already. Its two filters are Chat and Combat; system/error lines are unconditional.
- The host send endpoint wraps unhandled input in `ClientCommand::Talk`. Core already has Tell, ChannelMessage, Emote, and SoulEmote commands.
- The host drops speech message types, most server message categories, and channel source distinctions. Core's Tell view event also omits wire classification.
- Core merges allegiance broadcast and ordinary allegiance chat into one channel kind; sending selects Turbine allegiance first and legacy broadcast as a fallback. These routes have different permissions in ACE.
- ACE's outgoing tell confirmation is a SystemChat packet classified OutgoingTell; its recipient is embedded in prose. Incoming tells have structured sender information. An absent structured recipient cannot be recovered losslessly by changing the frontend contract.
- Native Ctrl/Cmd+C already takes precedence when a non-editor document selection exists. Editors retain native keyboard behavior.
- Ctrl+C also matches current wildcard-modifier strafe-right. Scope activation runs before gameplay, but settings conflict detection currently treats both as peers. History's `nativeControls` scope prevents other scopes' activation callbacks, so Enter from history needs an explicit local handoff.
- `ClientRuntimeHost::send_command` succeeds when it enqueues a command. Core execution is later; `runtime.rs::process_command_batch` treats returned command errors as runtime failures. Ordinary chat refusals must use feedback, not disconnect the client.
- Core currently ignores Turbine response payloads. ACE `TurbineChatHandler.cs::HandleChatReject` can return hresult zero on rejection and can echo a rejected message. Neither an echo nor hresult zero proves delivery.
- ACE can emit generic Society chat type with a specific society room ID. Core currently lets that generic type hide the more specific room identity.
- ACE emits fellowship notifications with an empty sender; legacy channel self-echoes can also have an empty sender. Empty sender alone cannot establish message direction or a reply recipient.
- Sender addressing is now evidenced: `ACE/Source/ACE.Server/WorldObjects/Player_Properties.cs:19` appends `^` or `&` for Olthoi speech, while `Managers/PlayerManager.cs:358` looks up the actual name and supports the staff `+` form. Retail `acclient.c:395453–395489` removes the Olthoi marker before the incoming teller name is remembered at `:395545`. Player tells/replies require the name-addressed path for long-distance operation. NPC interaction requires the separate TalkDirect-by-GUID path; ACE resolves the creature in the current landblock and invokes its ReceiveTalkDirect emotes.
- Retail `acclient.c:407334–407340` sends chat to the selected speakable target using TalkDirect; `:667312` serializes opcode `0x0032`, message string, and entity ID. Our protocol currently leaves this opcode commented out. The [Professors of Magic instructions](https://asheron.info/wiki/index.php/Professors_of_Magic) describe selecting a professor, choosing Tell, sending `level 1`, then accepting a payment prompt. This identifies the acceptance scenario; verify exact ACE content and the confirmation path before claiming end-to-end completion.

## North stars and contracts

1. Preserve facts at their owning layer. Presentation grouping must not erase message meaning.
2. Keep destination choice, command syntax, reply/retell convenience, filters, and focus policy app-local. Keep reusable send semantics and transport decisions in core.
3. Make the effective destination visible before submission. Manual commands override one message without changing the persistent picker destination.
4. Compute command resolution once. Preview and submission consume the same parsed result; submit snapshots the destination and body before asynchronous work.
5. Separate interaction from scrolling. Activation never implies jumping to the newest message.
6. Extend existing owners and UI primitives; replace the old path instead of layering a second dispatcher or copy of message history.

Conceptual flow, not a prescription to introduce every named object:

```text
picker destination + draft + reply/retell session targets
  -> app-local parse/resolution result
       ordinary text | chat request | existing app command | incomplete/error
  -> one effective-destination preview
  -> one typed host request
  -> core send intent -> selected protocol route -> ACE

ACE packet -> protocol facts -> core semantic event -> host projection
  -> retained line -> frontend filter/color/label -> history
```

Use discriminated request shapes: local speech with body; tell with recipient and body; channel with an explicit destination and body; emote with body. Empty recipients and empty bodies are validation errors, not fallback-to-local cases. Represent ordinary allegiance chat and allegiance broadcast as distinct send intents. Keep receive identity and send destination separate where their semantics differ; avoid a large universal chat enum shared by unrelated consumers. Use protocol-derived category independently of packet shape: for example, a SystemChat OutgoingTell retains outgoing-tell meaning, and a SystemChat Fellowship notice retains party-notification meaning. These facts drive labels and tones without requiring new filter groups. Preserve unknown IDs with their source/category kind rather than treating an unknown channel ID as an unknown text type.

A tell recipient is one composite variant: player by name, or NPC by entity ID with its display label. Core owns name-addressed Tell versus entity-addressed TalkDirect routing; the frontend retains that typed recipient for preview, picker, reply, and retell. Do not flatten both into a target string or redirect an unavailable NPC to another entity with the same name. A stale/out-of-range NPC request fails visibly; it never becomes a player tell or local speech.

Tell selected resolves an authoritative selected player to its send-address name and a selected NPC to its entity ID plus display label. The picker snapshots this recipient when selected; `/tellselected <message>` and `/ts <message>` snapshot it on submission and override only that message. Changing selection afterward does not retarget an established destination or submitted request. `/tell <name>, <message>` and `/t ...` always address a player by name, independently of selection. Never infer NPC addressing from matching text or a failed player lookup. These selected-target aliases and long-distance player routing are explicit product choices, not claims about retail command spelling or its selected-target transport.

The public command contract is:

| Action | Recipient | Syntax / persistence |
| --- | --- | --- |
| Tell by name | Player, using normal name-addressed Tell | `/tell Some Player, hello` or `/t Some Player, hello`; overrides this message only |
| Tell selected | Currently selected addressable player or NPC | `/tellselected hello` or `/ts hello`; the entire remainder is the body, with no name or comma required; overrides this message only |
| Picker: Tell selected | Selected player or NPC at the moment the picker action is chosen | Establishes a persistent, snapshotted Tell destination for subsequent plain messages |
| Reply | Latest incoming addressable teller, including an NPC | `/reply hello` or `/r hello`; overrides this message only |
| Retell | Last locally accepted outgoing Tell recipient, including an NPC | `/retell hello` or `/rt hello`; overrides this message only |

For example, select a professor and submit `/ts level 1` to use its entity-addressed interaction. After an addressable NPC response, `/r level 1` addresses that NPC; `/rt level 2` reuses the last accepted outgoing recipient. Selecting a player and submitting `/ts hello` uses the ordinary player-name route instead. The destination preview identifies the resolved name and whether it is an NPC before submission. These examples specify routing; they do not establish that payment or spell learning has been verified live.

Command classification happens before applying the picker destination: recognized app commands retain existing behavior; recognized chat commands resolve explicitly; remaining `@` commands always go through local Talk to ACE, even when Tell/Party is selected; unknown `/` commands fail locally; ordinary text uses the picker. Match exact command tokens, and recognize existing `/allegiance hometown` before treating an allegiance token as a chat operation. Do not reimplement the existing domain command parsers merely to classify chat input.

Reply and retell targets belong to the character-session frontend owner, outside the mounted editor:

- Reply: last incoming addressable tell sender, including an NPC whose entity ID is known. The most recent such tell wins, and the destination indicator exposes that choice before submission. Unknown senders do not replace it.
- Retell: recipient of the last locally accepted outgoing tell, from any entry path.
- Local acceptance means typed validation and host command enqueue succeed; it does not mean core execution, transport send, or server delivery succeeded. Later offline/blocked/transport errors do not erase the target. A rejected validation/enqueue does not update it. Do not add a generic command-acknowledgement framework for retell.
- Preserve targets across chat component remounts, but clear them on character/session replacement. Do not persist them to disk.
- The existing server echo remains the displayed confirmation. Do not add an optimistic duplicate or correlate text echoes to requests by guessing.
- Received speaker names are display names and can include suffixes. Shared speaker interpretation should retain display text and derive a player tell address by removing only the proven trailing Olthoi `^`/`&` markers; preserve the staff `+` form that ACE accepts. Preserve the packet's non-player sender ID for entity-addressed reply rather than discarding it after speaker classification. Encode player/NPC/unaddressable recipients as variants; Reply is their immediate consumer. Test normal, staff, Olthoi, unknown, and NPC inputs. Manual name entry remains literal apart from whitespace trimming.
- Allowing `/reply` to an addressable NPC is an intentional product choice: retail's remembered incoming teller logic at `acclient.c:395542–395545` is player-ID-gated. Do not claim retail `/reply` already supports NPCs. This choice removes a dead end in actual NPC dialogue while preserving long-distance name routing for players.

## Phase 1: Catalog and finalize semantic distinctions

Deliverables: a compact inventory maintained in this plan during implementation, plus the chosen request/message shapes before edits to consumers.

| Family | Initial inventory | Implementation treatment |
| --- | --- | --- |
| Local | Player/NPC speech, emote, soul emote | Preserve classification; expose Local and supported emote commands |
| Private | Incoming tell, outgoing tell confirmation, admin tell | Preserve direction/category; structured recipient only where actually known |
| NPC direct | Selected creature TalkDirect, incoming NPC tell | NPC label in combined history; entity-addressed Tell destination and typed reply/retell |
| Party | Fellowship chat and fellowship broadcast/notifications | Party destination; distinguish notification semantics where evidence supports it |
| Allegiance | Ordinary Turbine allegiance chat; legacy allegiance broadcast | Separate destinations and permissions; no silent substitution |
| Relationships | Patron, monarch, vassals, co-vassals | Named destinations and receive identities |
| Public | General, Trade, LFG, Roleplay | Named destinations; availability follows negotiated transport |
| Restricted | Society, Celestial Hand, Eldrytch Web, Radiant Blood, Olthoi | Preserve distinct received identities; offer only valid send destinations |
| Feedback | Combat variants, magic, advancement, appraisal, spellcasting, recall, craft, salvage, broadcasts, help/social categories | Preserve category for labels/tones; retain coarse filters and do not make feedback categories outgoing destinations |
| Staff/reference | Abuse, Admin, Audit, Advocates, Sentinel, Help; historical towns, QA/debug, other broadcast IDs | Verify ACE handlers individually; catalog implemented privileged channels, omit unsupported routes from normal picker |

Verified send-route inventory:

| Destination and aliases | ACE route and restrictions | Receive treatment |
| --- | --- | --- |
| Local `/say`; `/emote` | `GameActionTalk` / `GameActionEmote`; ACE owns gag and visibility rules | Labeled speech/emote; soul emote stays distinct when received |
| Player `/t`, `/tell`; `/r`, `/reply`; `/rt`, `/retell` | `GameActionTell`; online player-name lookup, gag and squelch checks | Incoming structured teller; outgoing SystemChat retains OutgoingTell category |
| Selected `/ts`, `/tellselected` | Player uses Tell; NPC uses `GameActionTalkDirect`, which resolves a Creature in the current landblock and otherwise returns CharacterNotAvailable | NPC entity identity survives replies and retells |
| Party `/f`, `/fellowship`, `/party` | Legacy Fellow in `GameActionChatChannel`; requires fellowship membership | Party conversation versus FellowBroadcast notification; empty-sender echoes stay empty |
| Allegiance `/a`, `/guild`, `/gu` | Negotiated Turbine allegiance room; ACE checks actual allegiance and chat filtering | Ordinary Allegiance, distinct from broadcast |
| Allegiance Broadcast `/ab`, `/allegiance broadcast` | Legacy AllegianceBroadcast; requires allegiance and Speaker permission | Explicit Allegiance Broadcast label |
| `/v`, `/vassals`; `/p`, `/patron`; `/m`, `/monarch`; `/c`, `/co-vassals` | Legacy relationship routes in `GameActionChatChannel`; checks allegiance and applicable vassal/patron/monarch facts | Named relationship labels; no guessed direction from an empty sender |
| `/general`, `/cg`; `/trade`, `/ct`; `/lfg`, `/clfg`; `/roleplay`, `/crp` | Negotiated Turbine rooms; server settings, account age, played time, level, listening options, and Olthoi restrictions remain ACE-owned | Individual named public-channel labels |
| Society `/society`, `/soc` | Character's negotiated Society destination; ACE restricts recipients by society and listening option | Preserve generic Society or specific Celestial Hand / Eldrytch Web / Radiant Blood identity from the packet |
| Olthoi `/olthoi`, `/o` | Negotiated Turbine Olthoi room; ACE restricts senders to Olthoi players and applies server settings | Olthoi label |

`GameActionChatChannel.cs` implements Abuse/Advocate1–3 for Advocate+, Audit/Sentinel for Sentinel+, and Admin for administrators. Help has an explicit unfinished handler. These remain catalog-only; no privileged picker entries were added. QA1/QA2/Debug, town channels, legacy society broadcast IDs, and legacy Olthoi have no matching send case and fall through its default handler; they are excluded from outgoing destinations. Unexpected received legacy IDs retain their numeric identity. Turbine restrictions and rejection behavior are evidenced in `TurbineChatHandler.cs`; a rejection may be silent or echo the request, so neither enqueue nor echo is a delivery receipt.

Aliases are centralized in `client-chat-compose.ts` for parser, picker, and help. `/party`, `/ts`, and `/tellselected` are deliberate product vocabulary. Retail channel spellings are referenced there at `acclient.c:405475–406080,408170–408800`. `/allegiance hometown` remains an existing recall command.

Local `ace_world` inspection confirmed War professor template 53381 has ReceiveTalkDirect entries for `level 1` / `level one` through level seven. Entry 63570 invokes action 75 with `lvl1yesno` and the prompt “I can teach you the level one War Spells for 2 X Notes.” Existing confirmation handling returns the request identity and acceptance to ACE; ACE content owns skill/currency checks, payment, and teaching. A census found 10 ReceiveTalkDirect templates, including the five magic professors. The browser fixture verifies the typed NPC request, incoming NPC reply, and confirmation response; payment and learned-spell updates have not been verified on a disposable live character.

- [x] Trace each proposed destination through ACE handler, permission checks, receive packet, core mapping, and host projection.
- [x] Record send/receive/notification-only status, aliases, availability evidence, current loss points, and deliberate exclusions. Enum membership alone is not evidence of support.
- [x] Reuse authoritative existing membership facts for obvious unavailable destinations. Party uses a cold membership fact, including solo parties; it does not reuse the different HUD-presence flag. Allegiance profiles can be absent or stale independently of chat access, so they do not disable send choices. Do not build a complete permission/eligibility catalog.
- [x] Explain unavailability when supported by existing facts. Otherwise let ACE accept or reject the request; room advertisements do not prove permission or delivery.
- [x] Confirm precise command spellings and tell delimiter rules. Required aliases: `/t`, `/tell`, `/r`, `/reply`, `/rt`, `/retell`, `/ts`, `/tellselected`. The selected-target aliases are agreed product commands. Plan explicit channel aliases from evidence and document intentional product choices.
- [x] Implement the evidenced addressable sender contract and confirm empty-sender notification/self-echo handling. Preserve ambiguous cases without inventing a sender or direction. Extend the shared speaker contract and all destructuring consumers atomically; the host must project addressability rather than re-derive it.
- [x] Locate the Professor of Magic ReceiveTalkDirect content and expected payment confirmation using available ACE data. Record the actual keywords and prerequisites. If content is unavailable, retain deterministic NPC/emote fixtures and state the exact unverified live portion; the wiki description alone is not proof of ACE end-to-end behavior.

Acceptance: every normal picker destination and supported alias has a proven route, all flattened categories have a named UI consumer, and unsupported legacy entries are explicitly excluded.

## Phase 2: Interaction, shortcut, and scrolling

Primary files: `ClientChat.svelte`, input contract/defaults, binding catalog, keyboard settings decoder, relevant input tests, and browser harness fixtures.

- [x] Derive effective history activation from editor focus or explicit history activation. Track actual editor focus without introducing a second keyboard ownership policy.
- [x] Treat the message and new recipient fields as chat editors. When a reader starts interacting with history while editor focus is the only activation source, promote that interaction to explicit history activation before blur can disable hit testing. Scope ownership stays with `KeyboardInputPolicy`; test selection drags, links, and scrollbar gestures across this transition.
- [x] Distinguish explicit interaction mode from keyboard focus. A viewport click returns keyboard ownership to gameplay under existing policy but does not clear explicitly enabled history interaction; Ctrl+C from gameplay toggles that explicit mode and focuses history only when enabling it. Modal focus neither creates nor clears explicit activation. Keep this transition table consistent with the toggle's effective `aria-pressed` state.
- [x] Use that same activation for selection, waypoint links, pointer interaction, toggle state, and active border. Hover may reveal the background but does not claim activation.
- [x] Enclose the entire chat HUD (history, filters, destination, and input) with the distinct themed active border, outside the buffer's fade mask. Use an inset outline so activation does not affect layout and inactive history has no reserved border gap between rows. Reuse theme tokens.
- [x] Add configurable `toggleChatHistory`, default Ctrl+C with Shift/Alt/Meta excluded. Enable in game/history contexts; preserve normal editor input, IME, native copy, and modal isolation. Ignore repeats.
- [x] Ctrl+C copies an existing document selection first. With no selection, gameplay activates history and history focus deactivates it. The button uses the same transition. Turning explicit activation off while the editor is focused leaves effective activation on until editor focus ends.
- [x] Escape from editor clears the draft per existing behavior, ends explicit chat activation, and returns keyboard ownership to game. Escape from history ends explicit activation without disturbing a retained draft. Enter from history focuses the composer explicitly through its existing keyboard owner.
- [x] Add the action to settings labels/context conflict detection. Fill only the missing default when reading older saved maps; retain user overrides and explicit unbound lists.
- [x] Route the toggle through the existing chat scope activation before gameplay; handle deactivation in the history scope. Reflect that specific proven ordering in existing binding conflict reporting without introducing priority registries or rewriting movement modifiers. Competing activation shortcuts still conflict. Keep ordinary C/Shift+C strafe behavior and saved movement bindings. Test defaults, migrated settings, rebinding, press/release quarantine, and no accidental strafe on Ctrl+C.
- [x] Replace activation-based auto-scroll with bottom-follow state. Start following; recompute from real scroll geometry using a named small tolerance. Measure intent before content growth, scroll after DOM updates, and guard queued work against unmounts or later user scrolling.
- [x] Keep following through incoming lines and layout changes when previously at bottom. While active, scrolling upward pauses following and returning to bottom resumes it. Deactivating history immediately snaps to the bottom; inactive history stays bottomed out through new messages and layout changes. Use native browser scroll anchoring while reading older lines; accept browser clamping when filtering or retention removes content.
- [x] Guard follow intent against scroll events caused by the programmatic bottom adjustment. Observe the actual buffer/content layout as needed for resize and font wrapping. Do not add line-ID anchors, nearest-surviving-line selection, or a virtual-list abstraction. Test native behavior first and document any demonstrated deficiency before adding custom anchoring.

Acceptance: real-browser assertions prove editor activation, button/key/Escape transitions, copy precedence, Enter from history, no held-key toggling, modal isolation, and bottom-follow behavior in both active and inactive modes. Browser diagnostics verify behavior; the user judges the border visually.

## Phase 3: Preserve message semantics and add typed sending

Primary files: core `types.rs`, `messages.rs`, `commands.rs`; host `client_contracts.rs`, `client_runtime.rs`, `client_projection.rs`, `protocol.rs`; frontend host contract/lifecycle session and their tests. Touch application snapshot/publication owners only for proven missing transport facts. Also update `ClientApp.svelte`, `ClientWorldView.svelte`, `ClientHudHarness.svelte`, host command admission, and live-client probe payloads. Search all shared event/command consumers before changing variants, including `apps/holtburger-cli/src/pages/game/{input/commands,panels/chat}.rs`, `apps/holtburger-cli/src/scripting.rs`, and corresponding scripting contract consumers if receive identities change.

- [x] Preserve known/unknown server message categories, relevant speech/tell classification, allegiance broadcast identity, and society identity through the consumer boundary. Keep raw unknown IDs in a documented unknown variant so unexpected messages remain visible.
- [x] Resolve specific society identity in core from explicit society chat type, or from known society room ID when the type is generic Society/Undef. Preserve generic Society when the packet provides no specific identity; do not infer the sender's society from the local player's membership. Keep legacy fellowship broadcast as a notification identity distinct from ordinary fellowship messages.
- [x] Keep outgoing tell confirmations classified as outgoing tells without manufacturing a structured recipient. Preserve their server-authored text. Structured local send requests own retell tracking.
- [x] Add explicit core send destinations for allegiance chat versus broadcast. Remove the current semantic fallback; unavailable ordinary allegiance chat must not become a privileged broadcast.
- [x] Replace h3d's string-only chat submission with typed requests mapped to existing core commands. Preserve ACE `@` server-command forwarding through local Talk. Update request validation, session API, and all transport callers together.
- [x] Implement TalkDirect opcode `0x0032`, string-plus-entity-ID codec, GameAction dispatch, and a core entity-addressed tell request. Carry the typed recipient through host and frontend contracts; retain incoming NPC IDs for reply. Reuse the player-name Tell path unchanged for long-distance messaging. Verify packet layout against retail and ACE, and reject expected missing-creature cases through normal feedback.
- [x] Keep this phase compilable by adapting the current ordinary-send caller to construct a typed local request immediately; the picker/parser arrives in phase 4. Receive variants must update the host decoder, presentation, coarse filter mapping, harness fixtures, and exhaustive consumers in the same change. Keep the existing filter storage contract.
- [x] Retain existing combat feedback/outcome coupling, sender classification, and display ordering. Do not duplicate combat lines or lose visual outcome events while changing chat projection.
- [x] Reuse existing session/player facts for picker hints. If negotiated transport availability is missing, project only the minimal core-owned transport fact needed by this picker, recoverable in current state and updated when negotiation changes. Do not publish a parallel destination-eligibility catalog or model all server permissions/listening policies. Core remains responsible for routing and explicit unsupported-route feedback. Do not offer all three society rooms as arbitrary destinations; use the character's negotiated Society destination.
- [x] Project known chat refusals (offline/blocked tell, gag, missing membership/authority, unsupported route) into durable unconditional chat errors once, instead of only transient action feedback. Keep expected core routing refusals on feedback paths; do not return errors that `process_command_batch` interprets as runtime failure. Test this with both Chat and Combat disabled. For generic server Broadcast prose, preserve text/category without guessing whether it is a chat rejection; ACE can deliberately omit rejection detail, which the client cannot recover.

Acceptance: fixtures cover each cataloged category and unknown IDs, both allegiance routes serialize as intended, missing transport produces a clear failure, invalid requests cannot become local speech, and existing combat outcomes still accompany exactly one chat line.

## Steering checkpoint

- [x] Recheck actual contracts against the catalog and remaining picker/parser work. Remove fields without named consumers and reuse existing availability facts.
- [x] Walk Local, Party, Tell, Reply, Retell, restricted channels, failed submission, and character-switch flows end to end. Resolve mismatches before UI work proceeds.
- [x] Review touched shared APIs for a future 3D client and existing TUI consumers. Do not move h3d convenience state into core simply because it crosses a host call.

## Phase 4: Destination picker, commands, and private messaging

Primary files: `ClientChat.svelte`, `ClientApp.svelte`, `client-command-help.ts`, lifecycle/session contract, plus small app-local parser/resolver and session messaging state modules if needed. Reuse `PopupMenu.svelte`, existing editor controls, and the app keyboard policy.

- [x] Replace the inert speech button with a labeled destination picker. Keep one history buffer. The persistent destination defaults to Local and is session-local.
- [x] Offer `Tell selected → <name>` for an authoritative addressable selected player or NPC, using existing selection facts. Selecting it snapshots a player-name recipient or NPC entity-ID recipient; later selection changes do not retarget the conversation. Reuse this same recipient resolver for `/tellselected` and `/ts`. With no valid target, the picker action is unavailable and the slash command produces a clear local error. Keep name-entry Tell available for players. Do not add context menus, nearby-name search, or correspondent suggestions.
- [x] Selecting Tell… opens a chat-local recipient dialog using the shared panel-dialog shell extracted from inventory stack splitting. Keep the completed destination and message draft unchanged until a nonempty player name is accepted; no correspondent list or suggestions.
- [x] Use the existing menu for destination commands, then focus the recipient dialog through the app keyboard policy. Enter commits a nonempty address and returns to the message editor without sending. Escape, Cancel, and backdrop dismissal preserve the prior destination and draft. Trap Tab within the dialog and make its chat background inert. A picker popup's Escape closes only that popup. Typed `/tell ...` commands continue to supply their own recipient.
- [x] Keep the composer on one row: destination picker with its effective label on the left, then the message input. Keep the message input full-width beside the picker; recipient entry happens in the local modal rather than splitting the input. Long labels truncate with their full text available in a tooltip. Changing a picker selection must not rewrite the draft.
- [x] Implement one pure parser/resolver for recognized chat commands, multiword tell recipients and comma delimiter, reply/retell resolution, channel aliases, and incomplete/error states. Reuse its result for preview and send; do not parse twice in separate handlers.
- [x] `/tell Some Player, hello` and `/t ...` always resolve a player-name tell and override this message, even if a selected NPC has that name. `/tellselected hello` and `/ts hello` resolve the current selected player/NPC using the shared selected-recipient resolver and override only this message. Preview the resolved recipient kind. `/reply hello` and `/r ...` use the last incoming addressable player/NPC tell sender. `/retell hello` and `/rt ...` retain the last accepted outgoing recipient's variant and address, including sends through Tell selected or `/ts`. Missing selection, invalid target, and empty body yield distinct local errors.
- [x] The indicator previews the effective resolved destination while a command is present, including incomplete-recipient states. Clearing/submitting restores the persistent destination. Retell and reply never silently update the picker.
- [x] Re-resolve `/reply` preview when the last incoming sender changes, and `/tellselected` / `/ts` preview when authoritative selection changes; on submit freeze the resolved request. A later incoming tell or selection change cannot redirect an already submitted message. The persistent picker recipient stays snapshotted. If that destination becomes unavailable, retain its explicit identity and report why submission cannot proceed; never change it to Local automatically.
- [x] Preserve existing help/death/recall/location/waypoint command behavior in one ordered dispatch path. Recognized malformed chat commands fail locally. Unknown slash commands fail explicitly rather than broadcasting an accidental command as local speech; ACE `@` commands retain server dispatch.
- [x] Snapshot resolved intent before awaiting submission. Update retell only at defined enqueue acceptance and preserve the draft on parse/validation/enqueue failure for correction/retry. After enqueue, clear the submitted draft; later core/server errors appear in history and do not overwrite newer text. Prevent message-history recall while recipient editing. Keep one original submission in sent history at the existing app-owned submission boundary; arrow recall retains manual command text. Picker-based entries recall their original body into the currently selected destination; do not introduce structured sent-history storage or silently restore an old target in this pass.
- [x] Reset reply/retell targets, persistent destination, and in-flight session effects on character/session replacement. Reject late results from an outgoing session.
- [x] Use session object plus character identity/generation to guard asynchronous completions. Do not use world/landblock generation: ordinary teleport/resync must preserve conversation state. Bind ownership to authoritative current-state/lifecycle transitions, including logout/login of the same GUID. Distinguish popup/remount state from session messaging state and clear an outgoing character's pending recipient editor/draft on session replacement without deleting unrelated retained diagnostics.
- [x] Extend `/help` with supported destinations, aliases, multiword tell examples, reply versus retell, and picker override semantics.
- [x] Cover Tell selected and `/tellselected` / `/ts` for both players and NPCs, selection-independent `/tell`, NPC reply/retell, missing/invalid selections, and stale NPC failure in help/tests. Explain that an NPC tell can become the next reply target; users should check the visible destination indicator.

Acceptance: parser tests cover aliases, whitespace, multiword names, incomplete input, unknown slash commands, missing targets, and existing command coexistence. Integration tests prove picker and command sends converge, targets remain independent, failed/late sends do not corrupt state, no duplicate echo is added, and the next plain message uses the persistent picker destination.

Required end-to-end cases (use these to pressure-test the composition, not separate implementations):

| Starting state and action | Expected result |
| --- | --- |
| Party selected; `/t Some Player, hello`; enqueue succeeds | One typed Tell request, retell becomes Some Player, persistent Party remains selected, server echo retains outgoing-tell classification |
| Party selected; `/r hello`; another tell arrives after submit | Submitted recipient stays frozen; next reply preview follows the new incoming sender |
| Tell recipient dialog opened, then canceled | Prior completed destination and draft survive; no message is sent |
| Tell selected; `@servercommand args` | Existing local-command recognition runs first, otherwise one Local Talk request forwards the literal server command |
| Input focused; pointer drag starts in history | Selection completes despite editor blur; history remains explicitly active and preserves its scroll position |
| History active, text selected; Ctrl+C | Native copy wins; history stays active; no gameplay strafe press leaks through |
| Last tell target set; enter portal/resync versus logout/login of same character | Portal/resync preserves targets; a new character session clears them even if GUID is unchanged |
| Host enqueue succeeds, core route later refuses, all filters off | Draft was accepted/cleared; one durable local refusal remains visible; no disconnect or invented delivery confirmation |
| Professor selected; choose Tell selected; submit `level 1` | One TalkDirect packet targets the snapshotted professor ID; its response is shown as an NPC tell; existing confirmation UI can present the payment prompt |
| NPC sends a tell; submit `/r level 1`, then `/rt level 2` | Reply and retell both use that NPC entity ID, with no player-name lookup; preview identifies the NPC |
| Professor selected; submit `/ts level 1` or `/tellselected level 1` | Resolver produces the same entity-addressed request as the picker; persistent destination is unchanged and later selection changes cannot redirect the request |
| Player selected; choose Tell selected or submit `/ts hello` | Resolver snapshots the player's send-address name and uses normal Tell; `/rt` retains that player recipient even if selection changes or the player leaves the area |
| Selected NPC name used in `/tell <name>, level 1` | Request remains player-name Tell; selection does not silently convert it into TalkDirect |
| No selection, non-addressable object selected, or empty `/ts` body | Distinct local validation error; no packet, destination change, or retell-target update |
| NPC target disappears or player leaves its landblock | Request fails visibly; no name-based substitution, local-speech fallback, or silent retargeting |

## Phase 5: Receive presentation within existing filters

- [x] Keep the two existing Chat/Combat controls and their saved schema. The channel catalog informs a future filter UX; implementing that redesign is deferred.
- [x] Keep direction and channel labels readable without color. Incoming/outgoing tells have distinct labels; allegiance broadcast is visibly distinct from ordinary chat; society labels retain actual identity.
- [x] Extend the existing pure coarse-filter policy for the new message variants: conversation messages, including outgoing tells, follow Chat; combat, Magic, and Spellcasting follow Combat; other server feedback/notifications and local errors remain unconditional. Reuse the shared `ui-filter-pill` style for both controls without changing their persisted values. Preserve the finer category in the message contract for labels and tones. Unknown channel messages follow Chat, while unknown server text types remain visible as feedback. Outgoing tells intentionally become Chat-filtered rather than unconditional System lines.
- [x] Keep filter state independent from send destination. Selecting a destination must not silently alter filters. Incoming tells update reply state before display filtering. Do not introduce per-channel filter keys or hidden-destination indicators in this pass.

Acceptance: preserved categories have distinct appropriate labels/tones, the existing Chat/Combat settings still load unchanged, filters do not affect routing or reply state, errors remain visible, and filter changes do not force a reader to the bottom.

## Phase 6: Cleanup and verification

- [x] Remove the string-only send path, activation-based scrolling, stale generic channel labels, and duplicate parsing. Keep the existing coarse filter model. Update touched tests rather than preserving dead contracts.
- [x] Review line-count growth: keep protocol additions limited to proven missing wire facts; keep parser, session convenience state, and UI responsibilities focused. Prefer deleting duplicate branches over adding adapters.
- [x] Run appropriate frontend scripts from `apps/holtburger-3d`: `npm run check`, `npm run test:ts -- <focused test files>`, `npm run lint:ts`, `npm run lint:dead`, and formatting checks for changed frontend files.
- [x] Run targeted Rust tests for touched core/protocol/host behavior and `cargo clippy` for touched packages with `--all-targets -- -D warnings`; check formatting using the repository's existing tooling.
- [x] Use `npm run harness:browser -- ...` with synthetic chat fixtures for DOM focus, copy, picker keyboard handling, appending, filtering, resizing, retention, and session teardown. Extend the harness where necessary. Retain no tests depending on untracked runtime assets.
- [x] Start with the existing `--client-hud` fixture and `scripts/client-hud-probe.mjs`; wire the new parser/session messaging owner into the harness instead of testing only a lookalike `ClientChat` stub. Existing waypoint, keyboard, and sent-history probes must remain meaningful after prop and message-shape changes. Verify focus/DOM geometry and request captures without performing visual acceptance or requiring production assets.
- [x] Verify transport routing with deterministic packet fixtures. If live interoperability is needed, use a focused harness against an explicitly available ACE test environment; do not run the TUI or send unsolicited messages to real players/public channels.
- [x] Exercise the professor conversation in synthetic fixtures through TalkDirect, NPC Tell, and the existing confirmation request/response path. If suitable ACE content and a test character are available, verify the actual prompt, acceptance, payment, and learned-spell updates. Do not claim a completed purchase based only on a correctly serialized packet; report any missing prerequisite explicitly.
- [x] Provide the user a short visual acceptance checklist for active border, picker/recipient layout, command preview, category labels/colors, and scroll behavior. Report automated behavior evidence separately from user visual acceptance.

## Risks, concessions, and definition of done

| Risk | Mitigation / accepted limit |
| --- | --- |
| Ctrl+C conflicts with copy | Native selection copy wins; editor behavior and modals remain isolated; test both selected and unselected history |
| Incoming messages arrive during scrolling/layout changes | Preserve pre-update follow intent and use native anchoring; browser clamping after removed content is accepted; verify actual DOM behavior |
| Server confirmations lack structured recipient | Preserve category/text, track local request recipient independently, never parse prose or guess echo correlation |
| Allegiance transport fallback changes meaning | Use distinct send intents and explicit unavailable errors |
| Restricted channel permissions are incomplete locally | Use authoritative facts where available; display server rejection without pretending transport acceptance is delivery |
| Broad shared contract changes affect TUI/combat | Search all consumers and test representative projections and combat outcomes during the cutover |
| New shortcut invalidates saved settings | Add only the missing action default; test Electron load/save while preserving overrides, unbound choices, and existing filter values |
| Enqueue acceptance is mistaken for delivery | Retell tracks accepted local intent; preserve later failures as history; no delivery badges or echo correlation |
| Displayed sender names are not send addresses | Use the evidenced core-owned address for reply; keep ambiguous senders visible and non-addressable |
| NPC identity is discarded or silently changed | Preserve entity ID in the recipient variant; server validates reachability; selection changes never mutate an established target |
| NPC tells replace the prior player reply target | Explicit product policy: latest addressable teller wins; visible preview shows player/NPC recipient; retell remains independent |
| Editor blur disables history mid-selection | Promote deliberate history interaction before focus transfer; real-browser drag/link/scrollbar assertions |
| Phase boundaries leave exhaustive consumers broken | Phase 3 updates the current local sender and all receive consumers; filter storage stays unchanged |

Done means all phases' acceptance criteria pass, no unsupported destination is advertised as usable, classification survives the full receive path, picker/manual commands share one resolved submission path, player and NPC recipients retain their correct transport identity, reply and retell remain independent, active-at-bottom history always follows, required checks pass without warnings, and visual review is clearly handed to the user. Professor purchase evidence must distinguish synthetic interaction coverage from a verified live purchase.

## Open questions and implementation decisions

No additional product decision blocks implementation. Channel routes, aliases, sender-name normalization, NPC addressing, and the professor content path are resolved above. Staff-only picker entries and broader eligibility/filter UX remain deferred as agreed.

Remaining acceptance is the user's visual pass. A real professor purchase additionally needs a suitable disposable character with the required skill and payment; synthetic evidence does not establish that purchase.

## Implementation decisions and verification record

- Frontend command syntax, picker destination, reply/retell convenience, and keyboard/scroll policy remain app-local. Core owns structured speaker addresses, distinct channel semantics, and Tell versus TalkDirect routing. Protocol owns only the proven TalkDirect codec addition.
- No extra negotiated-availability contract was added: core already owns negotiation and emits a durable failure for missing routes. The picker advertises supported destinations, not guaranteed permission or delivery. Party membership gets the existing-fact hint described above; ACE remains authoritative for other restrictions.
- Shared receive changes required mechanical TUI and scripting consumer updates. TUI UX was not redesigned. The ordinary-allegiance-to-privileged-broadcast fallback was removed.
- `ClientChatComposer` owns character-session targets and a generation; the keyed editor resets transient draft/recipient state on session replacement. Portal/resync does not retire conversation targets. Late completions cannot update the replacement session.
- Native scroll anchoring remains responsible for older text. A browser regression exposed a queued-scroll race: reaching the bottom immediately before a message could leave following paused. Capture old DOM geometry before the update and acknowledge that scroll position so its delayed event cannot overwrite the captured intent.
- Quality cleanup removed unused exports, the unused app-command text copy, and parallel indexed help arrays. No nested filters, correspondent suggestions, context menus, generic command framework, or custom line anchoring were introduced.
- Full frontend suite: 369 files / 3,244 tests passed before the final scroll adjustment; focused reruns and final static checks follow below. Rust unit suites passed for host, CLI, core, protocol, and scripting (371 / 318 / 665 / 298 / 7 tests before the two additional projection tests). Loopback-dependent Rust tests require execution outside the socket-restricted sandbox.
- Full HUD verification initially found a pre-existing raw-whitespace comparison in the unchanged action-bar menu probe. Normalize visible menu labels in that probe rather than changing the production menu. The full HUD rerun passed after that probe correction (three intentional fixture-artwork warnings).
- Professor evidence is synthetic browser interaction plus local ACE content inspection and deterministic packet verification. No disposable live character was established for a purchase; payment and learned-spell updates are not claimed as verified.

Final static verification: `npm run check` reports zero Svelte errors/warnings; `npm run lint:ts`, `npm run lint:dead`, targeted frontend tests (110), Prettier on changed frontend files, `cargo fmt --all --check`, and clippy for all five touched Rust packages pass. The two added host projection tests pass. The final keyboard/chat browser suite passes with no page console errors, including the queued-scroll race, filtering/retention, native text dragging/copy, membership hints, and professor confirmation response.

User visual acceptance checklist:

- Active border is distinct and stable when focusing the message/recipient editors or toggling history with Ctrl+C.
- Picker and recipient editor fit the HUD; changing destinations preserves the draft, and previews distinguish player versus NPC tells.
- Combined-history channel labels and colors are readable, including party notices, allegiance broadcast, and outgoing tells.
- Bottom-following feels right during new messages and resize; reading older lines stays undisturbed.

Full HUD integration: `npm run harness:browser -- --client-hud --brief` passed client HUD, connection badge, inspection, targeting, precise jump, theme, inventory/action bars, and keyboard policy checks. The focused `--client-keyboard` run also passed the new chat-composer assertions with no page console errors. No visual acceptance was performed.

Final acceptance audit:

- `--client-waypoint` passes 30 controller assertions plus native coordinate-link activation/selection, clipboard, map, book, inspection, inscription, and contract checks; browser errors are empty. History Enter hands off only from the buffer itself, preserving a focused link's native Enter behavior.
- Updated waypoint probes assert the new failed-draft preservation and Escape-ending-history policies, including successful correction/retry. They do not retain the old destructive input expectation.
- The final `--client-keyboard` suite also proves native scrollbar dragging from editor-focused chat, persistence after editor blur, ordinary text dragging, bottom-following after fitted-history retention and resize, and the queued-scroll regression. Its page console contains only Vite connection messages. The older waypoint double-click-and-drag extension diagnostic remains false in this headless browser; ordinary native drag and selection/copy pass.
- Final code-quality verdict: ready within the reviewed scope. No unresolved contract, ownership, or lifecycle finding remains. Remaining user review is visual; live professor payment and learned-spell updates retain the explicitly stated verification limit.
- No files were staged or committed. Pre-existing untracked submodule content was left alone.

## Recipient modal follow-up

- Replaced the split recipient/message input with a chat-local recipient prompt. The main composer stays on one row with its full message field. Acceptance changes only the destination; cancellation retains the previous destination and draft.
- Extracted `UiPanelDialog` from inventory quantity entry and reused it for chat, inventory splitting, and vendor quantities. The shell owns local backdrop/Escape dismissal and keyboard traversal; each feature owns its fields, submission, and focus restoration. App-wide dialogs retain their existing `UiDialog` policy.
- Removed the now-unused nullable picker destination and its inline-editing validation branch. Manual tell commands still validate their own recipient syntax.
- Verification: recipient modal keyboard/browser checks, 16 parser tests, static type checks, ESLint, dead-code checks, and formatting pass. Inventory drag/split checks completed successfully before the full HUD run stopped on the item-use target eligibility cursor assertion. The separate binding-controls/vendor browser suite passes, including quantity acceptance, cancellation, and source-focus restoration. The full HUD run is therefore not claimed as passing for this follow-up.
- Visual acceptance remains with the user.

## Final accumulated-diff quality review

Baseline: repository HEAD versus all tracked and new files for the chat feature. The ACE and ACViewer submodules contain pre-existing untracked files and are excluded from the commit.

Verdict: ready within the reviewed scope after fixing the browser-probe state leak below. No unresolved production code-quality finding. Updated superseded scroll/filter wording above.

Seam coverage:

- Traced protocol Tell and channel receipt through core speaker/channel interpretation, host projection, frontend decoding, session publication, composer reply state, retained history, filtering, labels, and tones. Unknown category/channel namespaces and NPC reply IDs survive these adapters.
- Traced picker/manual command resolution through preview, frozen submission, typed host validation, core channel/Tell routing, and protocol encoding. Reviewed enqueue failure versus later durable refusal, independent reply/retell state, and character-session resets and stale completions.
- Inspected the mechanical TUI/scripting consumers of the changed shared contracts, shortcut defaults and persisted-settings migration, membership versus HUD presence publication, and host request/probe fixtures.
- Reviewed chat focus/keyboard ownership and bottom-follow lifecycle, plus shared panel-dialog shell and its inventory/vendor quantity consumers. Panel-local and app-wide dialogs retain distinct lifetimes and scope.

Confirmed finding and fix: the chat browser probe uses native viewport clicks, which change the harness entity selection. It reset composer state but left the selected entity visible for later HUD probes. Added cleanup through the existing `resetSelectionFixture` owner in the probe’s `finally` block. Acceptance is a full HUD run with the original empty runtime selection inventory, without weakening its assertions.

Consolidation decisions: keep frontend channel definitions shared by picker, parser, and help; retain separate send destinations and receive identities because notifications/unknown IDs are not sendable. Shared panel dialogs own chrome, cancellation, and traversal while feature owners retain fields, submission, and focus restoration. Pill styling already has one shared CSS implementation; no forwarding component or general command/shortcut framework is needed. No temporary production diagnostics were introduced.

Verification: 369 frontend test files / 3,246 tests and all five affected Rust package library suites / 1,661 tests pass. Frontend type checks, ESLint, dead-code checks, Rust formatting, and clippy for all affected packages pass. Recent focused keyboard/chat and vendor browser suites pass, including recipient modal, active reading position, inactive bottom snapping, filter toggles, and focus restoration. Full HUD integration result is recorded below.

Limits: no live professor payment/learned-spell acceptance was exercised; professor interaction evidence remains deterministic codec checks, ACE source/content inspection, and synthetic confirmation flow. No agent visual acceptance was performed.

Final full HUD rerun: `npm run harness:browser -- --client-hud --brief` passes HUD, connection badge, inspection, targeting, precise jump, theme, inventory, and keyboard policy checks after the fixture cleanup. Three expected synthetic-artwork/theme-fixture warnings remain. The earlier item-target cursor assertion did not recur on either review run; no production targeting change was made.
