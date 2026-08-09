import { describe, expect, it } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { PlanarAperture } from "../scene/planar-aperture";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import {
	cameraNearClipPrimitiveCount,
	createCameraNearClipVolume,
} from "./portal-near-plane";
import {
	PortalPathViewPlanner,
	type PortalPathViewPlanInput,
} from "./portal-path-view-planner";
import { portalWindowProjectionPrimitiveCount } from "./portal-view-window";

const LANDBLOCK_ID = "0xda55ffff" as const;
const OUTDOOR: SceneScope = { kind: "outdoor" };

describe("PortalPathViewPlanner", () => {
	it("streams canonical breadth-first paths independently from topology storage order", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const third = envCellScope("0x01000003");
		const a = crossing("a", OUTDOOR, first, rectangle(-0.9, -0.8, -0.1, 0.8));
		const b = crossing("b", OUTDOOR, second, rectangle(0.1, -0.8, 0.9, 0.8));
		const c = crossing("c", first, third, rectangle(-0.8, -0.6, -0.2, 0.6));
		const scopes = [
			topologyScope(OUTDOOR, null),
			topologyScope(first, "first"),
			topologyScope(second, "second"),
			topologyScope(third, "third"),
		];

		const canonical = new PortalPathViewPlanner().plan(
			topology(scopes, [a, b, c]),
			planInput(OUTDOOR),
		);
		const shuffled = new PortalPathViewPlanner().plan(
			topology(scopes.toReversed(), [c, b, a], false),
			planInput(OUTDOOR),
		);

		expect(pathSignatures(canonical)).toEqual([
			"root",
			"portal-crossing:a",
			"portal-crossing:b",
			"portal-crossing:a>portal-crossing:c",
		]);
		expect(pathSignatures(shuffled)).toEqual(pathSignatures(canonical));
		expect(shuffled.views.map(({ ownershipLabel }) => ownershipLabel)).toEqual(
			canonical.views.map(({ ownershipLabel }) => ownershipLabel),
		);
	});

	it("discards an entire candidate frontier as soon as the view lower bound exceeds capacity", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const descendant = envCellScope("0x01000003");
		const graph = topology(
			[
				topologyScope(OUTDOOR, null),
				topologyScope(first, "first"),
				topologyScope(second, "second"),
				topologyScope(descendant, "descendant"),
			],
			[
				crossing("a", OUTDOOR, first, rectangle(-0.9, -0.8, -0.1, 0.8)),
				crossing("b", OUTDOOR, second, rectangle(0.1, -0.8, 0.9, 0.8)),
				crossing("descendant", first, descendant),
			],
		);

		const plan = new PortalPathViewPlanner().plan(
			graph,
			planInput(OUTDOOR, {
				budget: { ...defaultBudget(), maximumPathViewCount: 2 },
			}),
		);

		expect(pathSignatures(plan)).toEqual(["root"]);
		expect(plan.truncation).toEqual({
			budget: 2,
			firstOmittedPathDepth: 1,
			kind: "maximum-path-view-count",
			observedMinimum: 3,
		});
		expect(plan.trace.constructedPathViewCount).toBe(3);
		expect(plan.trace.attemptedCrossingCount).toBe(2);
	});

	it("colors disjoint siblings together and rejects a nested frontier atomically", () => {
		const left = envCellScope("0x01000001");
		const right = envCellScope("0x01000002");
		const nested = envCellScope("0x01000003");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[
					topologyScope(OUTDOOR, null),
					topologyScope(left, "left"),
					topologyScope(right, "right"),
					topologyScope(nested, "nested"),
				],
				[
					crossing("left", OUTDOOR, left, rectangle(-0.9, -0.8, -0.1, 0.8)),
					crossing("right", OUTDOOR, right, rectangle(0.1, -0.8, 0.9, 0.8)),
					crossing("nested", left, nested, rectangle(-0.8, -0.6, -0.2, 0.6)),
				],
			),
			planInput(OUTDOOR, {
				budget: { ...defaultBudget(), maximumOwnershipLabelCount: 2 },
			}),
		);

		expect(pathSignatures(plan)).toEqual([
			"root",
			"portal-crossing:left",
			"portal-crossing:right",
		]);
		expect(plan.views.map(({ ownershipLabel }) => ownershipLabel)).toEqual([
			0, 1, 1,
		]);
		expect(plan.truncation).toEqual({
			budget: 2,
			firstOmittedPathDepth: 2,
			kind: "maximum-ownership-label-count",
			observedMinimum: 3,
		});
	});

	it("keeps outdoor re-entry as a distinct view sharing one exterior cache domain", () => {
		const firstIndoor = envCellScope("0x01000001");
		const lastIndoor = envCellScope("0x01000002");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[
					topologyScope(OUTDOOR, null),
					topologyScope(firstIndoor, "first"),
					topologyScope(lastIndoor, "last"),
				],
				[
					crossing(
						"into-first",
						OUTDOOR,
						firstIndoor,
						rectangle(-0.9, -0.9, 0.9, 0.9),
					),
					crossing(
						"back-out",
						firstIndoor,
						OUTDOOR,
						rectangle(-0.8, -0.8, 0.8, 0.8),
					),
					crossing(
						"into-last",
						OUTDOOR,
						lastIndoor,
						rectangle(-0.7, -0.7, 0.7, 0.7),
					),
				],
			),
			planInput(OUTDOOR, {
				budget: { ...defaultBudget(), maximumPathDepth: 3 },
			}),
		);

		expect(pathSignatures(plan)).toContain(
			"portal-crossing:into-first>portal-crossing:back-out",
		);
		const outdoorViews = plan.views.filter(
			({ domainId }) => domainId === "portal-content-domain:outdoor",
		);
		expect(outdoorViews).toHaveLength(2);
		expect(new Set(outdoorViews.map(({ id }) => id)).size).toBe(2);
		expect(plan.exteriorCacheDomainId).toBe("portal-content-domain:outdoor");
	});

	it("withholds the in-progress frontier when checked projection work exceeds its budget", () => {
		const indoor = envCellScope("0x01000001");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[topologyScope(OUTDOOR, null), topologyScope(indoor, "indoor")],
				[crossing("into-indoor", OUTDOOR, indoor)],
			),
			planInput(OUTDOOR, {
				budget: { ...defaultBudget(), maximumProjectionPrimitiveCount: 1 },
			}),
		);

		expect(pathSignatures(plan)).toEqual(["root"]);
		expect(plan.truncation?.kind).toBe("maximum-projection-primitive-count");
		expect(plan.truncation?.observedMinimum).toBeGreaterThan(1);
	});

	it("withholds the in-progress frontier when exact conflict work exceeds its budget", () => {
		const indoor = envCellScope("0x01000001");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[topologyScope(OUTDOOR, null), topologyScope(indoor, "indoor")],
				[crossing("into-indoor", OUTDOOR, indoor)],
			),
			planInput(OUTDOOR, {
				budget: { ...defaultBudget(), maximumConflictPrimitiveCount: 1 },
			}),
		);

		expect(pathSignatures(plan)).toEqual(["root"]);
		expect(plan.truncation).toEqual({
			budget: 1,
			firstOmittedPathDepth: 1,
			kind: "maximum-conflict-primitive-count",
			observedMinimum: 2,
		});
		expect(plan.trace.conflictPrimitiveCount).toBe(1);
	});

	it("terminates a topology cycle when its directed crossing would repeat", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[topologyScope(first, "first"), topologyScope(second, "second")],
				[
					crossing("first-to-second", first, second),
					crossing("second-to-first", second, first),
				],
			),
			planInput(first),
		);

		expect(pathSignatures(plan)).toEqual([
			"root",
			"portal-crossing:first-to-second",
			"portal-crossing:first-to-second>portal-crossing:second-to-first",
		]);
		expect(plan.truncation).toBeNull();
	});

	it("retains depth-continuous scope traversal without allocating a mask label", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[topologyScope(first, "shared"), topologyScope(second, "shared")],
				[
					crossing(
						"continuous",
						first,
						second,
						rectangle(-0.9, -0.9, 0.9, 0.9),
						{
							kind: "indoor-depth-continuous",
							reciprocalApertureId: "portal-aperture:continuous",
						},
					),
				],
			),
			planInput(first),
		);

		expect(plan.views.map(({ ownershipLabel }) => ownershipLabel)).toEqual([
			0, 0,
		]);
		expect(
			plan.views.map(
				({ requiresOwnershipTransition }) => requiresOwnershipTransition,
			),
		).toEqual([false, false]);
	});

	it("keeps same-island topology boundaries on their parent ownership label", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const plan = new PortalPathViewPlanner().plan(
			topology(
				[topologyScope(first, "shared"), topologyScope(second, "shared")],
				[crossing("boundary", first, second)],
			),
			planInput(first),
		);

		expect(plan.views.map(({ ownershipLabel }) => ownershipLabel)).toEqual([
			0, 0,
		]);
		expect(plan.views[1]?.requiresOwnershipTransition).toBe(false);
	});

	it("separates retained aperture preparation from exactly summed camera projection work", () => {
		const indoor = envCellScope("0x01000001");
		const graph = topology(
			[topologyScope(OUTDOOR, null), topologyScope(indoor, "indoor")],
			[crossing("into-indoor", OUTDOOR, indoor)],
		);
		const planner = new PortalPathViewPlanner();
		const first = planner.plan(graph, planInput(OUTDOOR));
		const second = planner.plan(graph, planInput(OUTDOOR));

		expect(first.trace.topologyPreparation).toMatchObject({
			apertureCount: 1,
			triangleCount: 2,
		});
		expect(
			first.trace.topologyPreparation.convexityVertexTestCount,
		).toBeGreaterThan(0);
		expect(
			first.trace.topologyPreparation.mergeEdgePairTestCount,
		).toBeGreaterThan(0);
		expect(second.trace.topologyPreparation).toEqual(
			first.trace.topologyPreparation,
		);
		expect(first.trace.projectionPrimitiveCount).toBeGreaterThan(0);
		expect(first.trace.projectionPrimitiveCount).toBe(
			first.trace.anchorApertureVertexTransformCount +
				cameraNearClipPrimitiveCount(first.trace.nearClip) +
				portalWindowProjectionPrimitiveCount(first.trace.projection),
		);
		expect(first.trace.anchorApertureVertexTransformCount).toBe(4);
		expect(first.trace.nearClip.vertexPlaneTestCount).toBeGreaterThan(0);
		expect(second.trace.projectionPrimitiveCount).toBe(
			first.trace.projectionPrimitiveCount,
		);
	});

	it("deduplicates structurally identical aperture instances by authored id", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const firstCrossing = crossing("shared", OUTDOOR, first);
		const clonedAperture = cloneSceneAperture(firstCrossing.sourceAperture);
		const secondCrossing = {
			...crossing("other-crossing", OUTDOOR, second),
			sourceAperture: clonedAperture,
			visibilityAperture: clonedAperture,
		};

		const plan = new PortalPathViewPlanner().plan(
			topology(
				[
					topologyScope(OUTDOOR, null),
					topologyScope(first, "first"),
					topologyScope(second, "second"),
				],
				[firstCrossing, secondCrossing],
			),
			planInput(OUTDOOR),
		);

		expect(plan.trace.topologyPreparation.apertureCount).toBe(1);
		expect(
			plan.trace.topologyPreparation.duplicateApertureScalarComparisonCount,
		).toBeGreaterThan(0);
	});

	it("rejects one authored aperture id carrying different geometry", () => {
		const first = envCellScope("0x01000001");
		const second = envCellScope("0x01000002");
		const firstCrossing = crossing("shared", OUTDOOR, first);
		const conflictingAperture = cloneSceneAperture(
			firstCrossing.sourceAperture,
		);
		conflictingAperture.vertices[0] = conflictingAperture.vertices[0]! + 0.01;
		const secondCrossing = {
			...crossing("other-crossing", OUTDOOR, second),
			sourceAperture: conflictingAperture,
			visibilityAperture: conflictingAperture,
		};

		expect(() =>
			new PortalPathViewPlanner().plan(
				topology(
					[
						topologyScope(OUTDOOR, null),
						topologyScope(first, "first"),
						topologyScope(second, "second"),
					],
					[firstCrossing, secondCrossing],
				),
				planInput(OUTDOOR),
			),
		).toThrow(/repeats with different geometry/);
	});
});

function defaultBudget() {
	return {
		maximumConflictPrimitiveCount: 1_000_000,
		maximumOwnershipLabelCount: 256,
		maximumPathDepth: 8,
		maximumPathViewCount: 1_024,
		maximumProjectionPrimitiveCount: 1_000_000,
	};
}

function planInput(
	rootScope: SceneScope,
	overrides: Partial<PortalPathViewPlanInput> = {},
): PortalPathViewPlanInput {
	return {
		anchorCoordinates: getLandblockCoordinates(LANDBLOCK_ID),
		budget: defaultBudget(),
		clipFromAnchor: Mat4.identity(),
		nearClipVolume: createCameraNearClipVolume(
			{ fov: 90, near: 0.1 },
			{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
			1,
		),
		portalFootprint: {
			drawingBufferHeight: 1,
			drawingBufferWidth: 1,
			minimumPixelArea: 0,
		},
		rootScope,
		...overrides,
	};
}

function topology(
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossingInput[],
	canonicalStorage = true,
): SceneTopologyView {
	const storedCrossings = canonicalStorage
		? [...crossings].sort((left, right) => left.id.localeCompare(right.id))
		: [...crossings];
	const outgoingByScope = new Map<string, ScenePortalCrossingInput[]>();
	for (const edge of storedCrossings) {
		const key = scopeIdentity(edge.source);
		const outgoing = outgoingByScope.get(key) ?? [];
		outgoing.push(edge);
		outgoingByScope.set(key, outgoing);
	}
	return {
		crossings: storedCrossings,
		outgoing: (scope) => outgoingByScope.get(scopeIdentity(scope)) ?? [],
		revision: 1,
		scopes,
	};
}

function topologyScope(
	scope: SceneScope,
	island: string | null,
): SceneTopologyScope {
	return {
		potentiallyVisibleEnvCellIds: new Set(),
		scope,
		visibilityIslandId:
			island === null
				? null
				: (`env-cell-island:${island}` as SceneTopologyScope["visibilityIslandId"]),
	};
}

function envCellScope(id: string): Extract<SceneScope, { kind: "env-cell" }> {
	return { envCellId: id, kind: "env-cell", landblockId: LANDBLOCK_ID };
}

function crossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	aperture = rectangle(-0.9, -0.9, 0.9, 0.9),
	spatialRelationship: ScenePortalCrossingInput["spatialRelationship"] = {
		kind: "indoor-topology-boundary",
		reason: "synthetic-boundary",
	},
): ScenePortalCrossingInput {
	const sceneAperture = {
		id: `portal-aperture:${id}` as const,
		indices: aperture.indices,
		landblockBounds: boundsForAperture(aperture),
		landblockId: LANDBLOCK_ID,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
	return {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId: null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship,
		target,
		visibilityAperture: sceneAperture,
	};
}

function rectangle(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	z = 0,
): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		plane: { d: -z, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			minX,
			minY,
			z,
			maxX,
			minY,
			z,
			maxX,
			maxY,
			z,
			minX,
			maxY,
			z,
		]),
	};
}

function boundsForAperture(aperture: PlanarAperture): AABB3 {
	const first = new Vec3(
		aperture.vertices[0]!,
		aperture.vertices[1]!,
		aperture.vertices[2]!,
	);
	const bounds = new AABB3(first.clone(), first.clone());
	for (let index = 3; index < aperture.vertices.length; index += 3) {
		const x = aperture.vertices[index]!;
		const y = aperture.vertices[index + 1]!;
		const z = aperture.vertices[index + 2]!;
		bounds.min.x = Math.min(bounds.min.x, x);
		bounds.min.y = Math.min(bounds.min.y, y);
		bounds.min.z = Math.min(bounds.min.z, z);
		bounds.max.x = Math.max(bounds.max.x, x);
		bounds.max.y = Math.max(bounds.max.y, y);
		bounds.max.z = Math.max(bounds.max.z, z);
	}
	return bounds;
}

function cloneSceneAperture(
	aperture: ScenePortalCrossingInput["sourceAperture"],
): ScenePortalCrossingInput["sourceAperture"] {
	return {
		...aperture,
		indices: aperture.indices.slice(),
		landblockBounds: new AABB3(
			aperture.landblockBounds.min.clone(),
			aperture.landblockBounds.max.clone(),
		),
		plane: {
			d: aperture.plane.d,
			normal: aperture.plane.normal.clone(),
		},
		vertices: aperture.vertices.slice(),
	};
}

function pathSignatures(plan: {
	readonly views: readonly {
		readonly crossingIds: readonly PortalCrossingId[];
	}[];
}) {
	return plan.views.map(({ crossingIds }) =>
		crossingIds.length === 0 ? "root" : crossingIds.join(">"),
	);
}

function scopeIdentity(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? "outdoor"
		: `${scope.landblockId}/${scope.envCellId}`;
}
