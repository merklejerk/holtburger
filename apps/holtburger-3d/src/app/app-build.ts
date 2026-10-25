/** Source identity captured once when Vite starts or builds the frontend. */
export interface AppBuild {
	/** True for a live Vite development server, rather than packaged output. */
	readonly development: boolean;
	/** Electron app release version, owned by package.json. */
	readonly version: string;
	/** Abbreviated Git commit identifying the source checkout. */
	readonly revision: string;
	/** Includes tracked edits, untracked files, and changed submodules at capture time. */
	readonly modified: boolean;
}

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
