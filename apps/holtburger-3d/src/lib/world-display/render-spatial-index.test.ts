import { describe, expect, it } from "vitest";

import {
	createLinearRenderSpatialIndex,
	type RenderSpatialItem,
} from "./render-spatial-index";

describe("createLinearRenderSpatialIndex", () => {
	it("replaces and clears owner-scoped items", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner-a", [
			createTerrainItem("near", "owner-a", 4, 6),
		]);
		index.replaceOwnerItems("owner-b", [
			createTerrainItem("far", "owner-b", 8, 10),
		]);
		index.replaceOwnerItems("owner-a", []);

		const pick = index.pickRay(createForwardRay(), new Set(["terrain"]));

		expect(pick?.item.id).toBe("far");
	});

	it("filters picks by kind mask", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			createTerrainItem("terrain", "owner", 4, 6),
			createPortalItem("portal", "owner", 2, 3),
		]);

		const pick = index.pickRay(createForwardRay(), new Set(["portal"]));

		expect(pick?.item.id).toBe("portal");
		expect(pick?.item.kind).toBe("portal");
	});

	it("filters picks by owner key when requested", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("mesh-owner", [
			createTerrainItem("mesh-cell", "mesh-owner", 2, 4),
		]);
		index.replaceOwnerItems("debug-owner", [
			createTerrainItem("debug-cell", "debug-owner", 6, 8),
		]);

		const pick = index.pickRay(
			createForwardRay(),
			new Set(["terrain"]),
			new Set(["debug-owner"]),
		);

		expect(pick?.item.id).toBe("debug-cell");
	});

	it("returns the nearest matching pick", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			createTerrainItem("far", "owner", 8, 10),
			createTerrainItem("near", "owner", 2, 4),
		]);

		const pick = index.pickRay(createForwardRay(), new Set(["terrain"]));

		expect(pick?.item.id).toBe("near");
		expect(pick?.distance).toBe(2);
	});

	it("picks sphere shapes through the public spatial index", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			{
				...createTerrainItem("sphere", "owner", 3, 7),
				pickShape: {
					kind: "sphere",
					center: { x: 0, y: 0, z: 5 },
					radius: 1,
				},
			},
		]);

		const pick = index.pickRay(createForwardRay(), new Set(["terrain"]));

		expect(pick?.item.id).toBe("sphere");
		expect(pick?.distance).toBe(4);
		expect(pick?.point).toEqual({ x: 0, y: 0, z: 4 });
	});

	it("picks polygon shapes through the public spatial index", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			{
				...createTerrainItem("polygon", "owner", 4, 6),
				pickShape: {
					kind: "polygon",
					points: [
						{ x: -1, y: -1, z: 5 },
						{ x: 1, y: -1, z: 5 },
						{ x: 1, y: 1, z: 5 },
						{ x: -1, y: 1, z: 5 },
					],
					thickness: 0.01,
				},
			},
		]);

		const pick = index.pickRay(createForwardRay(), new Set(["terrain"]));

		expect(pick?.item.id).toBe("polygon");
		expect(pick?.distance).toBe(5);
		expect(pick?.point).toEqual({ x: 0, y: 0, z: 5 });
	});

	it("returns conservative frustum matches by kind mask", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			createTerrainItem("inside", "owner", 2, 4),
			createTerrainItem("outside", "owner", 12, 14),
			createPortalItem("portal-inside", "owner", 2, 4),
		]);

		const visibleItems = index.queryFrustum(
			{
				planes: [
					{ normal: { x: 1, y: 0, z: 0 }, constant: 1 },
					{ normal: { x: -1, y: 0, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: 1, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: -1, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: 0, z: 1 }, constant: -1 },
					{ normal: { x: 0, y: 0, z: -1 }, constant: 6 },
				],
			},
			new Set(["terrain"]),
		);

		expect(visibleItems.map((item) => item.id)).toEqual(["inside"]);
	});

	it("returns the same renderer-space ray hit after a chunk transform update", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			createChunkedTerrainItem("chunked", "owner", "landblock/da55ffff", 2, 4),
		]);
		index.replaceChunkTransforms([
			createChunkTransform("landblock/da55ffff", { x: 0, y: 0, z: 0 }),
		]);
		const initialPick = index.pickRay(createForwardRay(), new Set(["terrain"]));

		index.replaceChunkTransforms([
			createChunkTransform("landblock/da55ffff", { x: 0, y: 0, z: -2 }),
		]);
		const rebasedPick = index.pickRay(
			{
				origin: { x: 0, y: 0, z: -2 },
				direction: { x: 0, y: 0, z: 1 },
			},
			new Set(["terrain"]),
		);

		expect(initialPick?.item.id).toBe("chunked");
		expect(initialPick?.point).toEqual({ x: 0, y: 0, z: 2 });
		expect(rebasedPick?.item.id).toBe("chunked");
		expect(rebasedPick?.point).toEqual({ x: 0, y: 0, z: 0 });
		expect(rebasedPick?.distance).toBe(2);
	});

	it("respects chunk transforms when querying frustums", () => {
		const index = createTestIndex();
		index.replaceOwnerItems("owner", [
			createChunkedTerrainItem("visible", "owner", "landblock/da55ffff", 2, 4),
			createChunkedTerrainItem("hidden", "owner", "landblock/db55ffff", 2, 4),
		]);
		index.replaceChunkTransforms([
			createChunkTransform("landblock/da55ffff", { x: 0, y: 0, z: 0 }),
			createChunkTransform("landblock/db55ffff", { x: 20, y: 0, z: 0 }),
		]);

		const visibleItems = index.queryFrustum(
			{
				planes: [
					{ normal: { x: 1, y: 0, z: 0 }, constant: 1 },
					{ normal: { x: -1, y: 0, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: 1, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: -1, z: 0 }, constant: 1 },
					{ normal: { x: 0, y: 0, z: 1 }, constant: -1 },
					{ normal: { x: 0, y: 0, z: -1 }, constant: 6 },
				],
			},
			new Set(["terrain"]),
		);

		expect(visibleItems.map((item) => item.id)).toEqual(["visible"]);
	});

	it("fails visibly when a chunked item is missing its transform", () => {
		const index = createLinearRenderSpatialIndex();
		index.replaceOwnerItems("owner", [
			createChunkedTerrainItem("chunked", "owner", "landblock/da55ffff", 2, 4),
		]);

		expect(() =>
			index.pickRay(createForwardRay(), new Set(["terrain"])),
		).toThrow(/missing chunk transform landblock\/da55ffff/);
		expect(() =>
			index.queryFrustum({ planes: [] }, new Set(["terrain"])),
		).toThrow(/missing chunk transform landblock\/da55ffff/);
	});
});

const DEFAULT_CHUNK_KEY = "landblock/da55ffff";

function createTestIndex() {
	const index = createLinearRenderSpatialIndex();
	index.replaceChunkTransforms([
		createChunkTransform(DEFAULT_CHUNK_KEY, { x: 0, y: 0, z: 0 }),
	]);
	return index;
}

function createTerrainItem(
	id: string,
	ownerKey: string,
	minZ: number,
	maxZ: number,
): RenderSpatialItem {
	const bounds = {
		min: { x: -1, y: -1, z: minZ },
		max: { x: 1, y: 1, z: maxZ },
	};
	return {
		id,
		kind: "terrain",
		ownerKey,
		chunkKey: DEFAULT_CHUNK_KEY,
		broadphaseBounds: bounds,
		pickShape: { kind: "box", bounds },
		metadata: {
			kind: "terrain",
			landblockId: minZ,
			assetId: id,
			terrainQuad: null,
		},
	};
}

function createChunkedTerrainItem(
	id: string,
	ownerKey: string,
	chunkKey: RenderSpatialItem["chunkKey"],
	minZ: number,
	maxZ: number,
): RenderSpatialItem {
	return {
		...createTerrainItem(id, ownerKey, minZ, maxZ),
		chunkKey,
	};
}

function createChunkTransform(
	chunkKey: RenderSpatialItem["chunkKey"],
	offset: { x: number; y: number; z: number },
) {
	return {
		chunkKey,
		chunkLandblockId: Number.parseInt(chunkKey.slice("landblock/".length), 16),
		offset,
	};
}

function createPortalItem(
	id: string,
	ownerKey: string,
	minZ: number,
	maxZ: number,
): RenderSpatialItem {
	const bounds = {
		min: { x: -1, y: -1, z: minZ },
		max: { x: 1, y: 1, z: maxZ },
	};
	return {
		id,
		kind: "portal",
		ownerKey,
		chunkKey: DEFAULT_CHUNK_KEY,
		broadphaseBounds: bounds,
		pickShape: { kind: "box", bounds },
		metadata: {
			kind: "portal",
			portalId: id,
			sourceEnvCellId: 1,
			targetEnvCellId: 2,
			targetStatus: "loaded-visible",
			polygonId: 3,
			otherPortalId: 4,
			flags: 5,
		},
	};
}

function createForwardRay() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		direction: { x: 0, y: 0, z: 1 },
	};
}
