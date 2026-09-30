# H3D Book Reader Plan

## Context and boundaries

**Goal:** Open a book through ordinary item use and read its complete text in one scrolling H3D HUD window.

The reader displays one book at a time. Opening another book replaces it. It waits for all page text before displaying the document. This slice includes book attribution, loading and failure states, and retained HUD placement. It excludes book and inscription authoring, page navigation controls, book history, and changes to the existing item-inspection inscription display.

## Ground truth and design

- `ACE/Source/ACE.Server/WorldObjects/Book.cs`: ordinary Use sends the full book response. `Player_Book.cs` handles explicit page requests. `GameEventBookDataResponse.cs` can include or omit page text and writes capacity into both page-count header fields.
- `acclient-eor-source/acclient.c:227930`: retail requests text when a page lacks it. `acclient.c:228210` uses `ignoreAuthor` for edit permission; it does not mean that the author must be hidden.
- `crates/holtburger-protocol/src/messages/book/` already decodes full and page responses and packs page requests. `crates/holtburger-world/src/book.rs` retains pages by index. Core already sends `ClientCommand::ReadBookPage` and forwards book updates to client views.
- H3D currently drops `EntityBookUpdated` in `client_projection.rs`. Existing `ClientHudWindow`, `ClientObjectInspection`, the lifecycle session, and versioned HUD settings provide the integration patterns.

Keep book facts in world and the existing request in core. The host projects a narrow book read contract. H3D owns window state, loading, concatenation, and display. Reuse the existing direct item-use flow; the server's full book response opens the reader. Do not add a separate `BookData` request for initial reading.

The document uses the response's actual ordered page entries, not `num_pages` or `max_num_pages` as a count of readable entries. `null` text means a missing page that needs a request; an empty string is a loaded blank page. Book and page authors remain distinct. Treat book text as plain text and preserve line breaks; never interpret it as HTML or Markdown.

### Flow and contract

```text
Existing direct Use -> server BookDataResponse
  -> world stores BookData and emits EntityBookOpened { guid, name, book }
  -> core forwards receipt -> host projects book-opened -> H3D reader opens/replaces
  -> H3D requests each missing page through ReadBookPage
  -> world merges BookPageDataResponse and emits EntityBookUpdated
  -> host projects book-updated -> H3D reader accepts matching pages
  -> all text present -> one scrollable document
```

Use separate full-book and page-update events because a page reply must not reopen a closed window. The host event carries the book GUID, title, ordered page indices, optional text, page author names, book inscription, and book author name. It does not expose account names, editing flags, or capacity fields. The page request carries current player identity, book GUID, and page index; core rejects a player mismatch before sending the wire action because it owns the authoritative active character. Keep the existing entity book state and TUI presentation functional after the event split.

## Phased implementation

### Phase 1: Shared receipts and host transport

1. In world/core, emit and forward `EntityBookOpened` for a full response and reserve `EntityBookUpdated` for page responses. Capture the book title from the entity that accepted the full response. Update the TUI to apply either event to its existing entity book state.
2. Project both events into narrow, typed host events in H3D. Add a typed page-request command and route it to core's existing `ReadBookPage` command with active-character validation in core. Wire protocol serialization, command/event allowlists, the TypeScript transport contract, and lifecycle-session decoding/methods.
3. Test full versus page provenance, command identity checks, transport decoding, and TUI continuity. Each changed crate and app should compile after this phase.

**Acceptance:** the frontend can distinguish a book opening from a page update, and can request a page without adding a second book protocol implementation.

### Phase 2: H3D reader owner

1. Create a session-owned reader controller with `idle`, `loading`, `ready`, and `failed` states. Full-book receipts open or replace the current book. Page updates affect only the active loading book. Closing, replacement, character change, or session disposal cancels timers and queued requests; late page updates for inactive books are ignored.
2. Request missing pages once each in ascending index order, one outstanding at a time. Show `Loading pages X of Y`. Once all listed pages have text, publish the complete book. No requests are needed when the initial response already includes all text.
3. Give each requested page a configurable ten-second timeout. Send failure or timeout enters a visible error state with **Retry**; retry requests only pages still missing. Do not retry automatically.
4. Retain a completed book independently of current selection and entity visibility until close or replacement. Reopening the same book accepts a fresh full response. A full response is the authoritative open signal; the wire format has no client request generation with which to distinguish repeated requests for the same book.

**Acceptance:** focused controller tests cover embedded and deferred text, blank and empty books, ordered assembly, retries, replacement, close, duplicate updates, late updates, and session teardown.

### Phase 3: HUD presentation and settings

1. Add `ClientBookWindow` using `ClientHudWindow` for dragging, resizing, focus, Escape, and close. Opening/replacement brings it forward and resets scroll. The title is the book's entity name.
2. Add one `book` placement to HUD defaults/layout and migrate the existing versioned settings schema so saved layouts preserve all prior placements. Default to a centered 480 × 560 window with a 300 × 240 minimum; use the existing viewport-fitting behavior.
3. Render one scrolling document with page breaks represented by spacing, not pagination controls. Preserve line breaks. Place each nonempty page author below that page, and a nonempty book inscription/signature after the pages. Show an explicit empty-book message if there is no readable text. Loading and failure views occupy the same window; partially fetched text remains hidden.

**Acceptance:** settings migration tests pass, and the browser harness demonstrates open, complete text, empty book, loading/error/retry, replacement, and close through the actual host-to-HUD path. Visual acceptance remains user-owned.

### Phase 4: Cleanup and verification

Remove obsolete event assumptions and update affected fixtures and docs. Keep document assembly in H3D rather than duplicating a book cache in the host or building presentation strings in shared crates. Run affected Rust and TypeScript tests, H3D type checks, format checks, and lint with Clippy warnings treated as errors. Use synthetic harness data when runtime book assets are unavailable; do not retain tests that depend on unchecked runtime assets.

**Done when:** ordinary Use opens the reader; every listed page loads before its text appears; attribution and blank pages are represented correctly; close/replacement cannot be undone by late page updates; persisted layout upgrades correctly; required checks pass.

## Risks and concessions

- ACE puts capacity in the `numPages` field. Using the page array avoids phantom page requests.
- ACE generally supplies page text in the full response, while the retail path can defer it. Exercise both paths in tests; do not assume all text is present.
- The protocol has no request generation. A delayed full-book response is treated as a new open event. Page responses are correlated to the active book and cannot reopen it.
- The current page decoder assumes ACE's extended page flags. Retail also accepts an older encoding; support for that encoding is a separate protocol compatibility change, since ACE emits the supported form.

## Open questions

None. The single-window and load-before-display choices were confirmed with the user.

## Execution record

- [x] Phase 1: full-book and page-update events reach H3D; core validates page-request character identity; TUI applies both event kinds.
- [x] Phase 2: one session-owned reader fetches missing pages, retains complete text, and handles timeout, retry, close, replacement, and lifecycle changes.
- [x] Phase 3: the scrolling book window uses the existing HUD window behavior. Its initial v13 placement migration was superseded by the independent `book` placement entry in the settings collection cutover. The focused browser harness verifies loading, complete text and line breaks, attribution, drag, resize, close, empty books, failure, and retry.
- [x] Phase 4: affected Rust and frontend tests, type checks, format checks, and lint passed. The full Rust library suite passed with loopback access. The broader client HUD harness currently stops in its existing action-bar probe before reaching the book probe; `--client-book` runs the book checks independently.
