export interface EntryPath {
	readonly path: string;
	readonly title: string;
}

export function buildEntryPath(
	basePath: string,
	args: readonly string[],
): string;
export function collapseRendererArguments(args: readonly string[]): string[];
export function partitionClientLaunchArguments(args: readonly string[]): {
	launchArguments: string[];
	rendererArguments: string[];
};
export function stripClientLaunchArguments(args: readonly string[]): string[];
export function extractVitePortArguments(
	args: readonly string[],
	options?: { readonly allowPortAlias?: boolean },
): { args: string[]; vitePort?: string };
export function requireEntry(value: string | undefined): EntryPath;
