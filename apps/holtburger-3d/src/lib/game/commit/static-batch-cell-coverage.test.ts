import { describe, expect, it } from "vitest";
import type { EnvCellLayerArtifact } from "./artifacts";
import { StaticBatchCellCoverage } from "./static-batch-cell-coverage";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import {
	createRotationMat4,
	createTranslationMat4,
	multiplyMat4,
	transformAABB3,
} from "../math/matrices";
import type {
	SceneEnvCellScopeInput,
	ScenePlacement,
	ScenePortalCrossingInput,
} from "../scene";
import { PORTAL_QUERY_EPSILON } from "../scene/planar-aperture";

const LANDBLOCK = "0x0001ffff";

describe("static batch cell coverage", () => {
	it("keeps contained batches in their owner and recursively covers protruding batches once per cell", () => {
		const cells = [cell(0, 0, 10), cell(1, 10, 20), cell(2, 20, 30)];
		const query = coverage(cells, [
			crossing(cells[0]!, cells[1]!, 10),
			crossing(cells[1]!, cells[0]!, 10, "negative"),
			crossing(cells[1]!, cells[2]!, 20),
			crossing(cells[2]!, cells[1]!, 20, "negative"),
		]);
		expect(query.resolve(placement(cells[0]!), bounds(1, 2)).scopes).toEqual([
			cells[0]!.scope,
		]);
		expect(query.resolve(placement(cells[0]!), bounds(5, 25)).scopes).toEqual(
			cells.map((c) => c.scope),
		);
		// A second batch starts a new traversal; previous coverage cannot leak into it.
		expect(query.resolve(placement(cells[2]!), bounds(24, 26)).scopes).toEqual([
			cells[2]!.scope,
		]);
	});

	it("applies root placement exactly once and includes the authored owner", () => {
		const owner = cell(0, 0, 10),
			neighbor = cell(1, 10, 20);
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 10)]);
		const placed = {
			...placement(owner),
			localTransform: createTranslationMat4(new Vec3(15, 0, 0)),
		};
		expect(query.resolve(placed, bounds(-0.5, 0.5)).scopes).toEqual([
			owner.scope,
			neighbor.scope,
		]);
	});

	it("uses the portal tolerance for contact without admitting separated bounds", () => {
		const owner = cell(0, 0, 10),
			neighbor = cell(1, 10, 20);
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 10)]);
		expect(
			query.resolve(placement(owner), bounds(9, 10 - PORTAL_QUERY_EPSILON / 2))
				.scopes,
		).toHaveLength(2);
		expect(
			query.resolve(placement(owner), bounds(9, 10 - PORTAL_QUERY_EPSILON * 2))
				.scopes,
		).toHaveLength(1);
	});

	it("rejects bounds outside a rotated target hull even when their AABBs overlap", () => {
		const owner = cell(0, -10, 0);
		const transform = multiplyMat4(
			createTranslationMat4(new Vec3(1, 0, 0)),
			createRotationMat4(
				new Quat(Math.cos(Math.PI / 8), 0, Math.sin(Math.PI / 8), 0),
			),
		);
		const local = new AABB3(new Vec3(-1, -1, -1), new Vec3(1, 1, 1));
		const neighbor = {
			...cell(1, -1, 1),
			structureToLandblock: transform,
			landblockBounds: transformAABB3(transform, local),
			containmentPlanes: new Float32Array([
				1, 0, 0, 1, -1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0, 0, -1,
				1,
			]),
		};
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 0)]);
		expect(
			query.resolve(
				placement(owner),
				new AABB3(new Vec3(2.2, 0, 1.2), new Vec3(2.3, 0.1, 1.3)),
			).scopes,
		).toEqual([owner.scope]);
		expect(query.resolve(placement(owner), bounds(0.5, 1.5)).scopes).toEqual([
			owner.scope,
			neighbor.scope,
		]);
	});

	it("converts renderer coordinates back to AC axes for asymmetric cell planes", () => {
		const owner = cell(0, -10, 0);
		const neighbor = {
			...cell(1, 0, 10),
			landblockBounds: null,
			structureToLandblock: createTranslationMat4(new Vec3(0, 0, 10)),
			containmentPlanes: new Float32Array([0, 1, 0, 0, 0, -1, 0, 1]),
		};
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 0)]);
		const b = (z: number) => new AABB3(new Vec3(1, 0, z), new Vec3(2, 1, z));
		expect(query.resolve(placement(owner), b(9.5)).scopes).toHaveLength(2);
		expect(query.resolve(placement(owner), b(10.5)).scopes).toHaveLength(1);
	});

	it("conservatively retains empty space inside a merged batch's bounds", () => {
		const owner = cell(0, 0, 10),
			neighbor = cell(1, 10, 20);
		// Bounds deliberately cover the empty space between two disconnected contributions.
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 10)]);
		expect(query.resolve(placement(owner), bounds(1, 19)).scopes).toEqual([
			owner.scope,
			neighbor.scope,
		]);
	});

	it("uses render bounds explicitly for a target excluded from point residency", () => {
		const owner = cell(0, 0, 10),
			neighbor = { ...cell(1, 10, 20), containmentPlanes: null };
		const query = coverage([owner, neighbor], [crossing(owner, neighbor, 10)]);
		expect(query.resolve(placement(owner), bounds(5, 15)).scopes).toHaveLength(
			2,
		);
		expect(
			query.resolve(
				placement(owner),
				new AABB3(new Vec3(15, 20, 0), new Vec3(16, 21, 1)),
			).scopes,
		).toHaveLength(1);
	});

	it("stops at topology, island, exterior and landblock boundaries", () => {
		const owner = cell(0, 0, 10),
			neighbor = cell(1, 10, 20),
			edge = crossing(owner, neighbor, 10);
		const variants: ScenePortalCrossingInput[] = [
			{
				...edge,
				spatialRelationship: {
					kind: "indoor-topology-boundary",
					reason: "apertures-differ",
				},
			},
			{
				...edge,
				target: { kind: "outdoor" },
				spatialRelationship: {
					kind: "exterior-transition",
					exteriorLandblockId: LANDBLOCK,
				},
			},
			{ ...edge, target: { ...neighbor.scope, landblockId: "0x0002ffff" } },
		];
		for (const variant of variants)
			expect(
				coverage([owner, neighbor], [variant]).resolve(
					placement(owner),
					bounds(5, 15),
				).scopes,
			).toHaveLength(1);
		const otherIsland = {
			...neighbor,
			visibilityIslandId: "env-cell-island:other" as const,
		};
		expect(
			coverage([owner, otherIsland], [edge]).resolve(
				placement(owner),
				bounds(5, 15),
			).scopes,
		).toHaveLength(1);
	});

	it("fails malformed cell and owner contracts rather than dropping coverage", () => {
		const owner = cell(0, 0, 10),
			neighbor = cell(1, 10, 20);
		expect(() => coverage([owner, owner], [])).toThrow(
			"Duplicate static coverage cell",
		);
		expect(() =>
			coverage([{ ...owner, containmentPlanes: new Float32Array([1]) }], []),
		).toThrow("incomplete planes");
		expect(() => coverage([owner], [crossing(owner, neighbor, 10)])).toThrow(
			"is unavailable",
		);
		const query = coverage([owner], []);
		expect(() =>
			query.resolve({ ...placement(owner), envCellId: null }, bounds(0, 1)),
		).toThrow("requires an EnvCell owner");
		expect(() => query.resolve(placement(neighbor), bounds(0, 1))).toThrow(
			"is unavailable",
		);
		expect(() =>
			query.resolve(
				{ ...placement(owner), landblockId: "0x0002ffff" },
				bounds(0, 1),
			),
		).toThrow("another landblock");
		const unknownHull = {
			...neighbor,
			landblockBounds: null,
			containmentPlanes: null,
		};
		expect(() =>
			coverage([owner, unknownHull], [crossing(owner, neighbor, 10)]).resolve(
				placement(owner),
				bounds(5, 15),
			),
		).toThrow("has no hull or bounds");
	});
});

function bounds(min: number, max: number): AABB3 {
	return new AABB3(new Vec3(min, -0.5, -0.5), new Vec3(max, 0.5, 0.5));
}

function cell(index: number, min: number, max: number): SceneEnvCellScopeInput {
	return {
		scope: {
			kind: "env-cell",
			landblockId: LANDBLOCK,
			envCellId: `0x0001${(0x100 + index).toString(16).padStart(4, "0")}`,
		},
		visibilityIslandId: "env-cell-island:test",
		structureToLandblock: Mat4.identity(),
		landblockBounds: new AABB3(new Vec3(min, -2, -2), new Vec3(max, 2, 2)),
		containmentPlanes: new Float32Array([
			1,
			0,
			0,
			-min,
			-1,
			0,
			0,
			max,
			0,
			1,
			0,
			2,
			0,
			-1,
			0,
			2,
			0,
			0,
			1,
			2,
			0,
			0,
			-1,
			2,
		]),
		potentiallyVisibleEnvCellIds: new Set(),
		seenOutside: false,
	};
}

function placement(c: SceneEnvCellScopeInput): ScenePlacement {
	return {
		landblockId: c.scope.landblockId,
		envCellId: c.scope.envCellId,
		localTransform: Mat4.identity(),
	};
}

function crossing(
	source: SceneEnvCellScopeInput,
	target: SceneEnvCellScopeInput,
	x: number,
	side: "positive" | "negative" = "positive",
): ScenePortalCrossingInput {
	const aperture = {
		id: `portal-aperture:${source.scope.envCellId}/${target.scope.envCellId}` as const,
		landblockId: LANDBLOCK,
		landblockBounds: bounds(x, x),
		vertices: new Float32Array(),
		indices: new Uint32Array(),
		plane: { normal: new Vec3(-1, 0, 0), d: x },
	};
	return {
		id: `portal-crossing:${source.scope.envCellId}/${target.scope.envCellId}`,
		source: source.scope,
		target: target.scope,
		acceptedSide: side,
		exactMatch: true,
		maskDepthPolicy: "reject-equal-depth",
		reciprocalCrossingId: null,
		spatialRelationship: {
			kind: "indoor-depth-continuous",
			reciprocalApertureId: aperture.id,
		},
		sourceAperture: aperture,
		visibilityAperture: aperture,
	};
}

function coverage(
	scopes: SceneEnvCellScopeInput[],
	crossings: ScenePortalCrossingInput[],
): StaticBatchCellCoverage {
	const source: Pick<EnvCellLayerArtifact, "scopes" | "crossings"> = {
		scopes,
		crossings,
	};
	return new StaticBatchCellCoverage(source);
}
