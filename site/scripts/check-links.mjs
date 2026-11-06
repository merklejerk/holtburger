import { commandLine, runCli } from './cli.mjs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { parse } from 'parse5';
import { catalogFiles } from './media-catalog.mjs';

await runCli(
	commandLine('npm run check:site:links --').command(
		'$0',
		'Check links and anchors in the built website',
		{},
		async () => {
			const root = fileURLToPath(new URL('../build/', import.meta.url));
			const origin = new URL('https://merklejerk.github.io/holtburger/');
			// The media Pages site shares a host, but its catalog URLs are separate deployments.
			const externalMedia = new Set(
				(await catalogFiles()).map((file) => file.url)
			);
			const pages = (await readdir(root, { recursive: true })).filter((path) =>
				path.endsWith('.html')
			);
			/** @type {Map<string, { ids: Set<string>; links: string[] }>} */
			const documents = new Map();
			for (const page of pages) {
				const document = parse(await readFile(resolve(root, page), 'utf8'));
				/** @type {Set<string>} */
				const ids = new Set();
				/** @type {string[]} */
				const links = [];
				/** @param {import('parse5').DefaultTreeAdapterMap['node']} node */
				function visit(node) {
					if ('attrs' in node) {
						for (const { name, value } of node.attrs) {
							if (name === 'id') {
								if (ids.has(value))
									throw new Error(`${page}: duplicate ID ${value}`);
								ids.add(value);
							}
							if (name === 'href' || name === 'src') links.push(value);
							// The site's source sets contain URLs without spaces or literal commas.
							if (name === 'srcset') {
								for (const candidate of value.split(','))
									links.push(candidate.trim().split(/\s+/)[0]);
							}
						}
					}
					if ('childNodes' in node)
						for (const child of node.childNodes) visit(child);
				}
				visit(document);
				documents.set(page, { ids, links });
			}
			let checked = 0;
			for (const [page, document] of documents) {
				const pageUrl = new URL(page.replace(/index\.html$/, ''), origin);
				for (const link of document.links) {
					const url = new URL(link, pageUrl);
					if (url.origin !== origin.origin || externalMedia.has(url.href))
						continue;
					if (!url.pathname.startsWith(origin.pathname))
						throw new Error(`${page}: link leaves project base: ${link}`);
					const pathname = decodeURIComponent(
						url.pathname.slice(origin.pathname.length)
					);
					const destination = resolve(root, pathname || '.');
					if (relative(root, destination).split(sep).includes('..'))
						throw new Error(`${page}: link leaves build directory: ${link}`);
					let target = pathname;
					try {
						if ((await stat(destination)).isDirectory())
							target = relative(root, resolve(destination, 'index.html'));
						await stat(resolve(root, target));
					} catch {
						throw new Error(`${page}: missing target: ${link}`);
					}
					if (url.hash && target.endsWith('.html')) {
						const id = decodeURIComponent(url.hash.slice(1));
						if (!documents.get(target)?.ids.has(id))
							throw new Error(`${page}: missing anchor: ${link}`);
					}
					checked++;
				}
			}
			console.log(
				`Checked ${checked} local links and assets across ${pages.length} built pages`
			);
		}
	)
);
