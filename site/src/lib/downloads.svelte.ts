import snapshot from './generated/release.json';
import { readRelease } from './downloads.ts';

/** Prerendered fallback and browser refresh share one coherent release across all pages. */
export const downloads = $state({
	release: readRelease(snapshot),
	refreshFailed: false
});
let refreshing = false;

/** Refresh on arrival/focus without blocking navigation or discarding usable cached links on failure. */
export async function refreshDownloads(
	url: string,
	signal: AbortSignal
): Promise<void> {
	if (refreshing) return;
	refreshing = true;
	try {
		const response = await fetch(url, {
			cache: 'no-store',
			signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
		});
		if (!response.ok)
			throw new Error(`Release beacon returned HTTP ${response.status}`);
		const release = readRelease(await response.json());
		if (signal.aborted) return;
		downloads.release = release;
		downloads.refreshFailed = false;
	} catch (error) {
		if (signal.aborted) return;
		downloads.refreshFailed = true;
		console.warn('Could not refresh release downloads', error);
	} finally {
		refreshing = false;
	}
}
