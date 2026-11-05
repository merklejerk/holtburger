import { writeIfChanged } from './write-if-changed.mjs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { compile } from 'mdsvex';
import { prepareQuickstarts } from './prepare-quickstarts.mjs';
import { prepareCaptures } from './prepare-captures.mjs';

const metadataOnly = process.argv.includes('--metadata-only');
if (!metadataOnly || process.argv.includes('--quickstarts'))
	await prepareQuickstarts();
if (!metadataOnly) await prepareCaptures();

// Compute cold page metadata once; Markdown parsers and raw prose never ship to readers.
const root = new URL('../src/content/', import.meta.url);
const files = (await readdir(root, { recursive: true }))
	.map((file) => file.replaceAll('\\', '/'))
	.filter((path) => path.endsWith('.md'))
	.sort();
const pages = [];
for (const file of files) {
	if (
		['updates', 'assets', 'pagefind'].includes(
			file.split('/')[0].replace(/\.md$/, '')
		)
	)
		throw new Error(`Reserved publication path: ${file}`);
	const source = await readFile(new URL(file, root), 'utf8');
	const compiled = await compile(source);
	const metadata = compiled?.data?.fm;
	const title = requiredText(metadata, 'title', file);
	const description = requiredText(metadata, 'description', file);
	const section = requiredText(metadata, 'section', file);
	pages.push({
		path: `/src/content/${file}`,
		slug: file.slice(0, -3),
		title,
		description,
		section
	});
}
const destination = new URL('../src/lib/generated/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeIfChanged(
	new URL('pages.json', destination),
	`${JSON.stringify(pages, null, 2)}\n`
);
console.log(`Prepared ${pages.length} guide entries`);

/** @param {unknown} metadata @param {string} field @param {string} file */
function requiredText(metadata, field, file) {
	if (
		typeof metadata !== 'object' ||
		metadata === null ||
		!(field in metadata)
	) {
		throw new Error(`${file} requires ${field}`);
	}
	/** @type {unknown} */
	const value = Reflect.get(metadata, field);
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`${file} requires nonempty ${field}`);
	return value;
}
