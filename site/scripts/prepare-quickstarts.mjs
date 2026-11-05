import { writeIfChanged } from './write-if-changed.mjs';
import { mkdir, readFile } from 'node:fs/promises';

/** Render bundled platform instructions with website-owned 3D connection guidance. */
export async function prepareQuickstarts() {
	const products = [
		{ source: '3d', route: 'start/3d', title: 'Holtburger 3D' },
		{ source: 'cli', route: 'tui/install', title: 'Holtburger TUI' }
	];
	const platforms = [
		{ source: 'linux', route: 'linux', title: 'Linux (x86-64)' },
		{ source: 'win32', route: 'windows', title: 'Windows (x86-64)' },
		{ source: 'darwin', route: 'macos', title: 'macOS (Apple Silicon)' }
	];
	for (const product of products) {
		const destination = new URL(
			`../src/content/${product.route}/`,
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
			let body = source.replace(/^# [^\r\n]+\r?\n+/, '');
			// Web onboarding owns connection; bundled quickstarts remain self-contained.
			if (product.source === '3d') {
				body = body.replace(
					/## Connect\r?\n[\s\S]*?(?=\r?\n## )/,
					'## Connect\n\n[Import your server from TreeStats and enter the world](/holtburger/start/).\n'
				);
			}
			const title = `${product.title} for ${platform.title}`;
			const description =
				'Install, connect, update, and troubleshoot your release bundle.';
			await writeIfChanged(
				new URL(`${platform.route}.md`, destination),
				`---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsection: 'Installation'\n---\n\n<script>\nimport Downloads from '#lib/components/Downloads.svelte';\n</script>\n\n## Download\n\n<Downloads product="${product.source}" platform="${platform.route}" />\n\n${body}`
			);
		}
	}
}
