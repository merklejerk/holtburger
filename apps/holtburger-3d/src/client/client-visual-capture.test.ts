import { describe, expect, it, vi } from "vitest";
import { persistPlayerVisualCapture } from "./client-visual-capture";
import { playerVisualCaptureSchema } from "./client-object-preview-contract";
import fixture from "./fixtures/object-preview-wire.json";

describe("cold gameplay capture forwarding", () => {
	it("stages immediately and keeps character identities separate across retirement and rejected writes", async () => {
		const stage = vi
			.fn()
			.mockRejectedValueOnce(new Error("cache closing"))
			.mockResolvedValue(undefined);
		const report = vi.fn();
		const transport = { stage, read: vi.fn(), listenFailures: vi.fn() };
		const first = playerVisualCaptureSchema.parse({
			guid: 1,
			source: fixture.equipped.outcome.source,
		});
		const second = { ...first, guid: 2 };
		persistPlayerVisualCapture(
			{ type: "player-visual-capture", capture: first },
			transport,
			report,
		);
		expect(stage).toHaveBeenCalledExactlyOnceWith(first);
		persistPlayerVisualCapture(
			{ type: "player-visual-capture", capture: null },
			transport,
			report,
		);
		persistPlayerVisualCapture(
			{ type: "player-visual-capture", capture: second },
			transport,
			report,
		);
		persistPlayerVisualCapture({ type: "entities" }, transport, report);
		expect(stage.mock.calls).toEqual([[first], [second]]);
		await Promise.resolve();
		expect(report).toHaveBeenCalledExactlyOnceWith(
			"Character appearance could not be saved: cache closing",
		);
	});
});
