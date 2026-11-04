import { describe, expect, it } from "vitest";
import { sceneVector3 } from "../../assets/ac-frame";
import { formatWorldMapCoordinates } from "../map/map-coordinates";
import { WORLD_MAP_EXTENT } from "./types";
import { WORLD_MAP_SETTLEMENTS } from "./world-map-settlements";
import { projectWorldMapPoint, worldMapPosition } from "./view";
import {
	projectWorldMapSettlements,
	hitWorldMapSettlement,
	WORLD_MAP_SETTLEMENT_HIT_RADIUS,
	type WorldMapSettlement,
} from "./settlements";

const view = { centerX: 500, centerZ: -500, spanMeters: 1000 };
const bounds = { minX: 0, maxX: 1000, minZ: -1000, maxZ: 0 };
const settlement = (
	name: string,
	x: number,
	z: number,
): WorldMapSettlement => ({ name, position: sceneVector3([x, 0, z]) });

describe("settlement overlay placement", () => {
	it("uses the map's north-up projection and round-trips through terrain hover", () => {
		const position = { x: 250, z: -750 };
		const [x, y] = projectWorldMapPoint(position, view, 200, 100);
		expect([x, y]).toEqual([50, 0]);
		expect(worldMapPosition(x, y, view, bounds, 200, 100)).toEqual(position);
	});
	it("projects in-view anchors and culls offscreen anchors", () => {
		const placements = projectWorldMapSettlements(
			[
				settlement("A", 250, -500),
				settlement("Edge", 990, -500),
				settlement("Offscreen", 1500, -500),
			],
			view,
			200,
			100,
		);
		expect(
			placements.map(({ settlement, x, y }) => [settlement.name, x, y]),
		).toEqual([
			["A", 50, 50],
			["Edge", 198, 50],
		]);
	});
	it("uses a fixed screen-radius hit target and stable name ties", () => {
		const placements = projectWorldMapSettlements(
			[settlement("B", 500, -500), settlement("A", 500, -500)],
			view,
			200,
			100,
		);
		expect(hitWorldMapSettlement(placements, 100, 50)?.name).toBe("A");
		expect(
			hitWorldMapSettlement(
				placements,
				100 + WORLD_MAP_SETTLEMENT_HIT_RADIUS,
				50,
			)?.name,
		).toBe("A");
		expect(
			hitWorldMapSettlement(
				placements,
				100 + WORLD_MAP_SETTLEMENT_HIT_RADIUS + 1,
				50,
			),
		).toBeNull();
	});
});

describe("bundled settlement anchors", () => {
	it("has unique, alphabetical names and positions inside the default world", () => {
		const names = WORLD_MAP_SETTLEMENTS.map((entry) => entry.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toEqual([...names].sort());
		for (const { position } of WORLD_MAP_SETTLEMENTS) {
			expect(position.every(Number.isFinite)).toBe(true);
			expect(position[0]).toBeGreaterThanOrEqual(0);
			expect(position[0]).toBeLessThanOrEqual(WORLD_MAP_EXTENT);
			expect(position[2]).toBeLessThanOrEqual(0);
			expect(position[2]).toBeGreaterThanOrEqual(-WORLD_MAP_EXTENT);
		}
	});
	it("formats a verified Holtburg portal anchor in the existing AC coordinate convention", () => {
		const town = WORLD_MAP_SETTLEMENTS.find(
			(entry) => entry.name === "Holtburg",
		);
		if (!town) throw new Error("Missing Holtburg reference.");
		expect(
			formatWorldMapCoordinates({ x: town.position[0], z: town.position[2] }),
		).toBe("42.0N, 33.5E");
	});
	it("locates Crater Lake Village at its verified outdoor vendor placement", () => {
		const town = WORLD_MAP_SETTLEMENTS.find(
			(entry) => entry.name === "Crater Lake Village",
		);
		if (!town) throw new Error("Missing Crater Lake Village reference.");
		expect(
			formatWorldMapCoordinates({ x: town.position[0], z: town.position[2] }),
		).toBe("64.8N, 13.4E");
	});
});
