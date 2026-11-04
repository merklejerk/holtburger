import {
	TRAVELERS_KIT_THEME_ID,
	type UiThemeTransport,
} from "./ui-theme-contract";
import travelersKitUrl from "./themes/travelers-kit.css?url&no-inline";

/** Trusted build-owned assets never cross the native URL validation boundary. */
const bundledThemes = new Map([[TRAVELERS_KIT_THEME_ID, travelersKitUrl]]);

// Material edits use the existing explicit Reload theme action in the showcase.
if (import.meta.hot) {
	import.meta.hot.accept("./themes/travelers-kit.css?url&no-inline", () => {});
}

/** Combine shipped choices with user discovery while preserving the existing selection lifetime. */
export function withBundledUiThemes(
	source: UiThemeTransport,
): UiThemeTransport {
	return {
		initialIds: [...bundledThemes.keys(), ...source.initialIds],
		async list() {
			const ids = await source.list();
			const collision = ids.find((id) => bundledThemes.has(id));
			if (collision !== undefined) {
				throw new Error(
					`Theme name “${collision}” is reserved for a bundled theme. Rename that folder in your themes directory, then refresh the list.`,
				);
			}
			return [...bundledThemes.keys(), ...ids];
		},
		async resolve(id) {
			const url = bundledThemes.get(id);
			if (url === undefined) return source.resolve(id);
			// Dev material edits retain explicit reload without caching the previous response.
			return import.meta.env.DEV
				? `${url}${url.includes("?") ? "&" : "?"}theme-reload=${performance.now()}`
				: url;
		},
		openDirectory: () => source.openDirectory(),
	};
}
