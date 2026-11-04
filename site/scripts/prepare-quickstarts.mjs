import { mkdir, readFile, writeFile } from 'node:fs/promises';

/** Render the same installation instructions shipped inside each release bundle. */
export async function prepareQuickstarts() {
	const products = [
		{ source: '3d', route: '3d', title: 'Holtburger 3D' },
		{ source: 'cli', route: 'tui', title: 'Holtburger TUI' }
	];
	const platforms = [
		{ source: 'linux', route: 'linux', title: 'Linux (x86-64)' },
		{ source: 'win32', route: 'windows', title: 'Windows (x86-64)' },
		{ source: 'darwin', route: 'macos', title: 'macOS (Apple Silicon)' }
	];
	for (const product of products) {
		const destination = new URL(
			`../src/content/start/${product.route}/`,
			import.meta.url
		);
		await mkdir(destination, { recursive: true });
		for (const platform of platforms) {
			const path = `release/quickstarts/${product.source}/${platform.source}.md`;
			const source = await readFile(
				new URL(`../../${path}`, import.meta.url),
				'utf8'
			);
			if (!/^# [^\r\n]+\r?\n/.test(source))
				throw new Error(`${path} requires an opening title`);
			const body = source.replace(/^# [^\r\n]+\r?\n+/, '');
			const title = `${product.title} for ${platform.title}`;
			const description =
				'Install, connect, update, and troubleshoot your release bundle.';
			await writeFile(
				new URL(`${platform.route}.md`, destination),
				`---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsection: 'Installation'\n---\n\n${body}`
			);
		}
	}
}
