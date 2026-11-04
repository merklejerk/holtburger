# Writing for the Holtburger website

The website introduces the clients and helps players use them. Lead with h3d and
active play; give the TUI a substantial gameplay and automation identity.

## Audience and emphasis

Assume the primary reader knows retail AC. Get them through h3d startup and into
play quickly. Before writing a feature, compare the player workflow with retail
and common Decal use: major changes deserve a benefit-led explanation, small
changes a short note, familiar behavior concise instructions. Avoid basic MMORPG
primers, duplicate keymaps, input-ownership explanations and diagrams for trivial
controls. TUI setup and reference belong in its own secondary section.

## Voice

Be pithy, concrete and welcoming. Put the useful fact or action first. Keep
paragraphs short. Prefer steps for sequences and tables for lookups.

Use familiar AC terms, defining them briefly where needed. Respect retail muscle
memory: explain new controls without calling old workflows wrong. Humor belongs
mostly in branding and occasional showcase copy. Instructions and reference stay
precise.

| Page            | Job                                           |
| --------------- | --------------------------------------------- |
| Showcase        | Demonstrate a reason to try the client        |
| Tour            | Give a short path through useful capabilities |
| Task guide      | Help the reader complete a task               |
| Reference       | Answer a specific question quickly            |
| Troubleshooting | Start with the symptom and remedy             |

Explain philosophy on its canonical page. Link to it instead of repeating a
manifesto. Avoid padded introductions, repeated pitches, implementation essays and
closing recaps. Preserve consequential limitations and exact syntax; brevity is
not permission to omit what a player needs.

Tables own keybindings; prose explains purpose, choices and workflow. Do not
restate a table in the following paragraph. A binding can appear in a task step
when it helps the reader perform that step. Explain what resting achieves before
listing its postures. Teach Smart Tab first, then situational selectors.

Let concrete workflow benefits carry the comparison with retail: quicker target
changes, saved gear swaps, less panel hunting. Avoid unsupported superiority
claims and repeated declarations that the UX is different. Keep a caveat when it
changes a decision, prevents item loss, or explains a real migration limitation;
omit speculative reassurance and implementation distinctions.

## Evidence and product boundaries

- Check the implemented workflow and beta availability before describing it.
- Distinguish retail behavior, common plugin workflows and Holtburger behavior.
- No unsupported uniqueness, superiority, plugin parity or profile-import claims.
- h3d prioritizes active play. The TUI suits automation. Neither is a judgment
  about how people play; future h3d scripting is direction, not current support.
- Publish beta download calls to action. Mention nightlies only where necessary
  for support or development.
- Keep implementation details in developer material unless they explain a useful
  player decision. Describe what players see, press or change, rather than scene
  geometry, eligibility rules, server authority or input ownership. Include a
  limitation when it changes their next step; omit speculative warnings and
  caveats about internal machinery.

## Content and presentation

Prose lives in `src/content/`, grouped by route section. Files are Markdown
compiled with mdsvex and can import Svelte components when needed. Every guide
requires `title`, `description` and `section` frontmatter. The layout renders its
H1 from the title; begin the body with H2 sections.

The preparation script renders the six installation pages from
`release/quickstarts/{3d,cli}/{linux,win32,darwin}.md`, adding website metadata and pointing 3D connection steps to the canonical web
onboarding. Bundled source instructions remain self-contained. Edit those release sources to change installation
instructions; do not edit generated files under `src/content/start/3d/` or `src/content/tui/install/`.
Generated Markdown and its build copies stay ignored. Bundled quickstarts remain
standalone, including their factual channel/update notes. Older archives retain
their release-time quickstart; the site follows the maintained release sources.

Runnable script examples live in `examples/`, are embedded in guides using raw
imports, and are copied for download by asset preparation. `npm run check:examples`
checks those same files against the scripting crate's declaration file. Edit the
canonical examples rather than maintaining separate snippets. The site publishes
the existing declaration file without inventing another API type model.

`npm run dev` watches authored pages, release quickstarts, the media catalog,
`authoring/captures.json`, and reused assets. It refreshes metadata/headings,
generated quickstarts and copied assets without a restart. Generated-file changes
do not feed back into preparation. Invalid source metadata is reported in the dev
server and browser error overlay.

Guide sidebars show the same chapters in the same order on every guide; only
the current chapter opens by default. Do not hide chapters based on the route.

The preparation script produces route metadata and heading links. Generated files
are ignored. Keep each topic canonical; tours link to task guides and task guides
link to precise reference entries. Separate 3D and TUI chat command references.

Pages are prerendered HTML and use normal browser navigation, including screenshot
links and browser history. The HTML shell disables SvelteKit's client-side link
routing; Svelte still hydrates search, theme switching and media controls.

Explain project origins on the design page. Keep the shared footer functional;
do not repeat the project pitch in hero labels, sidebars and footer copy.

The [capture handoff](CAPTURES.md) is generated from
`authoring/captures.json`, catalog IDs and actual page placements. Add the capture
owner, session, setup, framing and expected result there when adding a planned
entry; preparation rejects missing briefs or unused placements. See [MEDIA.md](MEDIA.md)
for snapshot publication, processing and hosted checks.

Take inspiration from Traveler’s Kit: leather, stitching, copper fittings and
field-guide layouts. Use recessed stitched seams for structural dividers, copper
moulding and nailheads for screenshot mounts, and raised fittings for buttons.
Prefer continuous sections and useful contents lists over feature-card grids and
oversized slogans. Keep body text, commands and tables
easy to read in both dark and light themes.

New media must remain outside the main repository. Existing README screenshots
and branding are reused during asset preparation. Each proposed screenshot or
clip needs a capture brief: purpose, setup, framing, actions, expected result,
owner and destination. User captures come at the end. Guides must remain useful
without optional media. During site development, insert a labeled capture placeholder
where a screenshot or clip is planned so placement and scope can be reviewed.

Prefer tight component crops beside the relevant instructions. Use a still to
identify a control or read a panel; use a short clip for one interaction or state
change. Keep enough surrounding context to orient the reader, and preserve readable
text at the displayed size. Reserve full gameplay frames for spatial tasks or
layout overviews. Existing showcase screenshots belong on the home page and in
the gallery; guide placements need captures framed for the task being explained. Place compact media with `<Media id="..." detail />`; it fits
within the reading column without stretching a small component across the page.

Media IDs and capture briefs live in `src/lib/media/catalog.ts`. Place a capture
with the `Media` component in Markdown; reuse its ID across tours and guides.
Planned entries render a screenshot/clip label and brief. Replace the catalog
entry with an image's `remote` source URL and dimensions, or a `youtube` entry with its
video ID, when the capture is ready. YouTube players load after a deliberate
click; screenshots link to the full image. Gallery selections use the same catalog.
Do not use dummy video IDs or present a planned capture as working footage.

## Work locally

Use Node.js 24.13.1 or newer for the website. From `site/`:

```sh
npm ci
npm run build
npm run dev
npm run check
npm run preview
```

Use `npm run dev` for automatic reload during editing. Search uses the last
production index; rebuild when you want search results to reflect new content.
The initial build supplies that index. `npm run preview` serves a fixed build
without automatic reload.

The production preview serves `site/build/` at
`http://127.0.0.1:4178/holtburger/`, including generated Pagefind search.
`npm run check:browser` uses an installed Chrome and the running preview. Override
`CHROME_PATH`, `SITE_PREVIEW_URL` or `SITE_CAPTURE_DIR` as needed. Browser captures
stay outside Git. Format with `npm run format`; check with
`npm run format:check`.

## Publication

The public destination is [merklejerk.github.io/holtburger](https://merklejerk.github.io/holtburger/).
Check the workflow run and public pages to confirm which revision is live.

`.github/workflows/promote-updates.yml` is the sole website and update-feed
publisher. It runs for relevant pushes to main, release publication and manual
dispatch, always checking out trusted main. It installs the site lockfile, checks
formatting/types, builds the site and Pagefind, and checks local links/assets and
anchors. The feed generator then writes only `build/updates/`; it cannot replace
Home. A single job publishes one Pages artifact containing website and feeds.
Media is published separately; no remote media or publisher tests gate deployment.

For a local publication check, run `npm run format:check`, `npm run check`,
`npm run build`, and `npm run check:links`, in that order. With the production
preview running, use `npm run check:browser` for desktop/mobile, search and
reading/navigation without JavaScript. Feed tests run from the repository root:

```sh
uv run --with-requirements .github/scripts/requirements.txt python -m unittest discover -s .github/scripts -p 'test_promote_updates.py' -v
```

Use localhost for iteration and visual review; rebuild after edits when using the
production preview. Publish reviewed batches rather than waiting on Pages during
local iteration. Feed tests above are maintainer checks, not deployment steps.

After publication, check Home, a guide deep link, Gallery, search and
`updates/beta.json` at the public project URL. Changes to the quickstart sources also trigger publication.
A successful local build does not
prove the public deployment is current.
