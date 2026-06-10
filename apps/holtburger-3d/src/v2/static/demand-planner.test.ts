import { describe, expect, it } from "vitest";
import { normalizeOutdoorLandblockId } from "../../lib/landblocks";
import { normalizeOutdoorLodRadii, planStaticWorkRequests } from "./demand-planner";
import type { StaticDemand } from "./contracts";

describe("V2 static demand planner", () => {
	it("clamps outdoor domain radii before producing concrete work requests", () => {
		const focusLandblockId = 0xda55ffff;
		const requests = planStaticWorkRequests(
			createOutdoorDemand(focusLandblockId, {
				buildings: 9,
				detail: 1,
				envCells: 0,
				terrain: 1,
			}),
			7,
		);

		const terrainRequests = requests.filter(
			(request) => request.domain === "terrain",
		);
		const buildingRequests = requests.filter(
			(request) => request.domain === "buildings",
		);

		expect(terrainRequests).toHaveLength(9);
		expect(buildingRequests).toHaveLength(9);
		expect(requests.every((request) => request.revision === 7)).toBe(true);
		expect(
			requests.every((request) => request.scope.kind === "landblock"),
		).toBe(true);
		expect(requests[0]).toMatchObject({
			domain: "terrain",
			priority: 0,
			scope: {
				kind: "landblock",
				landblockId: normalizeOutdoorLandblockId(focusLandblockId),
			},
		});
	});

	it("does not put interest radii or camera state on worker requests", () => {
		const [request] = planStaticWorkRequests(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			}),
			3,
		);

		expect(request).toEqual({
			domain: "terrain",
			policyRevision: 11,
			priority: 0,
			requestId: "3:landblock:da55ffff:terrain",
			revision: 3,
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		});
	});

	it("normalizes domain radii without letting non-terrain domains exceed terrain", () => {
		expect(
			normalizeOutdoorLodRadii({
				buildings: 3.9,
				detail: 2.1,
				envCells: 9,
				terrain: 1.8,
			}),
		).toEqual({
			buildings: 1,
			detail: 1,
			envCells: 1,
			terrain: 1,
		});
	});
});

function createOutdoorDemand(
	landblockId: number,
	lod: StaticDemand["lod"],
): StaticDemand {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId,
		},
		lod,
		policyRevision: 11,
	};
}
