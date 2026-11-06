import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaLibraryPath, developmentMediaLibrary } from './media-library.mjs';
import { mediaUrlForMode } from '../src/lib/media/url.ts';

test('media resolution changes only owned URLs in local mode', () => {
	const owned =
		'https://merklejerk.github.io/holtburger-media/3d/example.webp?v=2#detail';
	assert.equal(
		mediaUrlForMode(owned, true),
		'/holtburger/media/3d/example.webp?v=2#detail'
	);
	assert.equal(mediaUrlForMode(owned, false), owned);
	for (const url of [
		'https://example.com/image.webp',
		'assets/screenshots/example.webp',
		'https://merklejerk.github.io/holtburger-media-other/image.webp'
	]) {
		assert.equal(mediaUrlForMode(url, true), url);
	}
});

test('library configuration resolves from the repository and rejects explicit invalid directories', () => {
	const prior = process.env.HOLTBURGER_SITE_MEDIA;
	const directory = mkdtempSync(join(tmpdir(), 'site-media-test-'));
	try {
		process.env.HOLTBURGER_SITE_MEDIA = directory;
		assert.equal(developmentMediaLibrary(), directory);
		const link = join(directory, 'library-link');
		symlinkSync(directory, link, 'dir');
		process.env.HOLTBURGER_SITE_MEDIA = link;
		assert.equal(developmentMediaLibrary(), link);
		assert.equal(
			mediaLibraryPath('local/site-media'),
			new URL('../../local/site-media', import.meta.url).pathname
		);
		for (const empty of ['', '   ']) {
			process.env.HOLTBURGER_SITE_MEDIA = empty;
			assert.throws(developmentMediaLibrary, /path must not be empty/);
			assert.throws(() => mediaLibraryPath(empty), /path must not be empty/);
		}
		const file = join(directory, 'file');
		writeFileSync(file, 'example');
		process.env.HOLTBURGER_SITE_MEDIA = file;
		assert.throws(developmentMediaLibrary, /not a directory/);
		process.env.HOLTBURGER_SITE_MEDIA = join(directory, 'missing');
		assert.throws(developmentMediaLibrary, /not a directory/);
	} finally {
		if (prior === undefined) delete process.env.HOLTBURGER_SITE_MEDIA;
		else process.env.HOLTBURGER_SITE_MEDIA = prior;
		rmSync(directory, { recursive: true });
	}
});
