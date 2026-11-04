import { defineConfig, normalizePath, type Plugin } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { mdsvex } from 'mdsvex';
import sirv from 'sirv';
import { headingIds } from './scripts/heading-ids.ts';

const base = '/holtburger';

/** Source edits refresh build-owned metadata and copies; generated writes never retrigger it. */
function authoringRefresh(): Plugin {
	const execute = promisify(execFile);
	const root = fileURLToPath(new URL('.', import.meta.url));
	const path = (relative: string) =>
		normalizePath(fileURLToPath(new URL(relative, import.meta.url)));
	const content = path('./src/content/');
	const generated = [
		path('./src/content/start/3d/'),
		path('./src/content/tui/install/')
	];
	const quickstarts = path('../release/quickstarts/');
	const catalog = path('./src/lib/media/catalog.ts');
	const captures = path('./authoring/captures.json');
	const assets = [
		path('../assets/branding/'),
		path('../assets/screenshots/'),
		path('../apps/holtburger-3d/public/fonts/'),
		path('../apps/holtburger-3d/src/assets/icons/travelers-kit-frame.svg'),
		path('../apps/holtburger-3d/src/assets/icons/travelers-kit-leather.svg'),
		path('./examples/'),
		path('../crates/holtburger-scripting/holtburger.d.ts')
	];
	return {
		name: 'holtburger-authoring-refresh',
		configureServer(server) {
			// Search uses the latest production index while source pages reload live.
			server.middlewares.use(
				`${base}/pagefind`,
				sirv(path('./build/pagefind/'), { dev: true })
			);
			let queue = Promise.resolve();
			server.watcher.add([quickstarts, catalog, captures, ...assets]);
			const refresh = (event: string, changed: string) => {
				if (!['add', 'change', 'unlink'].includes(event)) return;
				const file = normalizePath(changed);
				const copyAssets = assets.some(
					(source) =>
						file === source || (source.endsWith('/') && file.startsWith(source))
				);
				const sourceChanged =
					file === catalog ||
					file === captures ||
					file.startsWith(quickstarts) ||
					(file.startsWith(content) &&
						file.endsWith('.md') &&
						!generated.some((prefix) => file.startsWith(prefix)));
				if (!copyAssets && !sourceChanged) return;
				// Asset/content preparation shares generated directories, so edits run serially.
				queue = queue
					.then(async () => {
						if (copyAssets)
							await execute(process.execPath, ['scripts/prepare-assets.mjs'], {
								cwd: root
							});
						await execute(process.execPath, ['scripts/prepare-content.mjs'], {
							cwd: root
						});
						server.ws.send({ type: 'full-reload' });
					})
					.catch((error: unknown) => {
						const message =
							error instanceof Error ? error.message : String(error);
						server.config.logger.error(message);
						server.ws.send({
							type: 'error',
							err: {
								message,
								stack:
									error instanceof Error ? (error.stack ?? message) : message
							}
						});
					});
			};
			server.watcher.on('all', refresh);
			server.httpServer?.once('close', () =>
				server.watcher.off('all', refresh)
			);
		}
	};
}

export default defineConfig({
	plugins: [
		authoringRefresh(),
		sveltekit({
			adapter: adapter(),
			extensions: ['.svelte', '.md'],
			preprocess: mdsvex({ extensions: ['.md'], remarkPlugins: [headingIds] }),
			paths: { base }
		})
	]
});
