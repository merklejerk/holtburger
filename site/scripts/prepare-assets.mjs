import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeIfChanged } from './write-if-changed.mjs';

/** Collect the owned output paths before writing or pruning generated assets.
 * @param {URL} directory
 * @param {string} prefix
 * @param {Map<string, URL>} files
 */
async function collectFiles(directory, prefix, files) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const source = new URL(entry.name, directory);
		const relative = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			await collectFiles(
				new URL(`${entry.name}/`, directory),
				`${relative}/`,
				files
			);
		} else if (entry.isFile()) {
			files.set(relative, source);
		} else {
			throw new Error(`Expected a regular asset file or directory: ${source}`);
		}
	}
}

// Existing checked-in media is reused at build time; generated copies stay ignored.
const destination = new URL('../static/assets/', import.meta.url);
/** @type {Map<string, URL>} */
const files = new Map();
await collectFiles(
	new URL('../../assets/screenshots/', import.meta.url),
	'screenshots/',
	files
);
// Publish the small web exports, rather than the full-resolution source and native icons.
for (const file of ['favicon.png', 'portal-docs.png']) {
	files.set(
		`branding/${file}`,
		new URL(`../../assets/branding/${file}`, import.meta.url)
	);
}
files.set(
	'branding/wordmark.webp',
	new URL('../assets/branding/wordmark.webp', import.meta.url)
);
for (const family of ['gelasio', 'arimo']) {
	await collectFiles(
		new URL(`../assets/fonts/${family}/`, import.meta.url),
		`fonts/${family}/`,
		files
	);
}
// Site-only display lettering is bundled with its original redistribution license.
await collectFiles(
	new URL('../assets/fonts/charm/', import.meta.url),
	'fonts/charm/',
	files
);
// Script examples and types have one maintained source and an ignored download copy.
files.set(
	'scripting/holtburger.d.ts',
	new URL('../../crates/holtburger-scripting/holtburger.d.ts', import.meta.url)
);
const examples = new URL('../examples/', import.meta.url);
for (const file of (await readdir(examples)).filter((name) =>
	name.endsWith('.js')
)) {
	files.set(`scripting/${file}`, new URL(file, examples));
}

await mkdir(destination, { recursive: true });
for (const [relative, source] of files) {
	const target = new URL(relative, destination);
	await mkdir(new URL('.', target), { recursive: true });
	await writeIfChanged(target, await readFile(source));
}
// Remove only obsolete files, without deleting live assets during build/check.
/** @type {Map<string, URL>} */
const previous = new Map();
await collectFiles(destination, '', previous);
for (const [relative, target] of previous) {
	if (!files.has(relative)) await rm(target);
}
console.log(`Prepared existing site assets in ${fileURLToPath(destination)}`);
