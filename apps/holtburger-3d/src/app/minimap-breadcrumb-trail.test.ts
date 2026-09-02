import { describe, expect, it } from "vitest";

import type { EnvCellId, LandblockOwnerId } from "../lib/game/game-types";
import type { MinimapSubject } from "./minimap-frame";
import {
	EMPTY_MINIMAP_BREADCRUMB_TRAIL,
	observeMinimapBreadcrumbTrail,
	type MinimapBreadcrumbHistory,
	type MinimapBreadcrumbTrail,
} from "./minimap-breadcrumb-trail";
import {
	MINIMAP_BREADCRUMB_POLICY,
	type MinimapBreadcrumbPolicy,
} from "./minimap-tuning";

describe("minimap breadcrumb trail", () => {
	it("starts once for a controlled entity and reuses state for an unchanged pose", () => {
		const initial = observe(controlled({ worldX: 10, worldY: 20, worldZ: 30 }));

		expect(initial).toEqual({
			kind: "tracking",
			lastObserved: { worldX: 10, worldY: 20, worldZ: 30 },
			samples: [{ worldX: 10, worldY: 20, worldZ: 30 }],
			subjectGuid: 1,
		});
		expect(
			observeMinimapBreadcrumbTrail(
				initial,
				controlled({ worldX: 10, worldY: 20, worldZ: 30 }),
				MINIMAP_BREADCRUMB_POLICY,
			),
		).toBe(initial);
	});

	it("uses last observation for discontinuities and last sample for spacing", () => {
		const policy: MinimapBreadcrumbPolicy = {
			...MINIMAP_BREADCRUMB_POLICY,
			maximumContinuousStepMeters: 5,
			spacingMeters: { indoor: 8, outdoor: 8 },
		};
		const initial = observe(controlled({ worldX: 0 }), policy);
		const belowSpacing = observe(controlled({ worldX: 4 }), policy, initial);
		const recorded = observe(controlled({ worldX: 8 }), policy, belowSpacing);

		expect(belowSpacing).toMatchObject({
			lastObserved: { worldX: 4 },
			samples: [{ worldX: 0 }],
		});
		expect(recorded).toMatchObject({
			lastObserved: { worldX: 8 },
			samples: [{ worldX: 8 }, { worldX: 0 }],
		});
	});

	it("samples dungeons more densely than outdoor travel", () => {
		const indoorSpacing = MINIMAP_BREADCRUMB_POLICY.spacingMeters.indoor;
		const outdoorSpacing = MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor;
		const indoorInitial = observe(controlled({ indoor: true, worldX: 0 }));
		const outdoorInitial = observe(controlled({ worldX: 0 }));

		const indoor = observe(
			controlled({ indoor: true, worldX: indoorSpacing }),
			MINIMAP_BREADCRUMB_POLICY,
			indoorInitial,
		);
		const outdoor = observe(
			controlled({ worldX: indoorSpacing }),
			MINIMAP_BREADCRUMB_POLICY,
			outdoorInitial,
		);

		expect(trackingSamples(indoor)).toHaveLength(2);
		expect(trackingSamples(outdoor)).toHaveLength(1);
		expect(indoorSpacing).toBeLessThan(outdoorSpacing);
	});

	it("refreshes revisited space without consuming another history slot", () => {
		const policy = { ...policyWithSpacing(4), maximumSamples: 4 };
		const initial = observe(controlled({ worldX: 0 }), policy);
		const outbound = observePath([4, 8, 12], policy, initial);
		const revisited = observe(controlled({ worldX: 4 }), policy, outbound);

		expect(trackingSamples(revisited).map((sample) => sample.worldX)).toEqual([
			4, 12, 8, 0,
		]);
	});

	it("compacts every covered sample when revisiting between them", () => {
		const policy = policyWithSpacing(5);
		const initial = observe(controlled({ worldX: 0 }), policy);
		const outbound = observePath([6, 12], policy, initial);
		const revisited = observe(controlled({ worldX: 3 }), policy, outbound);

		expect(trackingSamples(revisited).map((sample) => sample.worldX)).toEqual([
			3, 12,
		]);
	});

	it("bounds repeated combat laps by occupied space rather than distance travelled", () => {
		const policy = { ...policyWithSpacing(4), maximumSamples: 8 };
		const lap = [
			{ worldX: 4, worldZ: 0 },
			{ worldX: 4, worldZ: 4 },
			{ worldX: 0, worldZ: 4 },
			{ worldX: 0, worldZ: 0 },
		] as const;
		let trail = observe(controlled({ worldX: 0 }), policy);
		for (let lapIndex = 0; lapIndex < 20; lapIndex += 1) {
			for (const point of lap) {
				trail = observe(controlled(point), policy, trail);
			}
		}

		expect(trackingSamples(trail)).toHaveLength(lap.length);
	});

	it("keeps horizontally overlapping samples on vertically separated floors", () => {
		const policy = policyWithSpacing(4);
		const initial = observe(controlled({ worldX: 0, worldY: 0 }), policy);
		const acrossRoom = observe(
			controlled({ worldX: 8, worldY: 0 }),
			policy,
			initial,
		);
		const upstairs = observe(
			controlled({ worldX: 0, worldY: 6 }),
			policy,
			acrossRoom,
		);

		expect(trackingSamples(upstairs)).toEqual([
			{ worldX: 0, worldY: 6, worldZ: 0 },
			{ worldX: 8, worldY: 0, worldZ: 0 },
			{ worldX: 0, worldY: 0, worldZ: 0 },
		]);
	});

	it("retains only the newest configured samples", () => {
		const spacing = MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor;
		let trail = observe(controlled({ worldX: 0 }));
		for (
			let index = 1;
			index <= MINIMAP_BREADCRUMB_POLICY.maximumSamples;
			index += 1
		) {
			trail = observe(
				controlled({ worldX: index * spacing }),
				MINIMAP_BREADCRUMB_POLICY,
				trail,
			);
		}

		const samples = trackingSamples(trail);
		expect(samples).toHaveLength(MINIMAP_BREADCRUMB_POLICY.maximumSamples);
		expect(samples[0].worldX).toBe(
			MINIMAP_BREADCRUMB_POLICY.maximumSamples * spacing,
		);
		expect(samples[samples.length - 1].worldX).toBe(spacing);
	});

	it("starts fresh after a discontinuous 3D observation", () => {
		const initial = observe(controlled({ worldX: 0, worldY: 0 }));
		const moved = observe(
			controlled({ worldX: MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor }),
			MINIMAP_BREADCRUMB_POLICY,
			initial,
		);
		const afterJump = observe(
			controlled({
				worldX: MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor,
				worldY: MINIMAP_BREADCRUMB_POLICY.maximumContinuousStepMeters + 1,
			}),
			MINIMAP_BREADCRUMB_POLICY,
			moved,
		);

		expect(afterJump).toMatchObject({
			kind: "tracking",
			samples: [
				{
					worldX: MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor,
					worldY: MINIMAP_BREADCRUMB_POLICY.maximumContinuousStepMeters + 1,
				},
			],
		});
	});

	it("preserves continuous history across an indoor/outdoor doorway", () => {
		const initial = observe(controlled({ indoor: true, worldX: 0 }));
		const outside = observe(
			controlled({ worldX: MINIMAP_BREADCRUMB_POLICY.spacingMeters.outdoor }),
			MINIMAP_BREADCRUMB_POLICY,
			initial,
		);

		expect(trackingSamples(outside)).toHaveLength(2);
	});

	it("clears without a controlled entity and starts fresh for a new identity", () => {
		const first = observe(controlled({ worldX: 0 }));
		const second = observe(
			controlled({ guid: 2, worldX: 10 }),
			MINIMAP_BREADCRUMB_POLICY,
			first,
		);

		expect(second).toMatchObject({
			kind: "tracking",
			samples: [{ worldX: 10 }],
			subjectGuid: 2,
		});
		expect(
			observeMinimapBreadcrumbTrail(
				second,
				freeCamera(),
				MINIMAP_BREADCRUMB_POLICY,
			),
		).toBe(EMPTY_MINIMAP_BREADCRUMB_TRAIL);
		expect(
			observeMinimapBreadcrumbTrail(second, null, MINIMAP_BREADCRUMB_POLICY),
		).toBe(EMPTY_MINIMAP_BREADCRUMB_TRAIL);
	});
});

function observe(
	subject: MinimapSubject,
	policy: MinimapBreadcrumbPolicy = MINIMAP_BREADCRUMB_POLICY,
	trail: MinimapBreadcrumbTrail = EMPTY_MINIMAP_BREADCRUMB_TRAIL,
): MinimapBreadcrumbTrail {
	return observeMinimapBreadcrumbTrail(trail, subject, policy);
}

function observePath(
	worldXs: readonly number[],
	policy: MinimapBreadcrumbPolicy,
	initial: MinimapBreadcrumbTrail,
): MinimapBreadcrumbTrail {
	return worldXs.reduce(
		(trail, worldX) => observe(controlled({ worldX }), policy, trail),
		initial,
	);
}

function policyWithSpacing(spacing: number): MinimapBreadcrumbPolicy {
	return {
		...MINIMAP_BREADCRUMB_POLICY,
		spacingMeters: { indoor: spacing, outdoor: spacing },
	};
}

function trackingSamples(
	trail: MinimapBreadcrumbTrail,
): MinimapBreadcrumbHistory {
	if (trail.kind !== "tracking") {
		throw new Error("Expected a tracking breadcrumb trail.");
	}
	return trail.samples;
}

function controlled({
	guid = 1,
	indoor = false,
	worldX,
	worldY = 0,
	worldZ = 0,
}: {
	readonly guid?: number;
	readonly indoor?: boolean;
	readonly worldX: number;
	readonly worldY?: number;
	readonly worldZ?: number;
}): MinimapSubject {
	return {
		anchor: {
			headingRadians: 0,
			residency: {
				envCellId: indoor ? ("0x01020100" as EnvCellId) : null,
				landblockId: "0x0102ffff" as LandblockOwnerId,
			},
			worldX,
			worldY,
			worldZ,
		},
		guid,
		kind: "controlled-entity",
	};
}

function freeCamera(): MinimapSubject {
	return {
		anchor: {
			headingRadians: 0,
			residency: null,
			worldX: 0,
			worldY: 0,
			worldZ: 0,
		},
		kind: "free-camera",
	};
}
