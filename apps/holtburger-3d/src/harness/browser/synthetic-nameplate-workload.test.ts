import { describe, expect, it, vi } from "vitest";

import type { SetupVisualSource } from "../../lib/assets/setup-visual-source";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import {
	createSyntheticNameplateWorkload,
	SYNTHETIC_NAMEPLATE_SETUP_DID,
	SyntheticNameplateSetupVisualSource,
} from "./synthetic-nameplate-workload";

const LANDBLOCK = "0xda55ffff" as LandblockOwnerId;
const OWNER_X = 0xda * 192;
const OWNER_Z = -0x55 * 192;
const CAMERA = [OWNER_X + 96, 40, OWNER_Z - 96] as const;

describe("synthetic nameplate workload", () => {
	it("builds one shared-value population and one unique-value population", () => {
		const repeated = createSyntheticNameplateWorkload(
			"repeated-100",
			LANDBLOCK,
			CAMERA,
			null,
		);
		const unique = createSyntheticNameplateWorkload(
			"unique-100",
			LANDBLOCK,
			CAMERA,
			null,
		);

		expect(repeated).toHaveLength(100);
		expect(
			new Set(repeated.map(({ display }) => JSON.stringify(display))).size,
		).toBe(1);
		expect(
			new Set(unique.map(({ display }) => JSON.stringify(display))).size,
		).toBe(100);
		expect(
			unique.every(({ presentation }) => presentation.entityClass === "mob"),
		).toBe(true);
	});

	it("builds 500 ordered candidates at deterministic increasing row distances", () => {
		const entities = createSyntheticNameplateWorkload(
			"ordered-500",
			LANDBLOCK,
			CAMERA,
			null,
		);

		expect(entities).toHaveLength(500);
		expect(entities[0]?.placement).toMatchObject({
			kind: "world",
			pose: { coords: { y: 120 } },
		});
		expect(entities[20]?.placement).toMatchObject({
			kind: "world",
			pose: { coords: { y: 121.75 } },
		});
	});

	it("uses the camera EnvCell as the exact indoor membership", () => {
		const [entity] = createSyntheticNameplateWorkload(
			"repeated-100",
			LANDBLOCK,
			CAMERA,
			"0xda550123",
		);

		expect(entity?.placement).toMatchObject({
			kind: "world",
			pose: { landblockId: 0xda55_0123 },
			spatialMembership: {
				reachedEnvCellIds: [0xda55_0123],
				reachesOutdoors: false,
			},
		});
	});

	it("adds a disabled-category opaque wall without changing the target plate value", () => {
		const open = createSyntheticNameplateWorkload(
			"occlusion-open",
			LANDBLOCK,
			CAMERA,
			null,
		);
		const covered = createSyntheticNameplateWorkload(
			"occlusion-wall",
			LANDBLOCK,
			CAMERA,
			null,
		);

		expect(open).toHaveLength(1);
		expect(covered).toHaveLength(2);
		expect(covered[0]?.display).toEqual(open[0]?.display);
		expect(covered[1]?.presentation).toMatchObject({
			entityClass: "other",
			content: { setupDid: 0x0200_fffd },
		});
	});

	it("serves only the fixture setup and delegates every production request", async () => {
		const load = vi.fn(async () => {
			throw new Error("delegated");
		});
		const source = new SyntheticNameplateSetupVisualSource({
			load,
		} as SetupVisualSource);
		const appearance = {
			paletteDid: null,
			partChanges: [],
			subPalettes: [],
			textureChanges: [],
		};

		const visual = await source.load(SYNTHETIC_NAMEPLATE_SETUP_DID, appearance);
		expect(visual.setupId).toBe("0x0200fffe");
		expect(load).not.toHaveBeenCalled();
		await expect(source.load(0x0200_0001, appearance)).rejects.toThrow(
			"delegated",
		);
		expect(load).toHaveBeenCalledOnce();
	});
});
