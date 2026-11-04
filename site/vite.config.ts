import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { mdsvex } from 'mdsvex';
import { headingIds } from './scripts/heading-ids.ts';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			extensions: ['.svelte', '.md'],
			preprocess: mdsvex({ extensions: ['.md'], remarkPlugins: [headingIds] }),
			paths: { base: '/holtburger' }
		})
	]
});
