import { parseExplorerWcid } from "./entity-commands";

/** Input intent is classified before validation so partial numeric text never becomes a query. */
export type ExplorerWeenieInputIntent =
	| { readonly kind: "empty" }
	| {
			readonly kind: "numeric";
			readonly result:
				| { readonly kind: "valid"; readonly value: number }
				| { readonly kind: "invalid"; readonly message: string };
	  }
	| { readonly kind: "search"; readonly query: string };

/** Whether one asynchronous query settlement still belongs to the latest authored input. */
export type ExplorerWeenieSearchSettlement<T> =
	{ readonly kind: "current"; readonly value: T } | { readonly kind: "stale" };

/** Classify direct-WCID intent while preserving mixed digit-leading authored names for search. */
export function classifyExplorerWeenieInput(
	input: string,
): ExplorerWeenieInputIntent {
	const trimmed = input.trim();
	if (trimmed.length === 0) return { kind: "empty" };
	if (/^[0-9]+$/.test(trimmed) || /^0[xX]/.test(trimmed)) {
		try {
			return {
				kind: "numeric",
				result: { kind: "valid", value: parseExplorerWcid(trimmed) },
			};
		} catch (error) {
			return {
				kind: "numeric",
				result: {
					kind: "invalid",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}
	return { kind: "search", query: trimmed };
}

/** Reject late successes and failures through the same revision decision. */
export function settleExplorerWeenieSearch<T>(
	currentRevision: number,
	requestRevision: number,
	value: T,
): ExplorerWeenieSearchSettlement<T> {
	return currentRevision === requestRevision
		? { kind: "current", value }
		: { kind: "stale" };
}
