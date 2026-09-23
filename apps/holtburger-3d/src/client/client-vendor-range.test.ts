import { expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import {
	cellId,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { sampleVendorDistanceMeters } from "./client-vendor-range";

function placed(
	guid: number,
	landblockId: number,
	x: number,
): Pick<DynamicEntityView, "identity" | "placement"> {
	return {
		identity: { guid, wcid: guid },
		placement: {
			kind: "world",
			pose: {
				landblockId: cellId(landblockId),
				coords: { x, y: 0, z: 0 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			spatialMembership: { reachesOutdoors: true, reachedEnvCellIds: [] },
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
	};
}

it("measures vendor reach across adjacent landblock frames", () => {
	const entities = new ClientEntityMirror();
	entities.commit(
		entities.prepareSnapshot(
			{
				projectileSupply: { kind: "not-applicable" },
				worldContainer: { kind: "closed" },
				entities: [entityFacts(1), entityFacts(2)],
			},
			1,
		),
	);
	const player = placed(1, 0x0101_0100, OUTDOOR_LANDBLOCK_WORLD_SIZE - 1);
	const vendor = placed(2, 0x0201_0100, 1);
	const motion = {
		currentEntities: () => [player, vendor],
		isAwaitingSnapshot: () => false,
	};
	expect(sampleVendorDistanceMeters(entities, motion, 2)).toBe(2);
	expect(sampleVendorDistanceMeters(entities, motion, 3)).toBeNull();
});
