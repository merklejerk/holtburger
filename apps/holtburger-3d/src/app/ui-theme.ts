import { UI_THEME_LOAD_TIMEOUT_MS } from "./ui-theme-contract";

/** Cold notification after a complete stylesheet selection has become active. */
export const UI_THEME_CHANGED_EVENT = "holtburger-ui-theme-changed";

/** Document-owned stylesheets; switching appearance never owns component lifetime. */
export function createUiThemeLoader(owner: Document) {
	let active: HTMLLinkElement[] = [];
	let queue = Promise.resolve();

	/** Stage a stylesheet without applying it until the complete selection has loaded. */
	function load(url: string, signal: AbortSignal): Promise<HTMLLinkElement> {
		return new Promise((resolve, reject) => {
			signal.throwIfAborted();
			const link = owner.createElement("link");
			const cleanup = () => {
				link.onload = null;
				link.onerror = null;
				signal.removeEventListener("abort", abort);
			};
			const fail = (error: unknown) => {
				cleanup();
				link.remove();
				reject(error);
			};
			const abort = () => fail(signal.reason);
			link.rel = "stylesheet";
			link.media = "not all";
			link.href = url;
			link.onload = () => {
				cleanup();
				resolve(link);
			};
			link.onerror = () =>
				fail(new Error(`Could not load UI stylesheet: ${url}`));
			signal.addEventListener("abort", abort, { once: true });
			owner.head.append(link);
		});
	}

	return {
		/** Replace optional stylesheets atomically; null selects the base appearance for that slot. */
		replace(
			themeUrl: string | null,
			overrideUrl: string | null,
			signal?: AbortSignal,
		): Promise<void> {
			const update = async () => {
				signal?.throwIfAborted();
				const deadline = new AbortController();
				const timer = setTimeout(
					() => deadline.abort(new Error("UI stylesheet load timed out")),
					UI_THEME_LOAD_TIMEOUT_MS,
				);
				const request =
					signal === undefined
						? deadline.signal
						: AbortSignal.any([signal, deadline.signal]);
				const staged: HTMLLinkElement[] = [];
				try {
					if (themeUrl !== null) staged.push(await load(themeUrl, request));
					if (overrideUrl !== null)
						staged.push(await load(overrideUrl, request));
					request.throwIfAborted();
				} catch (error) {
					for (const link of staged) link.remove();
					throw error;
				} finally {
					clearTimeout(timer);
				}
				for (const link of staged) link.media = "all";
				for (const link of active) link.remove();
				active = staged;
				owner.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
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

/** Resolve canvas/UI appearance on stylesheet commits and local scope changes, never per frame. */
export function observeUiTheme(
	element: HTMLElement,
	refresh: () => void,
): () => void {
	// Resolve before subscribing so invalid themes do not leak observers.
	refresh();
	const observer = new MutationObserver(refresh);
	observer.observe(element, {
		attributes: true,
		attributeFilter: ["style", "class"],
	});
	const document = element.ownerDocument;
	document.addEventListener(UI_THEME_CHANGED_EVENT, refresh);
	return () => {
		observer.disconnect();
		document.removeEventListener(UI_THEME_CHANGED_EVENT, refresh);
	};
}
