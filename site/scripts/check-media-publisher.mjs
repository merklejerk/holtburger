import assert from 'node:assert/strict';
import {
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	inventory,
	parseManifest,
	validateTransition,
	validateReferences,
	pushSnapshot,
	git,
	MEDIA_ORIGIN,
	MAX_MEDIA_FILE_BYTES,
	MAX_MEDIA_TOTAL_BYTES
} from './media-snapshot.mjs';

const directory = await mkdtemp(join(tmpdir(), 'holtburger-media-test-'));
const identity = {
	name: 'Media publisher check',
	email: 'media-check@example.invalid'
};
try {
	const source = join(directory, 'current');
	const remote = join(directory, 'remote.git');
	await mkdir(source);
	await git(
		['init', '--bare', '--quiet', '--initial-branch=main', remote],
		directory
	);
	await writeFile(join(source, 'scene-v1.webp'), 'first capture');
	const first = await inventory(source);
	const tip = await pushSnapshot({
		source,
		manifest: first,
		remote,
		tip: null,
		identity
	});
	const oldBlob = await git(['rev-parse', `${tip}:scene-v1.webp`], remote);
	await rm(join(source, 'scene-v1.webp'));
	await writeFile(join(source, 'scene-v2.webp'), 'replacement capture');
	const second = await inventory(source);
	assert.throws(
		() => validateTransition(first, second, []),
		/Incomplete snapshot/
	);
	validateTransition(first, second, ['scene-v1.webp']);
	assert.throws(
		() => validateTransition(first, second, ['unknown.webp']),
		/not in the previous/
	);
	assert.throws(
		() => validateTransition(first, first, ['scene-v1.webp']),
		/still in the source/
	);
	assert.throws(
		() =>
			validateTransition(
				first,
				{
					schemaVersion: 1,
					files: [{ ...first.files[0], sha256: 'f'.repeat(64) }]
				},
				[]
			),
		/new revision path/
	);
	assert.throws(
		() =>
			validateReferences(second, [
				{ url: `${MEDIA_ORIGIN}missing.webp`, contentType: 'image/' }
			]),
		/absent media/
	);
	assert.throws(
		() =>
			validateReferences(second, [
				{ url: `${MEDIA_ORIGIN}scene-v2.webp`, contentType: 'video/mp4' }
			]),
		/type does not match/
	);
	validateReferences(second, [
		{ url: `${MEDIA_ORIGIN}scene-v2.webp`, contentType: 'image/' }
	]);
	const current = await pushSnapshot({
		source,
		manifest: second,
		remote,
		tip,
		identity
	});
	await writeFile(join(source, 'competing.webp'), 'competing snapshot');
	await assert.rejects(
		pushSnapshot({
			source,
			manifest: await inventory(source),
			remote,
			tip,
			identity
		}),
		/stale info|rejected/
	);
	assert.equal(await git(['rev-parse', 'main'], remote), current);
	const clone = join(directory, 'fresh-clone');
	await git(['clone', '--quiet', pathToFileURL(remote).href, clone], directory);
	assert.equal(await git(['rev-list', '--count', 'HEAD'], clone), '1');
	assert.equal(
		await readFile(join(clone, 'scene-v2.webp'), 'utf8'),
		'replacement capture'
	);
	await assert.rejects(git(['cat-file', '-e', oldBlob], clone));
	await assert.rejects(
		pushSnapshot({ source, manifest: second, remote, tip: current, identity }),
		/changed while staging/
	);
	await writeFile(join(source, 'source.txt'), 'not publishable');
	await assert.rejects(inventory(source), /Unsupported media/);
	await rm(join(source, 'source.txt'));
	await symlink(join(source, 'scene-v2.webp'), join(source, 'alias.webp'));
	await assert.rejects(inventory(source), /Symlinks/);
	assert.throws(
		() =>
			parseManifest({
				schemaVersion: 1,
				files: [first.files[0], first.files[0]]
			}),
		/Duplicate media/
	);
	assert.throws(() =>
		parseManifest({
			schemaVersion: 1,
			files: [{ ...first.files[0], path: '../escape.webp' }]
		})
	);
	assert.throws(() =>
		parseManifest({
			schemaVersion: 1,
			files: [{ ...first.files[0], bytes: MAX_MEDIA_FILE_BYTES + 1 }]
		})
	);
	const count = Math.floor(MAX_MEDIA_TOTAL_BYTES / MAX_MEDIA_FILE_BYTES) + 1;
	assert.throws(
		() =>
			parseManifest({
				schemaVersion: 1,
				files: Array.from({ length: count }, (_, index) => ({
					...first.files[0],
					path: `large-${index}.mp4`,
					bytes: MAX_MEDIA_FILE_BYTES,
					contentType: 'video/mp4'
				}))
			}),
		/site budget/
	);
	console.log(
		'Media publisher verified: complete snapshots, immutable paths, references, stale leases and history-free fresh clones'
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
