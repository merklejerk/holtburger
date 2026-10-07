/** ACE PlayerManager.cs:521 strips leading pluses and looks up names case-insensitively. */
export function characterLookupName(name: string): string {
	return name.replace(/^\++/, "").toLowerCase();
}
