import type { Component } from 'svelte';
import catalog from '../generated/pages.json';

/** mdsvex compiles author-owned content into a lazily loaded Svelte component. */
interface ContentModule {
	default: Component;
}
const modules = import.meta.glob<ContentModule>('/src/content/**/*.md');

/** Prerendering, navigation and guide headings share build-produced metadata. */
export const pages = catalog;

export async function loadGuide(slug: string) {
	const entry = pages.find((page) => page.slug === slug);
	if (!entry) return null;
	const importer = modules[entry.path];
	if (!importer) throw new Error(`Missing compiled guide: ${slug}`);
	return { ...entry, Content: (await importer()).default };
}
