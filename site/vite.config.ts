import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { mdsvex } from 'mdsvex';
import sirv from 'sirv';
import { developmentMediaLibrary } from './scripts/media-library.mjs';
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

export default defineConfig(({ command, isPreview }) => {
	const library =
		command === 'serve' && !isPreview ? developmentMediaLibrary() : null;
	return {
		define: { __SITE_LOCAL_MEDIA__: JSON.stringify(library !== null) },
		server: {
			host: '127.0.0.1',
			port: 4178,
			strictPort: true,
			// Static-adapter output is not an input to the development server.
			watch: { ignored: ['**/build/**'] }
		},
		plugins: [
			developmentSearch(),
			{
				name: 'holtburger-development-media',
				apply: 'serve',
				configureServer(server) {
					if (library === null) return;
					server.config.logger.info(`Site media library: ${library}`);
					const serve = sirv(library, {
						dev: true,
						etag: false,
						dotfiles: false
					});
					server.middlewares.use(`${base}/media`, (request, response) => {
						response.setHeader('Cache-Control', 'no-store');
						serve(request, response, () => {
							response.statusCode = 404;
							response.end('Media file not found in local library');
						});
					});
				}
			},
			sveltekit({
				adapter: adapter(),
				extensions: ['.svelte', '.md'],
				preprocess: mdsvex({
					extensions: ['.md'],
					remarkPlugins: [headingIds]
				}),
				paths: { base }
			})
		]
	};
});
