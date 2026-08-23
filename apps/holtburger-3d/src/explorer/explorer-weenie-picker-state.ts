import {
	parseExplorerWcid,
	type ExplorerWeenieSearchResult,
} from "./explorer-entity-commands";

/** User input while no exact catalog result has been committed. */
interface EditingExplorerWeeniePicker {
	readonly kind: "editing";
	readonly input: string;
}

/** One explicitly committed catalog identity and its stable visible label. */
interface SelectedExplorerWeeniePicker {
	readonly kind: "selected";
	readonly input: string;
	readonly selection: ExplorerWeenieSearchResult;
}

/** Picker state keeps unresolved text structurally separate from an exact catalog identity. */
export type ExplorerWeeniePickerState =
	EditingExplorerWeeniePicker | SelectedExplorerWeeniePicker;

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

/** Any authored edit invalidates a committed identity immediately. */
export function editExplorerWeeniePicker(
	input: string,
): ExplorerWeeniePickerState {
	return { kind: "editing", input };
}

/** Commit only an exact result chosen through explicit pointer or keyboard action. */
export function selectExplorerWeenie(
	selection: ExplorerWeenieSearchResult,
): ExplorerWeeniePickerState {
	return { kind: "selected", input: selection.name, selection };
}

/** Resolve the one exact numeric target accepted by the existing spawn request contract. */
export function resolveExplorerWeenieSpawnTarget(
	state: ExplorerWeeniePickerState,
): number {
	if (state.kind === "selected") return state.selection.wcid;
	const intent = classifyExplorerWeenieInput(state.input);
	if (intent.kind === "numeric") {
		if (intent.result.kind === "valid") return intent.result.value;
		throw new Error(intent.result.message);
	}
	throw new Error("Choose a weenie search result or enter a WCID.");
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
