import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	chmodSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';
import { test } from 'node:test';

const scripts = fileURLToPath(new URL('./', import.meta.url));

/** All help and validation tests deny access to external commands.
 * @param {string} script @param {string[]} args @param {string} directory */
function invoke(script, args, directory) {
	const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, PATH: directory, HOLTBURGER_SITE_MEDIA: directory },
		timeout: 10000
	});
	if (result.error) throw result.error;
	return { status: result.status, output: result.stdout + result.stderr };
}

test('site CLI help performs no preparation, browser launch or Git operation', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'site-cli-help-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const script of [
		'publish-media.mjs',
		'preview.mjs',
		'check-media.mjs',
		'check-links.mjs',
		'check-browser.mjs',
		'prepare-assets.mjs',
		'prepare-content.mjs'
	]) {
		const result = invoke(script, ['--help'], directory);
		assert.equal(result.status, 0, `${script}: ${result.output}`);
		assert.match(result.output, /Show help/);
	}
});

test('media publication requires an explicit nonblank source even with a configured library', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'site-cli-source-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const args of [
		[],
		['--publish'],
		[''],
		['   '],
		[directory, '--publsih'],
		[directory, 'extra']
	]) {
		const result = invoke('publish-media.mjs', args, directory);
		assert.equal(result.status, 1, result.output);
		assert.match(
			result.output,
			/Not enough non-option arguments|must not be empty|Unknown argument/
		);
		assert.doesNotMatch(result.output, /\n\s+at |ENOENT|Complete snapshot/);
	}
});

test('media validation rejects empty libraries and symlinks before Git', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'site-cli-validation-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const result = invoke(
		'publish-media.mjs',
		[directory, '--publish'],
		directory
	);
	assert.equal(result.status, 1);
	assert.match(result.output, /empty media library/);
	assert.doesNotMatch(result.output, /ENOENT/);
	if (process.platform !== 'win32') {
		const target = join(directory, 'target.webp');
		writeFileSync(target, 'fixture');
		symlinkSync(target, join(directory, 'link.webp'));
		const linked = invoke(
			'publish-media.mjs',
			[directory, '--publish'],
			directory
		);
		assert.equal(linked.status, 1);
		assert.match(linked.output, /Expected a regular media file/);
		assert.doesNotMatch(linked.output, /ENOENT/);
	}
});

test('site preview validates its port before opening a server', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'site-cli-port-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const port of ['0', '65536', '1.5', 'invalid']) {
		const result = invoke('preview.mjs', ['--port', port], directory);
		assert.equal(result.status, 1, result.output);
		assert.match(result.output, /Port must be an integer/);
	}
});

test(
	'media dry run includes globally ignored files without accessing the remote',
	{ skip: process.platform === 'win32' },
	(t) => {
		const directory = mkdtempSync(join(tmpdir(), 'site-cli-dry-run-'));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const source = join(directory, 'library');
		mkdirSync(source);
		writeFileSync(join(source, 'example.webp'), 'fixture');
		writeFileSync(join(source, 'clip.mp4'), 'video fixture');
		const ignore = join(directory, 'ignore');
		const config = join(directory, 'gitconfig');
		writeFileSync(ignore, '*.mp4\n');
		writeFileSync(config, `[core]\nexcludesFile = ${JSON.stringify(ignore)}\n`);
		// Real Git handles only temporary local staging; reject any remote operation.
		const git = spawnSync('which', ['git'], { encoding: 'utf8' });
		if (git.error) throw git.error;
		assert.equal(git.status, 0);
		const wrapper = join(directory, 'git');
		writeFileSync(
			wrapper,
			`#!/bin/sh
case "$1" in ls-remote|push|fetch|clone) echo "Unexpected network operation" >&2; exit 99;; esac
exec '${git.stdout.trim()}' "$@"
`
		);
		chmodSync(wrapper, 0o755);
		const result = spawnSync(
			process.execPath,
			[join(scripts, 'publish-media.mjs'), source],
			{
				encoding: 'utf8',
				timeout: 10000,
				env: {
					...process.env,
					PATH: `${directory}${delimiter}${process.env.PATH}`,
					GIT_CONFIG_GLOBAL: config
				}
			}
		);
		if (result.error) throw result.error;
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Complete snapshot: 2 media files/);
		assert.match(result.stdout, /Dry run only/);
		assert.match(result.stdout, /clip\.mp4/);
		assert.match(result.stdout, /example\.webp/);
	}
);
