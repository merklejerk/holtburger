import { onDestroy } from "svelte";
import {
	UiThemeSelection,
	type UiThemeSettings,
} from "../../app/ui-theme-selection";
import { uiThemes } from "../../app/mount";
import steelUrl from "./themes/steel.css?url&no-inline";
import opaqueUrl from "./themes/opaque.css?url&no-inline";
import { withBundledUiThemes } from "../../app/ui-bundled-themes";

export { steelUrl, opaqueUrl };

/** Extra diagnostic stylesheet; shipped choices come from the production composition. */
const fixtureThemeTransport = withBundledUiThemes({
	initialIds: ["Steel fixture"],
	list: async () => ["Steel fixture"],
	resolve: async (id) => {
		if (id !== "Steel fixture") throw new Error(`Unknown fixture theme: ${id}`);
		const url = new URL(steelUrl, document.baseURI);
		url.searchParams.set("fixture-reload", String(performance.now()));
		return url.href;
	},
	openDirectory: async () => {
		throw new Error("The browser fixture has no desktop themes folder");
	},
});

/** Sidebar choices match the same transport used by production settings controls. */
export const fixtureThemeIds = fixtureThemeTransport.initialIds;

/** Showcase previews use the same selector owner and may add the existing opaque override. */
export interface ShowcaseThemeSettings extends UiThemeSettings {
	/** Diagnostic appearance only; never constructs or replaces the client fixture. */
	applyPreview: (id: string | null, opaque: boolean) => Promise<void>;
}

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
): ShowcaseThemeSettings {
	let previewOpaque = false;
	const owner = new UiThemeSelection(fixtureThemeTransport, {
		replace: (url, _override, signal) =>
			uiThemes.replace(url, previewOpaque ? opaqueUrl : null, signal),
	});
	void owner.refresh();
	onDestroy(() => {
		void owner.retire();
	});
	async function select(id: string | null): Promise<void> {
		if (await owner.select(id)) commit(id);
	}
	return {
		owner,
		select,
		async applyPreview(id, opaque) {
			previewOpaque = opaque;
			await select(id);
			const state = owner.read().selection;
			if (state.kind === "failed") throw new Error(state.message);
		},
	};
}
