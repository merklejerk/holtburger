import { describe, expect, it, vi } from "vitest";
import { clientNativePerformance } from "./native-performance";
import type { HostTransport } from "../lib/host/host-transport";

const response = {
	generation: 7,
	recording: true,
	elapsedMs: 12,
	pendingScopes: 0,
	authority: [
		{
			scope: "physics_tick",
			sampleCount: 2,
			meanMs: 3,
		},
	],
	forwarding: { sampleCount: 2, meanMs: 1 },
};
function build(payload: unknown) {
	const transport: HostTransport = {
		invoke: vi.fn(async () => payload),
		listen: async () => () => {},
	};
	return { source: clientNativePerformance(transport), transport };
}

describe("client native profiling boundary", () => {
	it("validates and preserves independent native elapsed observations", async () => {
		const { source, transport } = build(response);
		expect(await source.control("start", response.generation)).toEqual(
			response,
		);
		expect(transport.invoke).toHaveBeenCalledWith("client_performance", {
			request: { action: "start", generation: response.generation },
		});
	});
	it("rejects stale capture responses and mismatched control acknowledgments", async () => {
		await expect(
			build(response).source.control("snapshot", response.generation + 1),
		).rejects.toThrow("different capture");
		await expect(
			build(response).source.control("stop", response.generation),
		).rejects.toThrow("did not stop");
		await expect(
			build({ ...response, recording: false }).source.control(
				"start",
				response.generation,
			),
		).rejects.toThrow("did not start");
	});
});
