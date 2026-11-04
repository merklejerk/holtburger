import { describe, expect, it } from "vitest";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
} from "../../lib/assets/landblock-source-batch";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
import {
	DynamicOnlyLandblockSource,
	WithoutAuthoredDynamicsLandblockSource,
} from "./dynamic-only-landblock-source";

describe("DynamicOnlyLandblockSource", () => {
	it("strips outdoor static residents while retaining promoted dynamics", async () => {
		const landblockId = "0xda56ffff" as LandblockOwnerId;
		const dynamic = { identity: { kind: "authored", sourceId: "butterfly" } };
		const batch = {
			landblockId,
			records: new Map([
				[
					LandblockLayerKind.Generated,
					{
						dynamicSources: [dynamic],
						kind: LandblockLayerKind.Generated,
						landblockId,
						staticResidents: [{ identity: { sourceId: "foliage" } }],
					},
				],
			]),
		} as unknown as LandblockSourceBatch;
		const source: LandblockSourceBatchSource = {
			loadLandblockSourceBatch: async () => batch,
		};

		const isolated = await new DynamicOnlyLandblockSource(
			source,
		).loadLandblockSourceBatch(
			landblockId,
			new Set([LandblockLayerKind.Generated]),
		);

		expect(isolated.records.get(LandblockLayerKind.Generated)).toMatchObject({
			dynamicSources: [dynamic],
			staticResidents: [],
		});
	});

	it("removes promoted dynamics while retaining outdoor static residents", async () => {
		const landblockId = "0xda56ffff" as LandblockOwnerId;
		const staticResident = { identity: { sourceId: "foliage" } };
		const batch = {
			landblockId,
			records: new Map([
				[
					LandblockLayerKind.Generated,
					{
						dynamicSources: [{ identity: { sourceId: "butterfly" } }],
						kind: LandblockLayerKind.Generated,
						landblockId,
						staticResidents: [staticResident],
					},
				],
			]),
		} as unknown as LandblockSourceBatch;
		const source: LandblockSourceBatchSource = {
			loadLandblockSourceBatch: async () => batch,
		};

		const isolated = await new WithoutAuthoredDynamicsLandblockSource(
			source,
		).loadLandblockSourceBatch(
			landblockId,
			new Set([LandblockLayerKind.Generated]),
		);

		expect(isolated.records.get(LandblockLayerKind.Generated)).toMatchObject({
			dynamicSources: [],
			staticResidents: [staticResident],
		});
	});
});
