import type {
	ClientCharacter,
	ClientExitRequested,
	ClientLifecycle,
} from "./client-host-contract";

/** One renderer-owned lifecycle state; selection is represented only while characters are visible. */
export type ClientLifecycleUiState =
	| { readonly kind: "connecting" }
	| { readonly kind: "authenticating" }
	| {
			readonly kind: "character-selection";
			readonly characters: readonly ClientCharacter[];
			readonly selectedGuid: number | null;
	  }
	| { readonly kind: "entering-world"; readonly characterGuid: number }
	| ClientLifecyclePortalSpace
	| { readonly kind: "in-world" }
	| {
			readonly kind: "exiting";
			readonly cause: ClientExitRequested["cause"];
			readonly diagnostic: string | null;
	  };

export type ClientLifecycleUiAction =
	| { readonly type: "authority"; readonly lifecycle: ClientLifecycle }
	| { readonly type: "select"; readonly guid: number }
	| { readonly type: "exit"; readonly exit: ClientExitRequested };

/** Initial launch state before the host's atomic current-state response arrives. */
export function initialClientLifecycleUiState(): ClientLifecycleUiState {
	return { kind: "connecting" };
}

/** Whether this lifecycle phase requires the frontend's world-presentation installation. */
export function clientLifecycleUsesWorldPresentation(
	state: ClientLifecycleUiState,
): boolean {
	return (
		state.kind === "entering-world" ||
		state.kind === "portal-space" ||
		state.kind === "in-world"
	);
}

/** Whether the frontend owns live character input for this authority phase. */
export function clientLifecycleEnablesWorldInput(
	state: ClientLifecycleUiState,
): boolean {
	return state.kind === "in-world";
}

/**
 * Applies one authority or local-selection edge without introducing retry or credential state.
 * Terminal exit is absorbing: a late lifecycle packet cannot resurrect a closed client shell.
 */
export function reduceClientLifecycleUiState(
	state: ClientLifecycleUiState,
	action: ClientLifecycleUiAction,
): ClientLifecycleUiState {
	if (state.kind === "exiting") return state;

	switch (action.type) {
		case "authority":
			return fromAuthorityLifecycle(state, action.lifecycle);
		case "select":
			if (state.kind !== "character-selection") return state;
			if (
				!state.characters.some((character) => character.guid === action.guid)
			) {
				return state;
			}
			return { ...state, selectedGuid: action.guid };
		case "exit":
			return {
				kind: "exiting",
				cause: action.exit.cause,
				diagnostic: action.exit.diagnostic,
			};
	}
}

/** Hidden destination staging while the authority waits for collision and presentation readiness. */
type ClientLifecyclePortalSpace = Extract<
	ClientLifecycle,
	{ readonly kind: "portal-space" }
>;

function fromAuthorityLifecycle(
	previous: ClientLifecycleUiState,
	lifecycle: ClientLifecycle,
): ClientLifecycleUiState {
	if (lifecycle.kind !== "character-selection") {
		return lifecycle.kind === "exiting"
			? { ...lifecycle, diagnostic: null }
			: lifecycle;
	}

	const selectedGuid =
		previous.kind === "character-selection" &&
		previous.selectedGuid !== null &&
		lifecycle.characters.some(
			(character) => character.guid === previous.selectedGuid,
		)
			? previous.selectedGuid
			: null;
	return { ...lifecycle, selectedGuid };
}
