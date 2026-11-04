/** Render retained dependency causes once, including aggregates and cyclic/non-Error failures. */
export function formatError(error: unknown): string {
	const seen = new Set<unknown>();
	function visit(value: unknown): string {
		if (!(value instanceof Error)) return String(value);
		if (seen.has(value)) return "[repeated error]";
		seen.add(value);
		const details =
			value instanceof AggregateError ? value.errors.map(visit) : [];
		if (value.cause !== undefined) details.push(visit(value.cause));
		return [value.message, ...details].filter(Boolean).join("\nCaused by: ");
	}
	return visit(error);
}
