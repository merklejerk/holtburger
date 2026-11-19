import type { AppBuild } from "./app-build-contract";

/** Replaced by Vite; build metadata never depends on the runtime host connection. */
declare const __HOLTBURGER_APP_BUILD__: AppBuild;

const build = __HOLTBURGER_APP_BUILD__;

/** Development labels describe the Vite startup snapshot, including across subsequent HMR edits. */
export const APP_BUILD_LABEL = [
	...(build.development ? ["DEV"] : []),
	`v${build.version}`,
	build.revision,
	...(build.modified ? ["modified"] : []),
].join(" · ");
