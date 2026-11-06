import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** An absent default permits published-media development; explicit mistakes fail loudly. */
export function developmentMediaLibrary() {
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const selected = process.env.HOLTBURGER_SITE_MEDIA ?? 'local/site-media';
	if (selected.trim().length === 0)
		throw new Error('Site media library path must not be empty');
	const path = resolve(root, selected);
	const info = statSync(path, { throwIfNoEntry: false });
	if (info === undefined && process.env.HOLTBURGER_SITE_MEDIA === undefined)
		return null;
	if (!info?.isDirectory())
		throw new Error(`Site media library is not a directory: ${path}`);
	return path;
}
