/** One attention signal drives gameplay output and title-music policy. */
export function bindClientAudioForeground(
	setForeground: (foreground: boolean) => void,
	window: Window,
): () => void {
	const document = window.document;
	const lifetime = new AbortController();
	const options = { signal: lifetime.signal };
	const update = () => setForeground(document.hasFocus() && !document.hidden);
	window.addEventListener("focus", update, options);
	window.addEventListener("blur", update, options);
	document.addEventListener("visibilitychange", update, options);
	update();
	return () => lifetime.abort();
}
