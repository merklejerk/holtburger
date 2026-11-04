# Writing for the Holtburger website

The website introduces the clients and helps players use them. Lead with h3d and
active play; give the TUI a substantial gameplay and automation identity.

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

Prefer “Press N to cycle through kneeling, sitting, lying down and standing” to
an introduction about posture systems. Teach Smart Tab first, then explain the
situations where clicking or a dedicated selector is useful.

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

The preparation script produces route metadata and heading links. Generated files
are ignored. Keep each topic canonical; tours link to task guides and task guides
link to precise reference entries. Separate 3D and TUI chat command references.

Explain project origins on the design page. Keep the shared footer functional;
do not repeat the project pitch in hero labels, sidebars and footer copy.

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

Media IDs and capture briefs live in `src/lib/media/catalog.ts`. Place a capture
with the `Media` component in Markdown; reuse its ID across tours and guides.
Planned entries render a screenshot/clip label and brief. Replace the catalog
entry with an external image URL and dimensions, or a `youtube` entry with its
video ID, when the capture is ready. YouTube players load after a deliberate
click; screenshots link to the full image. Gallery selections use the same catalog.
Do not use dummy video IDs or present a planned capture as working footage.

## Work locally

From `site/`:

```sh
npm ci
npm run dev
npm run check
npm run build
npm run preview
```

The production preview serves `site/build/` at
`http://127.0.0.1:4178/holtburger/`, including generated Pagefind search.
`npm run check:browser` uses an installed Chrome and the running preview. Override
`CHROME_PATH`, `SITE_PREVIEW_URL` or `SITE_CAPTURE_DIR` as needed. Browser captures
stay outside Git. Format with `npm run format`; check with
`npm run format:check`.

## Publication

The public destination is [merklejerk.github.io/holtburger](https://merklejerk.github.io/holtburger/).
The current implementation is a partial preview; the full content inventory
remains in progress. Check the workflow run and public pages to confirm which
revision is live.

`.github/workflows/promote-updates.yml` is the sole website and update-feed
publisher. It runs for relevant pushes to main, release publication and manual
dispatch, always checking out trusted main. It installs the site lockfile, checks
formatting/types, builds the site and Pagefind, and checks local links/assets and
anchors. The feed generator then writes only `build/updates/`; it cannot replace
Home. One Pages artifact contains both website and feeds. Any failed build,
validation or feed generation prevents publication.

For a local publication check, run `npm run format:check`, `npm run check`,
`npm run build`, and `npm run check:links`, in that order. With the production
preview running, use `npm run check:browser` for desktop/mobile, search and
reading/navigation without JavaScript. Feed tests run from the repository root:

```sh
uv run --with-requirements .github/scripts/requirements.txt python -m unittest discover -s .github/scripts -p 'test_promote_updates.py' -v
```

After publication, check Home, a guide deep link, Gallery, search and
`updates/beta.json` at the public project URL. A successful local build does not
prove the public deployment is current.

The current implementation is an early visual review. The full guide inventory,
installation-source reuse, complete reference, media publishing and combined
website/update-feed deployment remain in the master plan under `local/plans/`.
Do not create a second Pages deployment that overwrites the existing update feed.
