import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { mdsvex } from 'mdsvex';
import sirv from 'sirv';
import { headingIds } from './scripts/heading-ids.ts';

const base = '/holtburger';

/** Expose the last built search index; this does not watch or reload anything. */
function developmentSearch(): Plugin {
	return {
		name: 'holtburger-development-search',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(
				`${base}/pagefind`,
				sirv(fileURLToPath(new URL('./build/pagefind/', import.meta.url)), {
					dev: true
				})
			);
		}
	};
}

export default defineConfig({
	server: {
		host: '127.0.0.1',
		port: 4178,
		strictPort: true,
		// Static-adapter output is not an input to the development server.
		watch: { ignored: ['**/build/**'] }
	},
	plugins: [
		developmentSearch(),
		sveltekit({
			adapter: adapter(),
			extensions: ['.svelte', '.md'],
			preprocess: mdsvex({ extensions: ['.md'], remarkPlugins: [headingIds] }),
			paths: { base }
		})
	]
});
