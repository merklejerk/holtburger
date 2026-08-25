export interface EntryPath {
	readonly path: string;
	readonly title: string;
}

export function buildEntryPath(
	basePath: string,
	args: readonly string[],
): string;
export function requireEntry(value: string | undefined): EntryPath;
