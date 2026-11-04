import type { CharacterManagementState } from "./client-host-contract";

/** Character-selection actions; the session resolves identity against the current roster. */
export interface CharacterSelectionActions {
	readonly delete: (guid: number) => Promise<void>;
	readonly restore: (guid: number) => Promise<void>;
}

/** ACE decorates privileged roster names with one leading plus sign. */
export function characterConfirmationName(name: string): string {
	return name.replace(/^\+/, "").trim();
}

/** Preserve meaningful punctuation and internal spacing while tolerating casing and edge spaces. */
export function characterDeletionNameMatches(
	input: string,
	name: string,
): boolean {
	return (
		input.trim().toLowerCase() === characterConfirmationName(name).toLowerCase()
	);
}

/** Shared frontend admission for creation, selection and entry controls. Core checks again. */
export function characterManagementPending(
	state: CharacterManagementState,
): boolean {
	return (
		state.kind === "creating" ||
		state.kind === "deleting" ||
		state.kind === "restoring" ||
		state.kind === "uncertain"
	);
}
