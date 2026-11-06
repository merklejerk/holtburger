import { mediaLibraryPath } from './media-library.mjs';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import {
	cp,
	stat,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately fixed: this command can never replace the application repository.
const remote = 'git@github.com:merklejerk/holtburger-media.git';
const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
/** Run Git without shell interpolation or prompts.
 * @param {string[]} args @param {string} cwd
 */
async function git(args, cwd) {
	const result = await execute('git', args, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
	return result.stdout.trim();
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { publish: { type: 'boolean', default: false } }
});
if (positionals.length > 1)
	throw new Error(
		'Usage: npm run media:publish -- [CURRENT_LIBRARY] [--publish]'
	);
const source = mediaLibraryPath(positionals[0]);
if (!(await stat(source)).isDirectory())
	throw new Error(`Site media library is not a directory: ${source}`);
const refs = await git(['ls-remote', '--heads', '--tags', remote], root);
// Other branches or tags would preserve history that snapshot replacement should retire.
if (refs && !/^[a-f0-9]{40}\trefs\/heads\/main$/.test(refs))
	throw new Error('Media repository must have only main and no tags');
const tip = refs.split('\t')[0];
const stage = await mkdtemp(join(tmpdir(), 'holtburger-media-'));
try {
	let files = 0;
	for (const path of (await readdir(source, { recursive: true })).sort()) {
		if (path.split(/[\\/]/).some((part) => part.startsWith('.')))
			throw new Error(
				`Hidden files/directories do not belong in the media library: ${path}`
			);
		const original = join(source, path);
		const info = await lstat(original);
		if (info.isDirectory()) continue;
		if (!info.isFile())
			throw new Error(`Expected a regular media file: ${path}`);
		const destination = join(stage, path);
		await mkdir(dirname(destination), { recursive: true });
		await cp(original, destination);
		files++;
	}
	if (files === 0)
		throw new Error('Refusing to publish an empty media library');
	await writeFile(join(stage, '.nojekyll'), '');
	await git(['init', '--quiet', '--initial-branch=main'], stage);
	await git(['add', '.'], stage);
	await git(['diff', '--cached', '--check'], stage);
	const summary = await git(['diff', '--cached', '--stat'], stage);
	console.log(
		`Complete snapshot: ${files} media files → ${remote}\n${summary}`
	);
	if (values.publish) {
		await git(
			['config', 'user.name', await git(['config', 'user.name'], root)],
			stage
		);
		await git(
			['config', 'user.email', await git(['config', 'user.email'], root)],
			stage
		);
		await git(['config', 'commit.gpgsign', 'false'], stage);
		await git(
			[
				'commit',
				'--quiet',
				'-m',
				'Publish current media snapshot',
				'-m',
				summary
			],
			stage
		);
		await git(
			[
				'push',
				`--force-with-lease=refs/heads/main:${tip}`,
				remote,
				'HEAD:refs/heads/main'
			],
			stage
		);
		console.log(
			`Published one root commit: ${await git(['rev-parse', 'HEAD'], stage)}`
		);
	} else
		console.log(
			'Dry run only. Review the complete folder, then add --publish.'
		);
} finally {
	await rm(stage, { recursive: true, force: true });
}
