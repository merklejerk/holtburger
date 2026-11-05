import { readFile, writeFile } from 'node:fs/promises';

/** Preserve mtimes so generation does not invalidate unchanged Vite modules. */
export async function writeIfChanged(
	/** @type {URL} */ path,
	/** @type {string | Uint8Array} */ content
) {
	const bytes = typeof content === 'string' ? Buffer.from(content) : content;
	try {
		if ((await readFile(path)).equals(bytes)) return;
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		)
			throw error;
	}
	await writeFile(path, content);
}
