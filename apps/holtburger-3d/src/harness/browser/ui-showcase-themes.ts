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
