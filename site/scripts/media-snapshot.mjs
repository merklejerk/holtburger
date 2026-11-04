import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const MEDIA_REPOSITORY = 'merklejerk/holtburger-media';
export const MEDIA_ORIGIN = 'https://merklejerk.github.io/holtburger-media/';
export const MEDIA_REMOTE = `git@github.com:${MEDIA_REPOSITORY}.git`;
// Leave room below GitHub's file/site limits; long footage belongs on YouTube.
export const MAX_MEDIA_FILE_BYTES = 50 * 1024 ** 2;
export const MAX_MEDIA_TOTAL_BYTES = 900 * 1024 ** 2;
const contentTypes = new Map(
	Object.entries(
		/** @type {const} */ ({
			svg: 'image/svg+xml',
			webp: 'image/webp',
			avif: 'image/avif',
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			mp4: 'video/mp4',
			vtt: 'text/vtt'
		})
	)
);
const manifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		files: z.array(
			z
				.object({
					path: z
						.string()
						.regex(
							/^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:svg|webp|avif|png|jpg|jpeg|mp4|vtt)$/
						),
					sha256: z.string().regex(/^[a-f0-9]{64}$/),
					bytes: z.number().int().positive().max(MAX_MEDIA_FILE_BYTES),
					contentType: z.enum(Array.from(contentTypes.values()))
				})
				.strict()
		)
	})
	.strict();
/** Complete immutable file inventory, consumed by publication and hosted-delivery checks. */
export const parseManifest = (/** @type {unknown} */ value) => {
	const manifest = manifestSchema.parse(value);
	/** @type {Set<string>} */
	const seen = new Set();
	let bytes = 0;
	for (const file of manifest.files) {
		if (seen.has(file.path))
			throw new Error(`Duplicate media path: ${file.path}`);
		seen.add(file.path);
		bytes += file.bytes;
	}
	if (bytes > MAX_MEDIA_TOTAL_BYTES)
		throw new Error('Media snapshot exceeds the site budget');
	return manifest;
};
/** @typedef {ReturnType<typeof parseManifest>} MediaManifest */

/** Inventory the entire maintained folder; metadata is generated only in disposable staging. */
export async function inventory(/** @type {string} */ source) {
	/** @type {MediaManifest["files"]} */
	const files = [];
	async function visit(/** @type {string} */ path) {
		const absolute = resolve(source, path);
		const info = await lstat(absolute);
		if (info.isSymbolicLink())
			throw new Error(`Symlinks are not publishable: ${path}`);
		if (info.isDirectory()) {
			for (const child of (await readdir(absolute)).sort())
				await visit(path ? `${path}/${child}` : child);
			return;
		}
		if (!info.isFile()) throw new Error(`Not a regular media file: ${path}`);
		if (info.size > MAX_MEDIA_FILE_BYTES)
			throw new Error(`Media file exceeds the upload budget: ${path}`);
		const contentType = contentTypes.get(path.split('.').at(-1) ?? '');
		if (!contentType) throw new Error(`Unsupported media file: ${path}`);
		const bytes = await readFile(absolute);
		files.push({
			path,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.length,
			contentType
		});
	}
	await visit('');
	return parseManifest({ schemaVersion: 1, files });
}

/** Explicit removals are required; changed bytes need a new filename to avoid stale caches. */
export function validateTransition(
	/** @type {MediaManifest} */ previous,
	/** @type {MediaManifest} */ next,
	/** @type {string[]} */ removals
) {
	const current = new Map(next.files.map((file) => [file.path, file]));
	const old = new Map(previous.files.map((file) => [file.path, file]));
	for (const path of removals) {
		if (!old.has(path))
			throw new Error(`Removal is not in the previous snapshot: ${path}`);
		if (current.has(path))
			throw new Error(`Removed path is still in the source folder: ${path}`);
	}
	for (const file of previous.files) {
		const replacement = current.get(file.path);
		if (!replacement && !removals.includes(file.path))
			throw new Error(
				`Incomplete snapshot; missing existing media: ${file.path}`
			);
		if (replacement && replacement.sha256 !== file.sha256)
			throw new Error(
				`Changed media requires a new revision path: ${file.path}`
			);
	}
}

/** Every current site reference to our media repository must be in the proposed snapshot. */
export function validateReferences(
	/** @type {MediaManifest} */ manifest,
	/** @type {{url: string; contentType: string}[]} */ references
) {
	const files = new Map(manifest.files.map((file) => [file.path, file]));
	for (const reference of references) {
		if (!reference.url.startsWith(MEDIA_ORIGIN)) continue;
		const url = new URL(reference.url);
		if (url.search || url.hash)
			throw new Error(
				`Use a revision filename instead of a media URL query: ${reference.url}`
			);
		const path = decodeURIComponent(reference.url.slice(MEDIA_ORIGIN.length));
		const file = files.get(path);
		if (!file) throw new Error(`Site references absent media: ${path}`);
		if (!file.contentType.startsWith(reference.contentType))
			throw new Error(`Media type does not match its site use: ${path}`);
	}
}

const execute = promisify(execFile);
/** Run Git without a shell or interactive credential prompt. */
export async function git(
	/** @type {string[]} */ args,
	/** @type {string} */ cwd
) {
	const result = await execute('git', args, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
	return result.stdout.trim();
}

/** Stage one new root commit and lease-protect the exact observed branch tip. */
export async function pushSnapshot(
	/** @type {{source: string; manifest: MediaManifest; remote: string; tip: string | null; identity: {name: string; email: string}}} */ request
) {
	if (
		JSON.stringify(await inventory(request.source)) !==
		JSON.stringify(request.manifest)
	)
		throw new Error(
			'Media source changed while staging; retry with a stable folder'
		);
	const stage = await mkdtemp(join(tmpdir(), 'holtburger-media-publish-'));
	try {
		for (const file of request.manifest.files) {
			const destination = join(stage, file.path);
			await mkdir(resolve(destination, '..'), { recursive: true });
			await cp(join(request.source, file.path), destination);
		}
		if (
			JSON.stringify(await inventory(stage)) !==
			JSON.stringify(request.manifest)
		)
			throw new Error(
				'Media source changed while staging; retry with a stable folder'
			);
		await writeFile(
			join(stage, 'manifest.json'),
			`${JSON.stringify(request.manifest, null, 2)}\n`
		);
		await writeFile(join(stage, '.nojekyll'), '');
		await writeFile(
			join(stage, 'index.html'),
			'<!doctype html><html lang="en"><meta charset="utf-8"><title>Holtburger media</title><h1>Holtburger media</h1><p>Published images and short clips for the <a href="https://merklejerk.github.io/holtburger/">Holtburger website</a>.</p></html>\n'
		);
		await git(['init', '--quiet', '--initial-branch=main'], stage);
		await git(['config', 'user.name', request.identity.name], stage);
		await git(['config', 'user.email', request.identity.email], stage);
		await git(['config', 'commit.gpgsign', 'false'], stage);
		await git(['add', '.'], stage);
		const summary = await git(['diff', '--cached', '--stat'], stage);
		await git(['diff', '--cached', '--check'], stage);
		const message = join(stage, '.git', 'snapshot-message.txt');
		await writeFile(
			message,
			`Publish complete current media snapshot\n\n${summary}\n`
		);
		await git(['commit', '--quiet', '-F', message], stage);
		const commit = await git(['rev-parse', 'HEAD'], stage);
		await git(
			[
				'push',
				`--force-with-lease=refs/heads/main:${request.tip ?? ''}`,
				request.remote,
				'HEAD:refs/heads/main'
			],
			stage
		);
		return commit;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
