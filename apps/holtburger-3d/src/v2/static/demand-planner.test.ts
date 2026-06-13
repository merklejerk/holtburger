import { describe, expect, it } from "vitest";
import { normalizeOutdoorLandblockId } from "../../lib/landblocks";
import {
	normalizeOutdoorLodRadii,
	planScheduledStaticWork,
} from "./demand-planner";
import type { StaticDemand } from "./contracts";

describe("V2 static demand planner", () => {
	it("clamps outdoor domain radii before producing scheduled work", () => {
		const focusLandblockId = 0xda55ffff;
		const work = planScheduledStaticWork(
			createOutdoorDemand(focusLandblockId, {
				buildings: 9,
				detail: 1,
				envCells: 0,
				terrain: 1,
			}),
			7,
		);

		const terrainWork = work.filter(
			(item) => item.job.domain === "outdoor-terrain",
		);
		const buildingWork = work.filter(
			(item) => item.job.domain === "outdoor-buildings",
		);

		expect(terrainWork).toHaveLength(5);
		expect(buildingWork).toHaveLength(5);
		expect(work.every((item) => item.revision === 7)).toBe(true);
		expect(work.every((item) => item.job.scope.kind === "landblock")).toBe(
			true,
		);
		expect(work[0]).toMatchObject({
			job: {
				domain: "outdoor-terrain",
				scope: {
					kind: "landblock",
					landblockId: normalizeOutdoorLandblockId(focusLandblockId),
				},
			},
			priority: 0,
		});
	});

	it("does not put lifecycle policy, interest radii, or camera state on resolver jobs", () => {
		const [work] = planScheduledStaticWork(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			}),
			3,
		);

		expect(work?.job).toEqual({
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		});
		expect(JSON.stringify(work?.job)).not.toContain("revision");
		expect(JSON.stringify(work?.job)).not.toContain("priority");
		expect(JSON.stringify(work?.job)).not.toContain("policy");
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

	it("plans outdoor env-cell demand from env-cell coverage radius", () => {
		const work = planScheduledStaticWork(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: 1,
				terrain: 1,
			}),
			4,
		);

		const envCellWork = work.filter(
			(item) => item.job.domain === "landblock-env-cells",
		);

		expect(envCellWork).toHaveLength(5);
		expect(envCellWork[0]).toMatchObject({
			job: {
				domain: "landblock-env-cells",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			},
			priority: 5,
			workId: "4:landblock:da55ffff:landblock-env-cells",
		});
	});

	it("plans dungeon/interior demand as one landblock-owned env-cell resolver job", () => {
		const work = planScheduledStaticWork(
			{
				location: {
					envCellId: 0xda550123,
					kind: "interior-cell",
					landblockId: 0xda550123,
				},
				lod: {
					buildings: -1,
					detail: -1,
					envCells: -1,
					terrain: -1,
				},
			},
			12,
		);

		expect(work).toEqual([
			{
				job: {
					domain: "landblock-env-cells",
					scope: {
						kind: "landblock",
						landblockId: 0xda55ffff,
					},
				},
				priority: 5,
				revision: 12,
				workId: "12:landblock:da55ffff:landblock-env-cells",
			},
		]);
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
	};
}
