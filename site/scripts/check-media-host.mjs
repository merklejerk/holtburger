import { z } from 'zod';
import {
	MEDIA_REPOSITORY,
	MEDIA_ORIGIN,
	parseManifest
} from './media-snapshot.mjs';

const revision = await fetch(
	`https://api.github.com/repos/${MEDIA_REPOSITORY}/commits/main`,
	{
		signal: AbortSignal.timeout(15000),
		headers: { Accept: 'application/vnd.github+json' }
	}
);
if (!revision.ok) throw new Error(`Media revision HTTP ${revision.status}`);
const { sha } = z
	.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
	.parse(await revision.json());
const expected = await fetch(
	`https://raw.githubusercontent.com/${MEDIA_REPOSITORY}/${sha}/manifest.json`,
	{ signal: AbortSignal.timeout(15000) }
);
if (!expected.ok)
	throw new Error(`Media source manifest HTTP ${expected.status}`);
const response = await fetch(`${MEDIA_ORIGIN}manifest.json`, {
	signal: AbortSignal.timeout(15000),
	cache: 'no-store'
});
if (!response.ok) throw new Error(`Media manifest HTTP ${response.status}`);
const document = await response.text();
if (document !== (await expected.text()))
	throw new Error(`Media Pages has not deployed current snapshot ${sha}`);
const manifest = parseManifest(JSON.parse(document));
for (const file of manifest.files) {
	const url = new URL(file.path, MEDIA_ORIGIN);
	const head = await fetch(url, {
		method: 'HEAD',
		signal: AbortSignal.timeout(15000)
	});
	if (!head.ok) throw new Error(`Media HTTP ${head.status}: ${file.path}`);
	if (!head.headers.get('content-type')?.startsWith(file.contentType))
		throw new Error(`Unexpected hosted Content-Type: ${file.path}`);
	const size = head.headers.get('content-length');
	if (
		size !== null &&
		!head.headers.has('content-encoding') &&
		Number(size) !== file.bytes
	)
		throw new Error(`Hosted length differs from manifest: ${file.path}`);
}
const clip = manifest.files.find((file) => file.contentType === 'video/mp4');
if (clip) {
	const end = Math.min(15, clip.bytes - 1);
	const range = await fetch(new URL(clip.path, MEDIA_ORIGIN), {
		headers: { Range: `bytes=0-${end}` },
		signal: AbortSignal.timeout(15000)
	});
	if (
		range.status !== 206 ||
		range.headers.get('content-range') !== `bytes 0-${end}/${clip.bytes}`
	)
		throw new Error('Media host did not honor an MP4 byte range');
	if ((await range.arrayBuffer()).byteLength !== end + 1)
		throw new Error('MP4 range returned the wrong number of bytes');
}
console.log(
	`Hosted media checked at ${sha}: ${manifest.files.length} files${clip ? ', MP4 byte range passed' : ''}`
);
