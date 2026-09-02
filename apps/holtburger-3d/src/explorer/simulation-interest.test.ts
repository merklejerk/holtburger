import { describe, expect, it, vi } from "vitest";
import {
	computeEffectiveSimulationInterest,
	computeSimulationInterest,
	SimulationInterestController,
	type SimulationInterestReceipt,
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

describe("computeEffectiveSimulationInterest", () => {
	it("converges at a four-owner corner without growing beyond radius three", () => {
		let owners: readonly string[] = [];
		for (const anchor of [
			"0xda55ffff",
			"0xdb55ffff",
			"0xdb56ffff",
			"0xda56ffff",
		]) {
			owners = computeEffectiveSimulationInterest(anchor, owners);
		}

		expect(owners).toHaveLength(36);
		expect(owners).toContain("0xd853ffff");
		expect(owners).toContain("0xdc58ffff");
	});

	it("evicts prior owners after sustained travel crosses the exit radius", () => {
		let owners: readonly string[] = [];
		for (const anchor of [
			"0xda55ffff",
			"0xdb55ffff",
			"0xdc55ffff",
			"0xdd55ffff",
		]) {
			owners = computeEffectiveSimulationInterest(anchor, owners);
		}

		expect(owners).toHaveLength(30);
		expect(owners).not.toContain("0xd855ffff");
	});
});

describe("SimulationInterestController", () => {
	it("does not replace simulation interest when only render residency radii change", async () => {
		const replace = vi.fn(async (request: SimulationInterestRequest) => ({
			committed: true,
			revision: request.revision,
			unavailableLandblockIds: [],
		}));
		const controller = new SimulationInterestController({ replace });

		const first = controller.replace("0xda55ffff");
		// Render residency radii are deliberately not an input. Re-requesting the same anchor is a no-op.
		const afterResidencyChange = controller.replace("0xda55ffff");

		expect(afterResidencyChange).toBe(first);
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

		await controller.replace("0xda55ffff");
		await controller.replace("0xdb55ffff");

		expect(requests.map(({ revision }) => revision)).toEqual([1, 2]);
		expect(requests[1]!.landblockIds).toContain("0xdb55ffff");
	});

	it("exposes revision currentness for a mutation handoff", async () => {
		const transport: SimulationInterestTransport = {
			async replace(request) {
				return {
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				};
			},
		};
		const controller = new SimulationInterestController(transport);

		const first = await controller.replace("0xda55ffff");
		expect(controller.isCurrent("0xda55ffff", first.revision)).toBe(true);
		const secondPromise = controller.replace("0xdb55ffff");
		expect(controller.isCurrent("0xda55ffff", first.revision)).toBe(false);
		const second = await secondPromise;
		expect(controller.isCurrent("0xdb55ffff", second.revision)).toBe(true);
	});

	it("does not let a delayed older publication become current again", async () => {
		let releaseFirst:
			((receipt: SimulationInterestReceipt) => void) | undefined;
		const firstPublication = new Promise<SimulationInterestReceipt>(
			(resolve) => {
				releaseFirst = resolve;
			},
		);
		const transport: SimulationInterestTransport = {
			replace(request) {
				if (request.revision === 1) return firstPublication;
				return Promise.resolve({
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				});
			},
		};
		const controller = new SimulationInterestController(transport);

		const first = controller.replace("0xda55ffff");
		const second = controller.replace("0xdb55ffff");
		const secondReceipt = await second;

		expect(controller.isCurrent("0xda55ffff", 1)).toBe(false);
		expect(controller.isCurrent("0xdb55ffff", secondReceipt.revision)).toBe(
			true,
		);
		releaseFirst?.({
			committed: true,
			revision: 1,
			unavailableLandblockIds: [],
		});
		await first;

		expect(controller.isCurrent("0xdb55ffff", secondReceipt.revision)).toBe(
			true,
		);
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

		await expect(controller.replace("0xda55ffff")).rejects.toThrow(
			"host unavailable",
		);
		await controller.replace("0xda55ffff");

		expect(replace).toHaveBeenCalledTimes(2);
	});

	it("coalesces a settled corner follow once its effective owner set converges", async () => {
		const requests: SimulationInterestRequest[] = [];
		const controller = new SimulationInterestController({
			async replace(request) {
				requests.push(request);
				return {
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				};
			},
		});
		const corners = [
			"0xda55ffff",
			"0xdb55ffff",
			"0xdb56ffff",
			"0xda56ffff",
		] as const;
		for (const anchor of [...corners, ...corners])
			await controller.follow(anchor);
		const convergedRequestCount = requests.length;
		const receipt = await controller.follow("0xda55ffff");

		expect(requests).toHaveLength(convergedRequestCount);
		expect(controller.isCurrent("0xda55ffff", receipt.revision)).toBe(true);
	});

	it("ensures a current follow anchor without collapsing its retained owner set", async () => {
		const requests: SimulationInterestRequest[] = [];
		const controller = new SimulationInterestController({
			async replace(request) {
				requests.push(request);
				return {
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				};
			},
		});

		await controller.follow("0xda55ffff");
		const followed = await controller.follow("0xdb55ffff");
		expect(requests.at(-1)?.landblockIds).toHaveLength(30);
		const ensured = await controller.ensure("0xdb55ffff");

		expect(ensured).toBe(followed);
		expect(requests).toHaveLength(2);
	});
});
