import { describe, expect, it } from "vitest";
import type { EnvCellId, LandblockOwnerId } from "../game-types";
import { Mat4 } from "../math/types";
import type {
	ResolvedBuildingLayerSource,
	ResolvedObjectResident,
	ResolvedPortalCrossing,
} from "../resolution/landblock-layer";
import type { ResolvedMapSurface } from "../resolution/presentation";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ScenePlacement } from "../scene";
import {
	type MapInteriorInstallation,
	MapGeometryStore,
} from "./map-geometry-store";

const LANDBLOCK = "0xda55ffff" as LandblockOwnerId;
const OTHER_LANDBLOCK = "0xda56ffff" as LandblockOwnerId;
const BUILDING = "gfx-obj/01000801";

function placement(): ScenePlacement {
	return {
		landblockId: LANDBLOCK,
		envCellId: null,
		localTransform: Mat4.identity(),
	} as ScenePlacement;
}

function surface(triangles = 1): ResolvedMapSurface {
	return {
		positions: new Float32Array(triangles * 9),
		indices: new Uint32Array(triangles * 3),
	};
}

function buildings(
	mapBlockers: ReadonlyMap<string, ResolvedMapSurface>,
	sourceAssetId: string = BUILDING,
): ResolvedBuildingLayerSource {
	const resident = {
		placement: placement(),
		presentation: { sourceAssetId },
	} as unknown as ResolvedObjectResident;
	return {
		kind: LandblockLayerKind.Buildings,
		landblockId: LANDBLOCK,
		staticResidents: [resident],
		dynamicSources: [],
		mapBlockers,
	};
}

function interior(
	shells: MapInteriorInstallation["shells"],
	crossings: readonly ResolvedPortalCrossing[] = [],
): MapInteriorInstallation {
	return { apertures: [], crossings, landblockId: LANDBLOCK, shells };
}

describe("MapGeometryStore", () => {
	it("pairs each building resident with its source silhouette", () => {
		const store = new MapGeometryStore();
		store.installBuildings(buildings(new Map([[BUILDING, surface(2)]])));

		const entries = [...store.listBlockers()];
		expect(entries).toHaveLength(1);
		expect(entries[0]?.[0]).toBe(LANDBLOCK);
		expect(entries[0]?.[1]).toHaveLength(1);
		expect(entries[0]?.[1][0]?.surface.indices).toHaveLength(6);
	});

	it("rejects a layer missing a resident's derived blocker", () => {
		const store = new MapGeometryStore();
		expect(() => store.installBuildings(buildings(new Map()))).toThrow(
			"missing source",
		);
	});

	it("skips a resident whose source silhouette is empty", () => {
		const store = new MapGeometryStore();
		store.installBuildings(buildings(new Map([[BUILDING, surface(0)]])));

		expect([...store.listBlockers()]).toHaveLength(0);
		expect(store.revision).toBe(0);
	});

	it("replaces prior blockers when a republished layer derives none", () => {
		const store = new MapGeometryStore();
		store.installBuildings(buildings(new Map([[BUILDING, surface()]])));
		const installed = store.revision;

		store.installBuildings(buildings(new Map([[BUILDING, surface(0)]])));

		expect([...store.listBlockers()]).toHaveLength(0);
		expect(store.revision).toBeGreaterThan(installed);
	});

	it("keeps portal adjacency even where a cell contributes no floor", () => {
		const store = new MapGeometryStore();
		const crossings = [
			{
				id: "portal-crossing:x",
				spatialRelationship: { kind: "indoor-depth-continuous" },
			},
		] as unknown as readonly [ResolvedPortalCrossing];
		store.installInterior(
			interior(
				[
					{
						envCellId: 0x100 as unknown as EnvCellId,
						placement: placement(),
						mapFloor: surface(0),
					},
					{
						envCellId: 0x101 as unknown as EnvCellId,
						placement: placement(),
						mapFloor: surface(3),
					},
				],
				crossings,
			),
		);

		const resident = store.interiorFor(LANDBLOCK);
		expect(resident?.floors).toHaveLength(1);
		expect(resident?.floors[0]?.envCellId).toBe(0x101);
		expect(resident?.crossings).toHaveLength(1);
	});

	it("releases only the evicted layer and reports a new revision", () => {
		const store = new MapGeometryStore();
		store.installBuildings(buildings(new Map([[BUILDING, surface()]])));
		store.installInterior(
			interior([
				{
					envCellId: 0x100 as unknown as EnvCellId,
					placement: placement(),
					mapFloor: surface(),
				},
			]),
		);
		const installed = store.revision;

		store.evictInterior(LANDBLOCK);

		expect(store.interiorFor(LANDBLOCK)).toBeNull();
		expect([...store.listBlockers()]).toHaveLength(1);
		expect(store.revision).toBeGreaterThan(installed);

		const beforeMiss = store.revision;
		store.evictInterior(OTHER_LANDBLOCK);
		expect(store.revision).toBe(beforeMiss);
	});
});
