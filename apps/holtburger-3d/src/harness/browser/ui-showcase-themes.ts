import { onDestroy } from "svelte";
import {
	UiThemeSelection,
	type UiThemeSettings,
} from "../../app/ui-theme-selection";
import { uiThemes } from "../../app/mount";
import steelUrl from "./themes/steel.css?url&no-inline";
import opaqueUrl from "./themes/opaque.css?url&no-inline";

export { steelUrl, opaqueUrl };

// Keep fixture edits behind Reload theme. This belongs outside Svelte modules,
// whose HMR transform rewrites accept calls to component-export acceptance.
if (import.meta.hot) {
	import.meta.hot.accept(
		["./themes/steel.css?url&no-inline", "./themes/opaque.css?url&no-inline"],
		() => {},
	);
}

/** Browser-only injected capability for production controls; never guesses a desktop bridge. */
export function createFixtureThemeSettings(
	commit: (id: string | null) => void,
): UiThemeSettings {
	const owner = new UiThemeSelection(
		{
			list: async () => ["Steel fixture"],
			resolve: async (id) => {
				if (id !== "Steel fixture")
					throw new Error(`Unknown fixture theme: ${id}`);
				const url = new URL(steelUrl, document.baseURI);
				url.searchParams.set("fixture-reload", String(performance.now()));
				return url.href;
			},
			openDirectory: async () => {
				throw new Error("The browser fixture has no desktop themes folder");
			},
		},
		uiThemes,
	);
	void owner.refresh();
	onDestroy(() => {
		void owner.retire();
	});
	return {
		owner,
		async select(id) {
			if (await owner.select(id)) commit(id);
		},
	};
}
