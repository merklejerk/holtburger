/** App-owned label only; matching and commands must retain the server-authored name. */
export function entityDisplayName(name: string, guid: number): string {
	return name.trim().length === 0
		? `[Unnamed · 0x${guid.toString(16).padStart(8, "0").toUpperCase()}]`
		: name;
}
