# Website media

Existing README screenshots stay in `assets/screenshots/`. New images and short
clips use `merklejerk/holtburger-media`; longer footage uses YouTube. Developers
and site CI never clone the media repository. The site reads published URLs.

## Add or replace media

1. Find the shot and its page placements in [CAPTURES.md](CAPTURES.md).
2. Export a readable WebP or a short H.264 MP4 with a poster. Give changed media a
   new revision filename, such as `3d/smart-tab-v2.mp4`, to avoid stale caches.
3. Add it to your **complete current media folder**, keeping files still used by
   the live site. Keep originals and backups elsewhere, outside Git.
4. Review and publish that folder from `site/`:

   ```sh
   npm run media:publish -- /absolute/path/to/current-library
   npm run media:publish -- /absolute/path/to/current-library --publish
   ```

5. Update the entry in `src/lib/media/catalog.ts`, check it locally, then deploy
   the website. Remove an old file only after the live site stops using it.

The folder is the entire next snapshot: omitted files disappear from the media
site. Review its contents before publishing. There are no manifests, automatic
pruning gates or history recovery. Keep your own backup.

The publisher's destination is fixed to the media repository. It stages a fresh
Git repository and pushes one root commit with an exact force-with-lease. A
concurrent push is rejected; review the current folder before retrying. Existing
branches or tags other than `main` are rejected because they retain history.
It requires Git push access and your configured Git author identity. Pages serves
`main` at `/`; no application deployment or media clone is involved.

## Catalog and checks

An image entry supplies a remote URL, alt text and dimensions. A video supplies
its MP4 URL, poster, dimensions and captions: use `null` for a silent demonstration,
or `{ src, language, label }` for a VTT track. A YouTube entry uses its video ID.
Keep capture IDs stable when replacing planned entries.

Clips have native controls, start muted and use `preload="none"`. YouTube loads
only after a click. Labeled briefs remain where captures are pending.

`npm run check:media` validates the local catalog. Run
`npm run check:media -- --remote` after publishing media to check availability and
MIME types. These network checks do not gate ordinary website deployments.
Check actual playback and seeking when adding a clip.

Keep images small and clips short; use YouTube for long recordings. Respect
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
For example, export a silent clip with:

```sh
ffmpeg -i original.mov -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart -an clip-v1.mp4
```

Retain useful narration in other clips and provide captions. Inspect text detail
and playback at the intended website size.
