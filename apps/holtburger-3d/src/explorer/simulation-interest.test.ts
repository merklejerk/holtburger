import { describe, expect, it, vi } from "vitest";
import {
	computeSimulationInterest,
	SimulationInterestController,
	type SimulationInterestRequest,
	type SimulationInterestTransport,
} from "./simulation-interest";

describe("computeSimulationInterest", () => {
	it("projects the fixed radius-two owner square independently from render layers", () => {
		const owners = computeSimulationInterest("0xda55ffff");

		expect(owners).toHaveLength(25);
		expect(owners[0]).toBe("0xd853ffff");
		expect(owners.at(-1)).toBe("0xdc57ffff");
		expect(owners).toContain("0xda55ffff");
	});

	it("clips the owner square at the outdoor world boundary", () => {
		expect(computeSimulationInterest("0x0000ffff")).toEqual([
			"0x0000ffff",
			"0x0100ffff",
			"0x0200ffff",
			"0x0001ffff",
			"0x0101ffff",
			"0x0201ffff",
			"0x0002ffff",
			"0x0102ffff",
			"0x0202ffff",
		]);
	});
});

describe("SimulationInterestController", () => {
	it("does not replace simulation interest when only render LoD changes", async () => {
		const replace = vi.fn(async (request: SimulationInterestRequest) => ({
			committed: true,
			revision: request.revision,
			unavailableLandblockIds: [],
		}));
		const controller = new SimulationInterestController({ replace });

		const first = controller.request("0xda55ffff");
		// Render LoD is deliberately not an input. Re-requesting the same anchor is a no-op.
		const afterRenderLodChange = controller.request("0xda55ffff");

		expect(afterRenderLodChange).toBe(first);
		await first;
		expect(replace).toHaveBeenCalledOnce();
	});

	it("revisions complete replacements when the application anchor changes", async () => {
		const requests: SimulationInterestRequest[] = [];
		const transport: SimulationInterestTransport = {
			async replace(request) {
				requests.push(request);
				return {
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				};
			},
		};
		const controller = new SimulationInterestController(transport);

		await controller.request("0xda55ffff");
		await controller.request("0xdb55ffff");

		expect(requests.map(({ revision }) => revision)).toEqual([1, 2]);
		expect(requests[1]!.landblockIds).toContain("0xdb55ffff");
	});

	it("permits retrying a current anchor after transport failure", async () => {
		const replace = vi
			.fn<SimulationInterestTransport["replace"]>()
			.mockRejectedValueOnce(new Error("host unavailable"))
			.mockImplementation(async (request) => ({
				committed: true,
				revision: request.revision,
				unavailableLandblockIds: [],
			}));
		const controller = new SimulationInterestController({ replace });

		await expect(controller.request("0xda55ffff")).rejects.toThrow(
			"host unavailable",
		);
		await controller.request("0xda55ffff");

		expect(replace).toHaveBeenCalledTimes(2);
	});
});
