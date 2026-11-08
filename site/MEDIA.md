# Website media

Existing README screenshots stay in `assets/screenshots/`. New images and short
clips use `merklejerk/holtburger-media`; longer footage uses YouTube. Ordinary
development and site CI do not require a media checkout. Production reads
published URLs.

## Local development

Keep a complete working media library in `local/site-media/` at the repository
root. It is ignored by Git. Set `HOLTBURGER_SITE_MEDIA` to use another directory;
relative configuration paths and publisher arguments resolve from the repository
root. Publishing always requires an explicit source path; development defaults and
`HOLTBURGER_SITE_MEDIA` never select the publication source. Use an exported media snapshot without `.git` or other hidden files. The
publisher generates `.nojekyll` itself; omit it from the working library.
Every validated file is staged, including files matched by developer-global Git ignore rules.

`npm run dev` serves an available library at `/holtburger/media/` and resolves
this media repository's catalog URLs to that route, including videos, posters,
captions, and decorative artwork. Keep public URLs in the catalogs. Files can be
added or replaced while dev runs; restart after changing the library location.
Missing files return 404 rather than falling back to published versions.

Without the default directory, development uses published media. An explicitly
configured missing or invalid directory fails startup. Production builds and
`npm run preview` always use published media and never require the local library.
No media is downloaded or synchronized automatically.

## Add or replace media

1. Find the shot and its page placements in [CAPTURES.md](CAPTURES.md).
2. Export a readable WebP or a short H.264 MP4 with a poster. Give changed media a
   new revision filename, such as `3d/smart-tab-v2.mp4`, to avoid stale caches.
3. Add it to your **complete current media folder**, keeping files still used by
   the live site. Keep originals and backups elsewhere, outside Git.
4. Update the entry in `src/lib/media/catalog.ts` with its public URL, dimensions
   and alt text. Run `npm run dev` from `site/` to review the unpublished media
   from your local library.
5. Review and publish that complete folder from the repository root:

   ```sh
   npm run publish:site:media -- --help
   npm run publish:site:media -- local/site-media
   npm run publish:site:media -- local/site-media --publish
   ```

   The source directory is mandatory, including when a development library is
   configured. Omitting it, passing a blank path, or using unknown flags fails
   before filesystem or Git work. The dry run validates and stages files locally
   without contacting the remote; `--publish` explicitly enables replacement.

6. Run `npm run check:site:media -- --remote` from the root after media publication, then deploy the
   website. Remove an old file only after the live site stops using it.

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

The decorative paint wash URL and concept-art catalog live in
`src/lib/illustrations.ts`. Each illustration supplies its subject kind and image
dimensions. These assets share this media repository and the same URL checks;
keep their files when publishing a new complete snapshot.

Wrap an illustrated guide passage in `IllustratedProse` and choose its `name` from
the catalog. The component keeps the artwork out of text layout, centers
landscapes, and aligns creatures to the right. Use each subject at most once per
page, counting the shared Holtburg masthead. Homepage placements use
`DecorativeArt` directly for their individual compositions.

Clips have native controls, start muted and use `preload="none"`. Silent
demonstrations loop and play inline on mobile. YouTube loads
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
