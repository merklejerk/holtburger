import { describe, expect, it, vi } from "vitest";

import { acknowledgeProbeWorldReveal } from "./live-client-probe-lifecycle.mjs";

describe("live client probe world reveal", () => {
	it("adapts portal space into the desktop host's explicit reveal command", async () => {
		const invoke = vi.fn().mockResolvedValue(undefined);

		await expect(
			acknowledgeProbeWorldReveal(
				{ invoke },
				{ kind: "portal-space", worldGeneration: 7, cause: "initial-entry" },
			),
		).resolves.toBe(7);
		expect(invoke).toHaveBeenCalledExactlyOnceWith(
			"acknowledge_client_world_reveal",
			{ worldGeneration: 7 },
		);
	});

	it.each([
		undefined,
		{ kind: "in-world" },
		{ kind: "portal-space", worldGeneration: -1 },
		{ kind: "portal-space", worldGeneration: 1.5 },
	])(
		"rejects a lifecycle that cannot name one reveal generation",
		async (lifecycle) => {
			const invoke = vi.fn();

			await expect(
				acknowledgeProbeWorldReveal({ invoke }, lifecycle),
			).rejects.toThrow("invalid portal-space lifecycle");
			expect(invoke).not.toHaveBeenCalled();
		},
	);
});
