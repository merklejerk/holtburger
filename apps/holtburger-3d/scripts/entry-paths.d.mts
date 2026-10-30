export interface EntryPath {
	readonly path: string;
	readonly title: string;
}

/** Select the client unless the caller explicitly supplies an entry name. */
export function extractEntryArguments(args: readonly string[]): {
	readonly name: "client" | "explorer";
	readonly args: readonly string[];
};

export function extractContentArguments(
	args: readonly string[],
	invocationDirectory: string,
): {
	contentPath: string | null;
	/** Suppress default discovery for this desktop launch. */
	noContentSearch: boolean;
	/** Forget the saved location before desktop startup. */
	clearContent: boolean;
	args: string[];
};

export function buildEntryPath(
	basePath: string,
	args: readonly string[],
): string;
export function collapseRendererArguments(args: readonly string[]): string[];
/** Consume shell flags and translate the effective debug query after client arguments are partitioned. */
export function extractElectronLaunchArguments(args: readonly string[]): {
	args: string[];
	electronSwitches: string[];
};
export type ClientLaunchArgumentName =
	| "server"
	| "host"
	| "port"
	| "account"
	| "password"
	| "melee-max-chase-distance"
	| "ignore-config"
	| "ignore-world-map-cache"
	| "settings-file"
	| "no-launcher";
export function parseClientLaunchArgument(argument: string): {
	readonly name: ClientLaunchArgumentName;
	readonly value: string | undefined;
} | null;
export function partitionClientLaunchArguments(
	args: readonly string[],
	settingsDirectory?: string,
): {
	launchArguments: string[];
	rendererArguments: string[];
};
export function stripClientLaunchArguments(args: readonly string[]): string[];
export function extractVitePortArguments(
	args: readonly string[],
	options?: { readonly allowPortAlias?: boolean },
): { args: string[]; vitePort?: string };
export function requireEntry(value: string | undefined): EntryPath;
