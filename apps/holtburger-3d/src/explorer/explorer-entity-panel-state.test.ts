import { describe, expect, it } from "vitest";

import {
	explorerEntityOperationTargets,
	refreshesExplorerEntityPanel,
} from "./explorer-entity-panel-state";

describe("Explorer entity panel state", () => {
	it("scopes operation feedback to an exact live generation", () => {
		const operation = {
			kind: "despawn",
			target: { guid: 0x70000001, generation: 4 },
		} as const;
		expect(
			explorerEntityOperationTargets(operation, {
				guid: 0x70000001,
				generation: 4,
			}),
		).toBe(true);
		expect(
			explorerEntityOperationTargets(operation, {
				guid: 0x70000001,
				generation: 5,
			}),
		).toBe(false);
		expect(
			explorerEntityOperationTargets(
				{ kind: "spawn" },
				{ guid: 0x70000001, generation: 4 },
			),
		).toBe(false);
	});

	it("keeps integrated host ticks out of panel state while publishing corrections", () => {
		const event = {
			kind: "ticked",
			batch: {
				hostTime: { seconds: 1 },
				durationMs: 1000 / 30,
				advances: [{ kind: "integrated" }],
			},
		} as const;

		expect(refreshesExplorerEntityPanel(event)).toBe(false);
		expect(
			refreshesExplorerEntityPanel({
				...event,
				batch: {
					...event.batch,
					advances: [{ ...event.batch.advances[0], kind: "teleport" }],
				},
			}),
		).toBe(true);
		expect(
			refreshesExplorerEntityPanel({
				kind: "removed",
			}),
		).toBe(true);
	});
});
