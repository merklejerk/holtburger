# Website media

Keep existing README screenshots in `assets/screenshots/`. New screenshots,
posters, diagrams and short clips are published from the separate
`merklejerk/holtburger-media` repository. Longer clips use YouTube.
Neither developers nor website CI clone the media repository. The site uses
published URLs. Keep originals and the complete current publishable library in
your own storage; the snapshot repository is delivery storage, not a backup.

## Add a capture

1. Use the capture ID and placement in [CAPTURES.md](CAPTURES.md).
2. Export a readable WebP image, or a short H.264 MP4 with `yuv420p` and fast-start
   metadata. Give clips a poster. Use captions when speech/audio carries instructions;
   silent visual demonstrations can use `captions: null` and explanatory guide text.
3. Give new or changed files a descriptive revision name, such as
   `3d/smart-tab-v1.mp4` and `3d/smart-tab-v1.webp`. Do not overwrite published bytes
   under an existing filename.
4. Add those files to the **complete current library folder**, retaining existing
   files. Publish the media, then replace the planned catalog entry with its
   published image/video/YouTube entry in `src/lib/media/catalog.ts`.
5. Run website checks and publish the website. Check the actual page and playback.

Native clips start muted, show native controls, and use `preload="none"`.
YouTube players load after a deliberate click; their ordinary YouTube link also
works without JavaScript. Planned captures render labeled briefs in place.

For an image, `source: { kind: 'remote', url: 'https://…' }` points at published
media. Supply alt text and pixel dimensions. A `video` entry requires `src`,
`poster`, dimensions, and `captions` (null for a silent demonstration, or an object
with `src`, `language`, and `label` for a VTT track). A `youtube` entry uses its
11-character `videoId`. Keep capture IDs stable when replacing placeholders.

## Publish a complete snapshot

From `site/`, first review the dry run:

```sh
npm run media:publish -- /absolute/path/to/current-library
npm run media:publish -- /absolute/path/to/current-library --publish
```

The target is fixed in `scripts/media-snapshot.mjs`: the dedicated repository's
`main` branch. There is no command-line option that can target the application
repository. Publication requires GitHub CLI access, Git push access, and a Git
author identity. The repository must be public and Pages must serve `main` at `/`.
Initialize it without a README, tags, or other branches.

The tool inventories every supported file, validates hashes, sizes and site
references, then uses a fresh temporary Git repository to publish **one new root
commit**. The temporary snapshot has local author/signing configuration only;
snapshot commits are unsigned. Tooling stays here, outside the disposable history.

It retains existing files unless removal is explicit, rejects changed bytes at
an existing path, rechecks the staged bytes, and uses an exact force-with-lease
against the observed remote tip. A local exclusive lock serializes concurrent
runs; another computer's conflicting push is rejected by the lease. On failure,
read the error and rerun the dry run after reconciling the complete library.
Do not retry by bypassing these checks or using an unconditional force-push.

The lock is `.holtburger-local/media-publish.lock` in the main checkout and records
the process ID. If a process was killed, confirm that PID is no longer running
before deleting its stale lock. Ordinary completion/error removes the lock.

## Remove an old capture

Use this order to keep the live website working:

1. Publish the new capture alongside existing files.
2. Change the catalog URL and deploy the website.
3. Once the live `media-index.json` no longer references the old file, remove it
   from the local complete library and request its removal in the next snapshot:

```sh
npm run media:publish -- /absolute/path/to/current-library --remove 3d/smart-tab-v1.mp4
npm run media:publish -- /absolute/path/to/current-library --remove 3d/smart-tab-v1.mp4 --publish
```

Repeat `--remove` for multiple files. The publisher checks both the local catalog
and the deployed site's media index before pruning. It refuses pruning when the
live index cannot be checked. Historical objects may remain on GitHub, but fresh
clones receive the single current commit; there are no media submodules or
media-history downloads in application development.

## Validate delivery

```sh
npm run check:media
npm run check:media -- --remote
npm run check:media-publisher
npm run check:media-host
```

The first check is local schema/path validation; `--remote` checks referenced
URLs and MIME types. Publisher checks use a disposable local bare remote to
exercise snapshot replacement, stale leases and fresh full clones. Hosted checks
read the published manifest, check response types/lengths, and verify a byte-range
response for an MP4 when one is present. Browser playback is a separate check.

`checks/delivery-v1.mp4` is a small synthetic delivery probe, not gameplay or a
gallery entry. Its SVG poster is labeled accordingly. Keep this probe available
for repeatable hosting checks; it is not part of the player-facing showcase.

## Limits and processing

The publisher allows at most 50 MiB per file and 900 MiB per complete snapshot.
Keep ordinary images well below that; use short, focused clips and YouTube for
long recordings. These are project budgets with room below GitHub's current
[Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Recheck hosting if bandwidth or library size becomes material.

Example short-clip export, using an original held outside the repository:

```sh
ffmpeg -i original.mov -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart -an clip-v1.mp4
```

This example intentionally removes audio for a silent demonstration. Retain useful
narration in other clips and provide a VTT caption track. Inspect the result at
its intended display size rather than optimizing only for file size.
