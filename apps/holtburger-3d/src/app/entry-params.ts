export interface EntryParam {
	/** Query-string key supplied to the launched page. */
	readonly key: string;
	/** Query-string value supplied to the launched page. */
	readonly value: string;
}

export function readEntryParams(
	search = globalThis.location?.search ?? "",
): readonly EntryParam[] {
	const params = new URLSearchParams(search);

	return Array.from(params.entries()).map(([key, value]) => ({ key, value }));
}
