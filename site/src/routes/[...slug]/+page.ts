import { error } from '@sveltejs/kit';
import { loadGuide, pages } from '#lib/content/registry.ts';
import type { PageLoad, EntryGenerator } from './$types';

export const entries: EntryGenerator = () =>
	pages.map(({ slug }) => ({ slug }));
export const load: PageLoad = async ({ params }) => {
	const guide = await loadGuide(params.slug.replace(/\/$/, ''));
	if (!guide) error(404, 'This page could not be found.');
	return guide;
};
