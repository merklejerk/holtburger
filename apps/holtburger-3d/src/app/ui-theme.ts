// Keep this as a file: the production CSP does not permit data-URL stylesheets.
import holtburgerStandardUrl from "./themes/holtburger-standard.css?url&no-inline";

// Appearance is published by the stylesheet loader. Absorb asset-module updates so
// editing the theme in Vite does not reload the page and discard component state.
if (import.meta.hot) {
	import.meta.hot.accept(
		"./themes/holtburger-standard.css?url&no-inline",
		() => {},
	);
}

/** Bundled themes and caller-supplied themes use the same stylesheet URL boundary. */
export const defaultUiThemeUrl = holtburgerStandardUrl;

/** Document-owned stylesheets; switching appearance never owns component lifetime. */
export function createUiThemeLoader(owner: Document) {
	let active: HTMLLinkElement[] = [];
	let queue = Promise.resolve();

	/** Stage a stylesheet without applying it until the complete selection has loaded. */
	function load(url: string): Promise<HTMLLinkElement> {
		return new Promise((resolve, reject) => {
			const link = owner.createElement("link");
			link.rel = "stylesheet";
			link.media = "not all";
			link.href = url;
			link.onload = () => {
				link.onload = null;
				link.onerror = null;
				resolve(link);
			};
			link.onerror = () => {
				link.remove();
				reject(new Error(`Could not load UI stylesheet: ${url}`));
			};
			owner.head.append(link);
		});
	}

	return {
		/** Replace the whole selection atomically; null removes the optional override. */
		replace(themeUrl: string, overrideUrl: string | null): Promise<void> {
			const update = async () => {
				const staged: HTMLLinkElement[] = [];
				try {
					staged.push(await load(themeUrl));
					if (overrideUrl !== null) staged.push(await load(overrideUrl));
				} catch (error) {
					for (const link of staged) link.remove();
					throw error;
				}
				for (const link of staged) link.media = "all";
				for (const link of active) link.remove();
				active = staged;
			};
			const result = queue.then(update);
			// A failed request is reported to its caller but must not poison subsequent selections.
			queue = result.then(
				() => {},
				() => {},
			);
			return result;
		},
		/** Release styles after previously requested updates finish. */
		dispose(): Promise<void> {
			queue = queue.then(() => {
				for (const link of active) link.remove();
				active = [];
			});
			return queue;
		},
	};
}
