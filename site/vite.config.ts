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

/** Refresh only generated page metadata; Vite owns browser updates. */
function authoringRefresh(): Plugin {
	const execute = promisify(execFile);
	const root = fileURLToPath(new URL('.', import.meta.url));
	const path = (relative: string) =>
		normalizePath(fileURLToPath(new URL(relative, import.meta.url)));
	const content = path('./src/content/');
	const quickstarts = path('../release/quickstarts/');
	return {
		name: 'holtburger-content-metadata',
		configureServer(server) {
			// Search uses the latest production index during local development.
			server.middlewares.use(
				`${base}/pagefind`,
				sirv(path('./build/pagefind/'), { dev: true })
			);
			let timer: ReturnType<typeof setTimeout> | undefined;
			let queue = Promise.resolve();
			let quickstartsChanged = false;
			server.watcher.add(quickstarts);
			const refresh = (event: string, changed: string) => {
				if (!['add', 'change', 'unlink'].includes(event)) return;
				const file = normalizePath(changed);
				if (!file.endsWith('.md')) return;
				if (!file.startsWith(content) && !file.startsWith(quickstarts)) return;
				quickstartsChanged ||= file.startsWith(quickstarts);
				clearTimeout(timer);
				timer = setTimeout(() => {
					const prepareQuickstarts = quickstartsChanged;
					quickstartsChanged = false;
					queue = queue
						.then(async () => {
							await execute(
								process.execPath,
								[
									'scripts/prepare-content.mjs',
									'--metadata-only',
									...(prepareQuickstarts ? ['--quickstarts'] : [])
								],
								{ cwd: root }
							);
						})
						.catch((error: unknown) => {
							const message =
								error instanceof Error ? error.message : String(error);
							server.config.logger.error(message);
							server.ws.send({
								type: 'error',
								err: { message, stack: message }
							});
						});
				}, 150);
			};
			server.watcher.on('all', refresh);
			server.httpServer?.once('close', () => {
				clearTimeout(timer);
				server.watcher.off('all', refresh);
			});
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
