/** Whether the client entry was launched with the explicit `--debug` renderer flag. */
export function clientDebugEnabled(search: string): boolean {
	return new URLSearchParams(search).get("debug") === "true";
}
