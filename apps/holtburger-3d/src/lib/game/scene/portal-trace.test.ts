import { sceneVec3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ScenePortalCrossingInput, SceneResidency, SceneScope } from ".";
import { SceneGraph } from ".";
import {
	traceScenePortalSegment,
	type ScenePortalTraceTopology,
} from "./portal-trace";
import { sameScope, scopeKey } from "./scope";

const LANDBLOCK = "0x0000ffff" as const;
const CELL_ONE = cellScope("0x00000001");
const CELL_TWO = cellScope("0x00000002");
const CELL_THREE = cellScope("0x00000003");
const OUTDOOR: SceneScope = { kind: "outdoor" };

describe("authoritative-anchor portal tracing", () => {
	it("keeps authoritative residency without a topology crossing", () => {
		const result = trace(
			[],
			residency(CELL_ONE),
			new Vec3(5, 1, -10),
			new Vec3(25, 1, -10),
		);

		expect(result).toEqual({
			crossings: [],
			kind: "complete",
			residency: residency(CELL_ONE),
		});
	});

	it("traces the earliest outgoing aperture through multiple scopes", () => {
		const first = crossing("first", CELL_ONE, CELL_TWO, 10, "negative");
		const second = crossing("second", CELL_TWO, CELL_THREE, 20, "negative");

		const result = trace(
			[second, first],
			residency(CELL_ONE),
			new Vec3(5, 1, -10),
			new Vec3(25, 1, -10),
		);

		expect(result.kind).toBe("complete");
		expect(
			result.crossings.map(({ crossingId, t }) => [crossingId, t]),
		).toEqual([
			["portal-crossing:first", 0.25],
			["portal-crossing:second", 0.75],
		]);
		if (result.kind !== "complete") {
			throw new Error(`Expected a complete trace, received ${result.kind}.`);
		}
		expect(result.residency).toEqual(residency(CELL_THREE));
	});

	it("rejects reverse-facing, aperture-miss, endpoint-touch, and coplanar segments", () => {
		const link = crossing("link", CELL_ONE, CELL_TWO, 10, "negative");
		for (const [start, endpoint] of [
			[new Vec3(15, 1, -10), new Vec3(5, 1, -10)],
			[new Vec3(5, 4, -10), new Vec3(15, 4, -10)],
			[new Vec3(5, 1, -10), new Vec3(10, 1, -10)],
			[new Vec3(10, 0, -10), new Vec3(10, 2, -10)],
		] as const) {
			expect(trace([link], residency(CELL_ONE), start, endpoint)).toEqual({
				crossings: [],
				kind: "complete",
				residency: residency(CELL_ONE),
			});
		}
	});

	it("does not switch to a spatially overlapping but unconnected cell", () => {
		const result = trace(
			[crossing("other", CELL_TWO, CELL_THREE, 10, "negative")],
			residency(CELL_ONE),
			new Vec3(5, 1, -10),
			new Vec3(15, 1, -10),
		);

		expect(result).toMatchObject({
			kind: "complete",
			residency: residency(CELL_ONE),
		});
	});

	it("returns ambiguity instead of choosing tied portals with different targets", () => {
		const result = trace(
			[
				crossing("to-two", CELL_ONE, CELL_TWO, 10, "negative"),
				crossing("to-three", CELL_ONE, CELL_THREE, 10, "negative"),
			],
			residency(CELL_ONE),
			new Vec3(5, 1, -10),
			new Vec3(15, 1, -10),
		);

		expect(result).toEqual({
			blockingIds: ["portal-crossing:to-three", "portal-crossing:to-two"],
			crossings: [],
			fallbackResidency: residency(CELL_ONE),
			kind: "topology-unavailable",
			reachedResidency: residency(CELL_ONE),
			reason: "ambiguous-boundary",
		});
	});

	it("bounds cyclic topology and preserves authoritative fallback", () => {
		const first = crossing("one-two", CELL_ONE, CELL_TWO, 10, "negative");
		const second = crossing("two-one", CELL_TWO, CELL_ONE, 20, "negative");
		const third = crossing("one-three", CELL_ONE, CELL_THREE, 30, "negative");
		const result = trace(
			[first, second, third],
			residency(CELL_ONE),
			new Vec3(5, 1, -10),
			new Vec3(35, 1, -10),
			2,
		);

		expect(result).toMatchObject({
			blockingIds: ["portal-crossing:one-three"],
			fallbackResidency: residency(CELL_ONE),
			kind: "topology-unavailable",
			reachedResidency: residency(CELL_ONE),
			reason: "crossing-limit",
		});
		expect(result.crossings).toHaveLength(2);
	});

	it("traces both authored directions of a claimed exterior transition", () => {
		const outward = crossing(
			"outward",
			CELL_ONE,
			OUTDOOR,
			10,
			"positive",
			"portal-crossing:inward",
		);
		const inward = crossing(
			"inward",
			OUTDOOR,
			CELL_ONE,
			10,
			"negative",
			"portal-crossing:outward",
		);

		expect(
			trace(
				[outward, inward],
				{ envCellId: null, landblockId: LANDBLOCK },
				new Vec3(5, 1, -10),
				new Vec3(15, 1, -10),
			),
		).toMatchObject({
			kind: "complete",
			residency: residency(CELL_ONE),
		});
		expect(
			trace(
				[outward, inward],
				residency(CELL_ONE),
				new Vec3(15, 1, -10),
				new Vec3(5, 1, -10),
			),
		).toMatchObject({
			kind: "complete",
			residency: { envCellId: null, landblockId: LANDBLOCK },
		});
	});

	it("marks an intersected unclaimed exterior reverse endpoint unavailable", () => {
		const scene = new SceneGraph();
		installScope(scene, CELL_ONE);
		scene.upsertPortalCrossing(
			crossing("outward", CELL_ONE, OUTDOOR, 10, "positive"),
		);

		const result = scene.tracePortalSegment({
			anchor: {
				position: sceneVec3(new Vec3(5, 1, -10)),
				residency: { envCellId: null, landblockId: LANDBLOCK },
			},
			endpoint: sceneVec3(new Vec3(15, 1, -10)),
		});

		expect(result).toMatchObject({
			blockingIds: ["portal-unavailable:portal-crossing:outward/reverse"],
			kind: "topology-unavailable",
			reason: "unclaimed-exterior-endpoint",
		});
		expect(
			scene.tracePortalSegment({
				anchor: {
					position: sceneVec3(new Vec3(15, 1, -10)),
					residency: residency(CELL_ONE),
				},
				endpoint: sceneVec3(new Vec3(5, 1, -10)),
			}),
		).toMatchObject({
			kind: "complete",
			residency: { envCellId: null, landblockId: LANDBLOCK },
		});
	});

	it("reports missing origin topology without deriving residency from the point", () => {
		const result = traceScenePortalSegment(
			{
				anchor: {
					position: sceneVec3(new Vec3(5, 1, -10)),
					residency: residency(CELL_ONE),
				},
				endpoint: sceneVec3(new Vec3(15, 1, -10)),
			},
			topology([], [], undefined, false),
		);

		expect(result).toMatchObject({
			fallbackResidency: residency(CELL_ONE),
			kind: "topology-unavailable",
			reason: "origin-scope-unavailable",
		});
	});

	it("preserves the authoritative fallback when a crossing target is unavailable", () => {
		const link = crossing("link", CELL_ONE, CELL_TWO, 10, "negative");
		const result = traceScenePortalSegment(
			{
				anchor: {
					position: sceneVec3(new Vec3(5, 1, -10)),
					residency: residency(CELL_ONE),
				},
				endpoint: sceneVec3(new Vec3(15, 1, -10)),
			},
			{
				isScopeAvailable: (scope) => sameScope(scope, CELL_ONE),
				maximumCrossingCount: 1,
				outgoing: (scope) => (sameScope(scope, CELL_ONE) ? [link] : []),
				unavailableBoundaries: () => [],
			},
		);

		expect(result).toEqual({
			blockingIds: ["portal-crossing:link"],
			crossings: [],
			fallbackResidency: residency(CELL_ONE),
			kind: "topology-unavailable",
			reachedResidency: residency(CELL_ONE),
			reason: "target-scope-unavailable",
		});
	});
});

function trace(
	crossings: readonly ScenePortalCrossingInput[],
	anchorResidency: SceneResidency,
	start: Vec3,
	endpoint: Vec3,
	maximumCrossingCount?: number,
) {
	const scopes = [OUTDOOR, CELL_ONE, CELL_TWO, CELL_THREE];
	return traceScenePortalSegment(
		{
			anchor: { position: sceneVec3(start), residency: anchorResidency },
			endpoint: sceneVec3(endpoint),
		},
		topology(crossings, scopes, maximumCrossingCount),
	);
}

function topology(
	crossings: readonly ScenePortalCrossingInput[],
	scopes: readonly SceneScope[],
	maximumCrossingCount = crossings.length,
	available = true,
): ScenePortalTraceTopology {
	const scopeKeys = new Set(scopes.map(scopeKey));
	return {
		isScopeAvailable: (scope) => available && scopeKeys.has(scopeKey(scope)),
		maximumCrossingCount,
		outgoing: (scope) =>
			crossings.filter((crossing) => sameScope(crossing.source, scope)),
		unavailableBoundaries: () => [],
	};
}

function crossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	x: number,
	acceptedSide: "positive" | "negative",
	reciprocalCrossingId: ScenePortalCrossingInput["reciprocalCrossingId"] = null,
): ScenePortalCrossingInput {
	const aperture = {
		id: `portal-aperture:${id}` as const,
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		landblockBounds: new AABB3(new Vec3(x, 0, -11), new Vec3(x, 2, -9)),
		landblockId: LANDBLOCK,
		plane: { d: -x, normal: new Vec3(1, 0, 0) },
		vertices: new Float32Array([x, 0, -11, x, 2, -11, x, 2, -9, x, 0, -9]),
	};
	return {
		acceptedSide,
		exactMatch: true,
		id: `portal-crossing:${id}`,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId,
		source,
		sourceAperture: aperture,
		spatialRelationship:
			source.kind === "outdoor" || target.kind === "outdoor"
				? {
						exteriorLandblockId: LANDBLOCK,
						kind: "exterior-transition",
					}
				: {
						kind: "indoor-topology-boundary",
						reason: "missing-reciprocal-identity",
					},
		target,
		visibilityAperture: aperture,
	};
}

function installScope(
	scene: SceneGraph,
	scope: Extract<SceneScope, { readonly kind: "env-cell" }>,
): void {
	scene.upsertEnvCellScope({
		containmentPlanes: new Float32Array(),
		landblockBounds: null,
		potentiallyVisibleEnvCellIds: new Set(),
		scope,
		structureToLandblock: Mat4.identity(),
		seenOutside: false,
		visibilityIslandId: `env-cell-island:${scope.envCellId}`,
	});
}

function cellScope(
	envCellId: `0x${string}`,
): Extract<SceneScope, { readonly kind: "env-cell" }> {
	return { envCellId, kind: "env-cell", landblockId: LANDBLOCK };
}

function residency(
	scope: Extract<SceneScope, { readonly kind: "env-cell" }>,
): SceneResidency {
	return { envCellId: scope.envCellId, landblockId: scope.landblockId };
}
