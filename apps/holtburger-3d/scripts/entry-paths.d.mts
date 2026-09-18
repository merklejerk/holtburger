export interface EntryPath {
	readonly path: string;
	readonly title: string;
}

export function buildEntryPath(
	basePath: string,
	args: readonly string[],
): string;
export function collapseRendererArguments(args: readonly string[]): string[];
export type ClientLaunchArgumentName =
	"server" | "host" | "port" | "account" | "password" | "ignore-config";
export function parseClientLaunchArgument(argument: string): {
	readonly name: ClientLaunchArgumentName;
	readonly value: string | undefined;
} | null;
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
