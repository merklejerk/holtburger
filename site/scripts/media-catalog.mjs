import { stat } from 'node:fs/promises';
import { media } from '../src/lib/media/catalog.ts';

/** Collect remote media references for local link checks and optional hosting checks. */
export async function catalogFiles() {
	/** @type {{url: string; contentType: string}[]} */
	const files = [];
	/** @param {string} id @param {import('../src/lib/media/catalog.ts').MediaAsset} entry */
	async function validate(id, entry) {
		if (!entry.title.trim()) throw new Error(`${id}: media title is empty`);
		if (entry.kind === 'planned-image' || entry.kind === 'planned-video') {
			if (!entry.brief.trim()) throw new Error(`${id}: capture brief is empty`);
			return;
		}
		if (entry.kind === 'youtube') {
			if (!/^[A-Za-z0-9_-]{11}$/.test(entry.videoId))
				throw new Error(`${id}: invalid YouTube ID`);
			return;
		}
		if (
			!Number.isInteger(entry.width) ||
			entry.width <= 0 ||
			!Number.isInteger(entry.height) ||
			entry.height <= 0
		)
			throw new Error(`${id}: media dimensions must be positive integers`);
		if (entry.kind === 'image') {
			if (!entry.alt.trim()) throw new Error(`${id}: image alt text is empty`);
			if (entry.source.kind === 'local') {
				await stat(new URL(`../static/${entry.source.path}`, import.meta.url));
			} else add(entry.source.url, 'image/');
			return;
		}
		if (entry.kind === 'video') {
			add(entry.src, 'video/mp4');
			add(entry.poster, 'image/');
			if (entry.captions !== null) {
				if (!entry.captions.language.trim() || !entry.captions.label.trim())
					throw new Error(`${id}: caption language and label are required`);
				add(entry.captions.src, 'text/vtt');
			}
		}
	}
	/** @param {string} raw @param {string} contentType */
	function add(raw, contentType) {
		const url = new URL(raw);
		if (url.protocol !== 'https:' || url.username || url.password)
			throw new Error(`Media requires a public HTTPS URL: ${raw}`);
		files.push({ url: url.href, contentType });
	}
	for (const [id, entry] of Object.entries(media)) await validate(id, entry);
	return files;
}
