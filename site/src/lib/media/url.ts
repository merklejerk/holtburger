/** Vite enables local resolution only when serving with an available media library. */
declare const __SITE_LOCAL_MEDIA__: boolean;

/** Rewrite only this repository's media; unrelated hosts and bundled assets stay intact. */
export function mediaUrlForMode(url: string, local: boolean): string {
	const published = 'https://merklejerk.github.io/holtburger-media/';
	return local && url.startsWith(published)
		? `/holtburger/media/${url.slice(published.length)}`
		: url;
}

/** Resolve at the rendering boundary so catalogs and publication checks retain public URLs. */
export function mediaUrl(url: string): string {
	return mediaUrlForMode(url, __SITE_LOCAL_MEDIA__);
}
