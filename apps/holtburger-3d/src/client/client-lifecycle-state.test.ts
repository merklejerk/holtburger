import { describe, expect, it } from "vitest";

import type {
	ClientExitRequested,
	ClientLifecycle,
} from "./client-host-contract";
import {
	clientLifecycleEnablesWorldInput,
	clientLifecycleUsesWorldPresentation,
	initialClientLifecycleUiState,
	reduceClientLifecycleUiState,
} from "./client-lifecycle-state";

const characters = [
	{ guid: 7, name: "Mira", slot: 0, deleteTime: 0 },
	{ guid: 8, name: "Nox", slot: 1, deleteTime: 0 },
];

describe("client lifecycle reducer", () => {
	it("enables input only for the interactive world phase", () => {
		expect(clientLifecycleEnablesWorldInput({ kind: "in-world" })).toBe(true);
		expect(
			clientLifecycleEnablesWorldInput({
				kind: "portal-space",
				worldGeneration: 4,
				cause: "teleport",
			}),
		).toBe(false);
		expect(
			clientLifecycleEnablesWorldInput({
				kind: "entering-world",
				characterGuid: 7,
			}),
		).toBe(false);
	});

	it("retains one presentation installation throughout world entry", () => {
		expect(
			clientLifecycleUsesWorldPresentation({
				kind: "entering-world",
				characterGuid: 7,
			}),
		).toBe(true);
		expect(
			clientLifecycleUsesWorldPresentation({
				kind: "portal-space",
				worldGeneration: 4,
				cause: "initial-entry",
			}),
		).toBe(true);
		expect(clientLifecycleUsesWorldPresentation({ kind: "in-world" })).toBe(
			true,
		);
		expect(clientLifecycleUsesWorldPresentation({ kind: "connecting" })).toBe(
			false,
		);
	});

	it("starts connecting and preserves one selected exact character identity", () => {
		let state = initialClientLifecycleUiState();
		state = reduceClientLifecycleUiState(
			state,
			authority({ kind: "character-selection", characters }),
		);
		state = reduceClientLifecycleUiState(state, { type: "select", guid: 8 });

		expect(state).toEqual({
			kind: "character-selection",
			characters,
			selectedGuid: 8,
		});
		state = reduceClientLifecycleUiState(state, { type: "select", guid: 99 });
		expect(state).toMatchObject({ selectedGuid: 8 });
	});

	it("preserves a valid selection across refreshed character lists and clears stale identity", () => {
		let state = reduceClientLifecycleUiState(
			initialClientLifecycleUiState(),
			authority({ kind: "character-selection", characters }),
		);
		state = reduceClientLifecycleUiState(state, { type: "select", guid: 7 });
		state = reduceClientLifecycleUiState(state, {
			type: "authority",
			lifecycle: { kind: "character-selection", characters: [characters[0]] },
		});
		expect(state).toMatchObject({ selectedGuid: 7 });

		state = reduceClientLifecycleUiState(state, {
			type: "authority",
			lifecycle: { kind: "character-selection", characters: [characters[1]] },
		});
		expect(state).toMatchObject({ selectedGuid: null });
	});

	it("covers connecting, entry, in-world, and disconnect transitions without retry state", () => {
		let state = initialClientLifecycleUiState();
		for (const lifecycle of [
			{ kind: "authenticating" },
			{ kind: "entering-world", characterGuid: 7 },
			{ kind: "in-world" },
		] satisfies ClientLifecycle[]) {
			state = reduceClientLifecycleUiState(state, {
				type: "authority",
				lifecycle,
			});
			expect(state.kind).toBe(lifecycle.kind);
		}

		const exit: ClientExitRequested = {
			cause: "server-disconnect",
			diagnostic: "server closed the session",
		};
		state = reduceClientLifecycleUiState(state, { type: "exit", exit });
		expect(state).toEqual({ kind: "exiting", ...exit });
		state = reduceClientLifecycleUiState(state, {
			type: "authority",
			lifecycle: { kind: "in-world" },
		});
		expect(state.kind).toBe("exiting");
	});
});

function authority(lifecycle: ClientLifecycle): {
	type: "authority";
	lifecycle: ClientLifecycle;
} {
	return { type: "authority", lifecycle };
}
