import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import GithubSlugger from 'github-slugger';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { z } from 'zod';
import {
	media,
	galleryClips,
	galleryImages
} from '../src/lib/media/catalog.ts';

/** Generate the durable handoff from source briefs and verified live page placements. */
export async function prepareCaptures() {
	const text = z.string().trim().min(1);
	const registry = z
		.object({
			sessions: z.record(
				z.string(),
				z.object({ title: text, setup: text }).strict()
			),
			captures: z.record(
				z.string(),
				z
					.object({
						owner: z.enum(['agent', 'user']),
						session: text,
						setup: text,
						framing: text,
						expected: text,
						priority: z.enum(['first', 'later'])
					})
					.strict()
			)
		})
		.strict()
		.parse(
			JSON.parse(
				await readFile(
					new URL('../authoring/captures.json', import.meta.url),
					'utf8'
				)
			)
		);
	const root = new URL('../src/content/', import.meta.url);
	/** @type {Map<string, Set<string>>} */
	const placements = new Map();
	/** @param {string} id @param {string} path */
	function place(id, path) {
		let uses = placements.get(id);
		if (uses === undefined) {
			uses = new Set();
			placements.set(id, uses);
		}
		uses.add(path);
	}
	for (const path of (await readdir(root, { recursive: true }))
		.map((file) => file.replaceAll('\\', '/'))
		.filter((file) => file.endsWith('.md'))
		.sort()) {
		const source = (await readFile(new URL(path, root), 'utf8')).replace(
			/^---\r?\n[\s\S]*?\r?\n---\r?\n/,
			''
		);
		const slugger = new GithubSlugger();
		let anchor = '';
		for (const node of unified().use(remarkParse).parse(source).children) {
			if (node.type === 'heading') anchor = slugger.slug(toString(node));
			if (node.type !== 'html') continue;
			for (const match of node.value.matchAll(/<Media\s+id="([^"]+)"/g)) {
				const id = match[1];
				if (!Object.hasOwn(media, id))
					throw new Error(`Unknown media placement: ${id}`);
				place(id, `${path.slice(0, -3)}/${anchor ? `#${anchor}` : ''}`);
			}
		}
	}
	for (const id of [...galleryClips, ...galleryImages]) {
		place(
			id,
			`gallery/#${galleryClips.includes(id) ? 'clips' : 'screenshots'}`
		);
	}

	for (const [id, entry] of Object.entries(media)) {
		if (entry.kind.startsWith('planned') && !registry.captures[id])
			throw new Error(`Missing capture brief: ${id}`);
	}
	/** @type {Map<string, import('../src/lib/media/catalog.ts').MediaAsset>} */
	const mediaById = new Map(Object.entries(media));
	const records = Object.entries(registry.captures).map(([id, brief]) => {
		const entry = mediaById.get(id);
		if (!entry) throw new Error(`Capture brief has no catalog entry: ${id}`);
		if (!registry.sessions[brief.session])
			throw new Error(`Unknown capture session: ${brief.session}`);
		const uses = placements.get(id);
		if (!uses || uses.size === 0)
			throw new Error(`Capture has no page placement: ${id}`);
		return { id, brief, entry, uses: Array.from(uses) };
	});

	let output =
		'# Media capture handoff\n\nGenerated from `authoring/captures.json`, the media catalog and actual page placements. Edit those sources rather than this report.\n\nThe website works without these captures. This is the final-session shot list, not a prerequisite to writing or deployment. Start with the **First** shots; the rest can be collected when convenient. The agent owns static component crops, including live-client panels staged on the local test server. The user owns motion and natural-control clips, plus all interactive TUI capture. The user reviews the first static samples before bulk capture. Fixture images must be labeled as UI illustrations, never as gameplay evidence.\n\nKeep originals outside Git and publish processed files through [MEDIA.md](MEDIA.md). Record the client version, use readable text scale, hide credentials, and leave a second of stillness before/after each action. Prefer short clips over one long recording.\n\n';
	for (const [session, details] of Object.entries(registry.sessions)) {
		output += `## ${details.title}\n\n${details.setup}\n\n`;
		for (const { id, brief, entry, uses } of records
			.filter((row) => row.brief.session === session)
			.sort(
				(a, b) =>
					Number(a.brief.priority === 'later') -
					Number(b.brief.priority === 'later')
			)) {
			const planned =
				entry.kind === 'planned-image' || entry.kind === 'planned-video';
			output += `### ${entry.title}\n\n**${brief.priority === 'first' ? 'First' : 'Later'} · ${brief.owner} · ${planned ? 'pending' : 'available'} · ${entry.kind === 'planned-video' || entry.kind === 'video' || entry.kind === 'youtube' ? 'clip' : 'still'}** — ID: \`${id}\`\n\n`;
			output += `- Setup: ${brief.setup}\n- Frame: ${brief.framing}\n`;
			if (planned) output += `- Action/purpose: ${entry.brief}\n`;
			output += `- Expected result: ${brief.expected}\n- Used in: ${uses
				.map(
					(path) => `[${path}](https://merklejerk.github.io/holtburger/${path})`
				)
				.join(', ')}\n\n`;
		}
	}
	const destination = new URL('../CAPTURES.md', import.meta.url);
	await writeFile(
		destination,
		await format(output, {
			...(await resolveConfig(fileURLToPath(destination))),
			parser: 'markdown'
		})
	);
	console.log(
		`Capture handoff prepared: ${Object.keys(registry.captures).length} briefs with verified placements`
	);
}
