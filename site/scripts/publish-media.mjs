import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { catalogFiles, mediaIndexSchema } from './media-catalog.mjs';
import {
	MEDIA_REPOSITORY,
	MEDIA_REMOTE,
	inventory,
	parseManifest,
	validateReferences,
	validateTransition,
	pushSnapshot,
	git
} from './media-snapshot.mjs';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		publish: { type: 'boolean', default: false },
		remove: { type: 'string', multiple: true, default: [] }
	}
});
if (positionals.length !== 1)
	throw new Error(
		'Usage: npm run media:publish -- SOURCE_DIRECTORY [--remove PATH ...] [--publish]'
	);
const source = positionals[0];
const root = fileURLToPath(new URL('../../', import.meta.url));
const local = new URL('../../.holtburger-local/', import.meta.url);
await mkdir(local, { recursive: true });
const lockPath = new URL('media-publish.lock', local);
const lock = await open(lockPath, 'wx');
try {
	await lock.writeFile(`${process.pid}\n`);
	const execute = promisify(execFile);
	/** @param {string} endpoint @param {...string} args */
	async function github(endpoint, ...args) {
		const result = await execute('gh', ['api', endpoint, ...args]);
		return result.stdout;
	}
	const repo = JSON.parse(await github(`repos/${MEDIA_REPOSITORY}`));
	if (repo.full_name !== MEDIA_REPOSITORY || repo.permissions?.push !== true)
		throw new Error('Expected writable dedicated media repository');

	const refs = await git(
		['ls-remote', '--heads', '--tags', MEDIA_REMOTE],
		root
	);
	const lines = refs ? refs.split('\n') : [];
	if (lines.length > 0 && repo.default_branch !== 'main')
		throw new Error('Media repository must use main as its default branch');
	if (lines.length > 1)
		throw new Error('Media repository must have only main and no tags');
	let tip = null;
	if (lines.length === 1) {
		const [hash, ref] = lines[0].split('\t');
		if (ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(hash))
			throw new Error('Unexpected media repository ref');
		tip = hash;
	}
	const previous =
		tip === null
			? parseManifest({ schemaVersion: 1, files: [] })
			: parseManifest(
					JSON.parse(
						await github(
							`repos/${MEDIA_REPOSITORY}/contents/manifest.json?ref=${tip}`,
							'--header',
							'Accept: application/vnd.github.raw+json'
						)
					)
				);
	const next = await inventory(source);
	validateTransition(previous, next, values.remove);
	validateReferences(next, await catalogFiles());
	if (values.remove.length > 0) {
		const response = await fetch(
			'https://merklejerk.github.io/holtburger/media-index.json',
			{ signal: AbortSignal.timeout(15000), cache: 'no-store' }
		);
		if (!response.ok)
			throw new Error(
				'Cannot verify deployed media references; publish the website media index before pruning'
			);
		validateReferences(
			next,
			mediaIndexSchema.parse(await response.json()).files
		);
	}
	console.log(
		JSON.stringify(
			{
				repository: MEDIA_REPOSITORY,
				branch: 'main',
				previousCommit: tip,
				removals: values.remove,
				snapshot: next
			},
			null,
			2
		)
	);
	if (values.publish) {
		const name = await git(['config', 'user.name'], root);
		const email = await git(['config', 'user.email'], root);
		const commit = await pushSnapshot({
			source,
			manifest: next,
			remote: MEDIA_REMOTE,
			tip,
			identity: { name, email }
		});
		console.log(`Published one root commit: ${commit}`);
	} else
		console.log(
			'Dry run only. Review this complete snapshot, then add --publish.'
		);
} finally {
	await lock.close();
	await rm(lockPath);
}
