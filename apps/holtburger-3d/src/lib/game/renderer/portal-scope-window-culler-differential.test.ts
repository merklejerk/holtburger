import { describe, expect, it } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec2, Vec3 } from "../math/types";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import type { PlanarAperture } from "../scene/planar-aperture";
import { scopeKey } from "../scene/scope";
import { createCameraNearClipVolume } from "./portal-near-plane";
import {
	PortalScopeWindowCuller,
	type PortalScopeWindowCullerCapacity,
} from "./portal-scope-window-culler";
import {
	cullPortalScopeWindowsReference,
	type PortalScopeWindowReferenceInput,
} from "./portal-scope-window-reference";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	PORTAL_WINDOW_NDC_EPSILON,
	type PortalViewWindow,
} from "./portal-view-window";
import {
	PORTAL_WINDOW_GEOMETRY_SEED,
	seededPortalTrianglePairs,
	seededRandom,
} from "./portal-window-seeded-test-support";

const ANCHOR_LANDBLOCK_ID = "0x4040ffff";
const EAST_LANDBLOCK_ID = "0x4140ffff";
const OUTDOOR_SCOPE = { kind: "outdoor" } as const satisfies SceneScope;
const RETAINED_GEOMETRY_CASE_COUNT = 128;
const EXPANDED_TOPOLOGY_SEED = 0xc011e7;
const CASES_PER_EXPANDED_FAMILY = 48;

const EXPANDED_FAMILIES = [
	"one-hop",
	"fan-in",
	"multipart",
	"cycle-and-return",
	"near-contact",
	"footprint",
	"cross-landblock",
] as const;

/** Structural family whose intended branch is asserted independently of equivalence. */
type ExpandedFamily = (typeof EXPANDED_FAMILIES)[number];
/** Semantics-preserving input storage rewrite applied to one shared fixture. */
type Metamorphism = "combined" | "storage-order" | "triangle-order";

/** One replayable topology/camera input shared by both implementations. */
interface DifferentialCase {
	/** Shared camera and budget facts consumed by both implementations. */
	readonly input: PortalScopeWindowReferenceInput;
	/** Replay coordinates and structural facts attached to every assertion. */
	readonly label: string;
	/** Shared topology input; neither implementation contributes fixture logic. */
	readonly topology: SceneTopologyView;
}

/** Stable scalar representation used only at the differential assertion boundary. */
interface ScopeWindowSnapshot {
	/** Stable authored scope identity. */
	readonly scope: string;
	/** Ordered normalized NDC polygons for accumulated scope coverage. */
	readonly window: readonly (readonly (readonly [number, number])[])[];
}

/** Comparable outputs plus branch evidence from one complete differential run. */
interface DifferentialOutput {
	/** Arena implementation's normalized selected windows. */
	readonly arena: readonly ScopeWindowSnapshot[];
	/** Ordinary third-or-later projections served by the lazy fixed cache. */
	readonly cacheHitCount: number;
	/** Deepest complete arena traversal frontier. */
	readonly completedDepth: number;
	/** Immutable admitted-state count, used to prove fan-in occurred. */
	readonly immutableAdmittedStateCount: number;
	/** Immutable near-volume seed count. */
	readonly immutableNearPlaneSeedCount: number;
	/** Immutable portal-footprint rejection count. */
	readonly immutableRejectedFootprintCount: number;
	/** Immutable planner's normalized selected windows. */
	readonly immutable: readonly ScopeWindowSnapshot[];
}

describe("portal scope-window culler differential", () => {
	it("matches the immutable planner over the retained seeded geometry corpus", () => {
		const pairs = seededPortalTrianglePairs(
			PORTAL_WINDOW_GEOMETRY_SEED,
			RETAINED_GEOMETRY_CASE_COUNT,
		);
		for (let ordinal = 0; ordinal < pairs.length; ordinal += 1) {
			const pair = pairs[ordinal]!;
			assertDifferential(
				linearTriangleCase(pair.inherited, pair.aperture, ordinal),
			);
		}
	});

	it("matches and remains invariant over seeded topology and camera families", () => {
		const random = seededRandom(EXPANDED_TOPOLOGY_SEED);
		for (const family of EXPANDED_FAMILIES) {
			for (let ordinal = 0; ordinal < CASES_PER_EXPANDED_FAMILY; ordinal += 1) {
				const fixture = expandedCase(family, ordinal, random);
				const original = assertDifferential(fixture);
				assertFamilyEvidence(family, ordinal, original, fixture.label);
				for (const mutation of [
					"storage-order",
					"triangle-order",
					"combined",
				] as const) {
					const mutated = mutateCase(fixture, mutation);
					const output = assertDifferential(mutated);
					assertEquivalentWindows(
						output.immutable,
						original.immutable,
						`${mutated.label} implementation=immutable invariant`,
					);
					assertEquivalentWindows(
						output.arena,
						original.arena,
						`${mutated.label} implementation=arena invariant`,
					);
					expect(
						output.completedDepth,
						`${mutated.label} implementation=arena completed-depth invariant`,
					).toBe(original.completedDepth);
				}
			}
		}
	});

	it("materializes sparse selected crossings through canonical packed markers", () => {
		const selected = envCellScope("sparse-selected");
		const alternateRoot = envCellScope("sparse-source-0");
		const scopes: SceneTopologyScope[] = [
			topologyScope(OUTDOOR_SCOPE, null),
			topologyScope(selected, "sparse-selected"),
		];
		const crossings: ScenePortalCrossingInput[] = [
			crossing(
				"sparse-selected",
				OUTDOOR_SCOPE,
				selected,
				rectangleAperture(-0.8, -0.8, 0.8, 0.8),
			),
		];
		for (let ordinal = 0; ordinal < 64; ordinal += 1) {
			const source = envCellScope(`sparse-source-${ordinal}`);
			const target = envCellScope(`sparse-target-${ordinal}`);
			scopes.push(
				topologyScope(source, `sparse-source-${ordinal}`),
				topologyScope(target, `sparse-target-${ordinal}`),
			);
			crossings.push(
				crossing(
					`sparse-unselected-${ordinal}`,
					source,
					target,
					rectangleAperture(-0.5, -0.5, 0.5, 0.5),
				),
			);
		}
		const culler = new PortalScopeWindowCuller(cullerCapacity());
		const graph = topology(scopes, crossings, 90_000);
		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(
			Array.from(
				{ length: frame.selectedCrossingCount },
				(_, ordinal) => frame.selectedCrossing(ordinal).id,
			),
		).toEqual(["portal-crossing:sparse-selected"]);
		expect(frame.trace.selectedCrossingInputCount).toBe(1);
		expect(frame.trace.selectedCrossingMarkerWordInputCount).toBe(3);

		const alternate = culler.cull(graph, planInput(alternateRoot));
		expect(
			Array.from(
				{ length: alternate.selectedCrossingCount },
				(_, ordinal) => alternate.selectedCrossing(ordinal).id,
			),
		).toEqual(["portal-crossing:sparse-unselected-0"]);
	});

	it("reuses an ordinary projected aperture after three independent routes", () => {
		const first = envCellScope("cache-first");
		const second = envCellScope("cache-second");
		const third = envCellScope("cache-third");
		const fourth = envCellScope("cache-fourth");
		const middle = envCellScope("cache-middle");
		const leaf = envCellScope("cache-leaf");
		const fullAperture = rectangleAperture(-0.98, -0.9, 0.98, 0.9);
		const fixture = differentialCase(
			"fan-in",
			999,
			planInput(OUTDOOR_SCOPE),
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(first, "cache-first"),
				topologyScope(second, "cache-second"),
				topologyScope(third, "cache-third"),
				topologyScope(fourth, "cache-fourth"),
				topologyScope(middle, "cache-middle"),
				topologyScope(leaf, "cache-leaf"),
			],
			[
				crossing(
					"cache-root-first",
					OUTDOOR_SCOPE,
					first,
					rectangleAperture(-0.95, -0.8, -0.25, 0.8),
				),
				crossing(
					"cache-root-second",
					OUTDOOR_SCOPE,
					second,
					rectangleAperture(-0.4, -0.8, 0.4, 0.8),
				),
				crossing(
					"cache-root-third",
					OUTDOOR_SCOPE,
					third,
					rectangleAperture(0.25, -0.8, 0.95, 0.8),
				),
				crossing(
					"cache-root-fourth",
					OUTDOOR_SCOPE,
					fourth,
					rectangleAperture(-0.8, -0.6, 0.8, 0.6),
				),
				crossing("cache-first-middle", first, middle, fullAperture),
				crossing("cache-second-middle", second, middle, fullAperture),
				crossing("cache-third-middle", third, middle, fullAperture),
				crossing("cache-fourth-middle", fourth, middle, fullAperture),
				crossing("cache-middle-leaf", middle, leaf, fullAperture),
			],
			90_001,
		);

		const output = assertDifferential(fixture);
		expect(output.cacheHitCount).toBeGreaterThan(0);
	});
});

function linearTriangleCase(
	inherited: readonly Vec2[],
	aperture: readonly Vec2[],
	ordinal: number,
): DifferentialCase {
	const middle = envCellScope(`seed-${ordinal}-middle`);
	const leaf = envCellScope(`seed-${ordinal}-leaf`);
	const crossings = [
		crossing(
			`seed-${ordinal}-root-middle`,
			OUTDOOR_SCOPE,
			middle,
			triangleAperture(inherited),
		),
		crossing(
			`seed-${ordinal}-middle-leaf`,
			middle,
			leaf,
			triangleAperture(aperture),
		),
	];
	return {
		input: planInput(OUTDOOR_SCOPE),
		label: `seed=0x${PORTAL_WINDOW_GEOMETRY_SEED.toString(16)} case=${ordinal} family=retained-linear`,
		topology: topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, `seed-${ordinal}-middle`),
				topologyScope(leaf, `seed-${ordinal}-leaf`),
			],
			crossings,
			ordinal + 1,
		),
	};
}

function expandedCase(
	family: ExpandedFamily,
	ordinal: number,
	random: () => number,
): DifferentialCase {
	const key = `${family}-${ordinal}`;
	const revision = 10_000 + EXPANDED_FAMILIES.indexOf(family) * 1_000 + ordinal;
	const cameraScaleX = 0.8 + random() * 0.35;
	const cameraScaleY = 0.8 + random() * 0.35;
	const cameraTranslateX = (random() - 0.5) * 0.12;
	const cameraTranslateY = (random() - 0.5) * 0.12;
	const ordinaryInput = planInput(OUTDOOR_SCOPE, {
		clipFromAnchor: affineClipMatrix(
			cameraScaleX,
			cameraScaleY,
			cameraTranslateX,
			cameraTranslateY,
		),
	});

	switch (family) {
		case "one-hop": {
			const child = envCellScope(`${key}-child`);
			return differentialCase(
				family,
				ordinal,
				ordinaryInput,
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, key)],
				[
					crossing(
						`${key}-door`,
						OUTDOOR_SCOPE,
						child,
						randomTriangleAperture(random),
					),
				],
				revision,
			);
		}
		case "fan-in": {
			const left = envCellScope(`${key}-left`);
			const right = envCellScope(`${key}-right`);
			const leaf = envCellScope(`${key}-leaf`);
			const seam = (random() - 0.5) * 0.3;
			const overlap = 0.08 + random() * 0.12;
			return differentialCase(
				family,
				ordinal,
				ordinaryInput,
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(left, `${key}-left`),
					topologyScope(right, `${key}-right`),
					topologyScope(leaf, `${key}-leaf`),
				],
				[
					crossing(
						`${key}-root-left`,
						OUTDOOR_SCOPE,
						left,
						rectangleAperture(-0.92, -0.86, seam + overlap, 0.86),
					),
					crossing(
						`${key}-root-right`,
						OUTDOOR_SCOPE,
						right,
						rectangleAperture(seam - overlap, -0.86, 0.92, 0.86),
					),
					crossing(
						`${key}-left-leaf`,
						left,
						leaf,
						rectangleAperture(-0.88, -0.72, 0.7, 0.72),
					),
					crossing(
						`${key}-right-leaf`,
						right,
						leaf,
						rectangleAperture(-0.7, -0.72, 0.88, 0.72),
					),
				],
				revision,
			);
		}
		case "multipart": {
			const middle = envCellScope(`${key}-middle`);
			const leaf = envCellScope(`${key}-leaf`);
			return differentialCase(
				family,
				ordinal,
				ordinaryInput,
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(middle, `${key}-middle`),
					topologyScope(leaf, `${key}-leaf`),
				],
				[
					crossing(
						`${key}-split`,
						OUTDOOR_SCOPE,
						middle,
						randomMultipartAperture(random),
					),
					crossing(
						`${key}-leaf`,
						middle,
						leaf,
						rectangleAperture(-0.82, -0.78, 0.82, 0.78),
					),
				],
				revision,
			);
		}
		case "cycle-and-return": {
			const first = envCellScope(`${key}-first`);
			const second = envCellScope(`${key}-second`);
			const third = envCellScope(`${key}-third`);
			return differentialCase(
				family,
				ordinal,
				ordinaryInput,
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(first, `${key}-first`),
					topologyScope(second, `${key}-second`),
					topologyScope(third, `${key}-third`),
				],
				[
					crossing(
						`${key}-root-first`,
						OUTDOOR_SCOPE,
						first,
						rectangleAperture(-0.9, -0.85, 0.9, 0.85),
					),
					crossing(
						`${key}-first-second`,
						first,
						second,
						rectangleAperture(-0.8, -0.75, 0.8, 0.75),
						{
							reciprocalCrossingId: `portal-crossing:${key}-second-first`,
						},
					),
					crossing(
						`${key}-second-first`,
						second,
						first,
						rectangleAperture(-0.8, -0.75, 0.8, 0.75),
						{
							reciprocalCrossingId: `portal-crossing:${key}-first-second`,
						},
					),
					crossing(
						`${key}-second-third`,
						second,
						third,
						rectangleAperture(-0.7, -0.65, 0.7, 0.65),
					),
					crossing(
						`${key}-third-first`,
						third,
						first,
						rectangleAperture(-0.6, -0.55, 0.6, 0.55),
					),
				],
				revision,
			);
		}
		case "near-contact": {
			const child = envCellScope(`${key}-child`);
			const contactZ = [0.499_999, 0.5, 0.500_001, 0.75][ordinal % 4]!;
			return differentialCase(
				family,
				ordinal,
				planInput(OUTDOOR_SCOPE),
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, key)],
				[
					crossing(
						`${key}-contact`,
						OUTDOOR_SCOPE,
						child,
						triangleAperture(
							[
								new Vec2(-0.72 - random() * 0.1, -0.55),
								new Vec2(0.72 + random() * 0.1, -0.55),
								new Vec2((random() - 0.5) * 0.2, 0.78),
							],
							contactZ,
						),
					),
				],
				revision,
			);
		}
		case "footprint": {
			const visible = envCellScope(`${key}-visible`);
			const rejected = envCellScope(`${key}-rejected`);
			const tinyHalfExtent = 0.001 + random() * 0.002;
			return differentialCase(
				family,
				ordinal,
				planInput(OUTDOOR_SCOPE, {
					portalFootprint: {
						drawingBuffer: { height: 256, width: 256 },
						minimumPixelArea: 2 + (ordinal % 7),
					},
				}),
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(visible, `${key}-visible`),
					topologyScope(rejected, `${key}-rejected`),
				],
				[
					crossing(
						`${key}-visible`,
						OUTDOOR_SCOPE,
						visible,
						rectangleAperture(-0.7, -0.7, 0.7, 0.7),
					),
					crossing(
						`${key}-rejected`,
						OUTDOOR_SCOPE,
						rejected,
						rectangleAperture(
							0.2 - tinyHalfExtent,
							0.2 - tinyHalfExtent,
							0.2 + tinyHalfExtent,
							0.2 + tinyHalfExtent,
						),
					),
				],
				revision,
			);
		}
		case "cross-landblock": {
			const child = envCellScope(`${key}-child`, EAST_LANDBLOCK_ID);
			return differentialCase(
				family,
				ordinal,
				planInput(OUTDOOR_SCOPE, {
					clipFromAnchor: affineClipMatrix(1, 1, -192, 0),
					nearClipVolume: createCameraNearClipVolume(
						{ fov: 90, near: 0.5 },
						{
							position: new Vec3(192, 0, 1),
							rotation: Quat.identity(),
						},
						1,
					),
				}),
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, key)],
				[
					crossing(
						`${key}-east`,
						OUTDOOR_SCOPE,
						child,
						randomTriangleAperture(random),
						{ landblockId: EAST_LANDBLOCK_ID },
					),
				],
				revision,
			);
		}
	}
}

function differentialCase(
	family: ExpandedFamily,
	ordinal: number,
	input: PortalScopeWindowReferenceInput,
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossingInput[],
	revision: number,
): DifferentialCase {
	const topologySummary = crossings
		.map(
			({ id, source, target }) =>
				`${id}:${scopeIdentity(source)}>${scopeIdentity(target)}`,
		)
		.join(",");
	return {
		input,
		label: [
			`seed=0x${EXPANDED_TOPOLOGY_SEED.toString(16)}`,
			`case=${ordinal}`,
			`family=${family}`,
			`anchor=${input.anchorCoordinates.x},${input.anchorCoordinates.y}`,
			`minimumPixelArea=${input.portalFootprint.minimumPixelArea}`,
			`clip=[${input.clipFromAnchor.m11},${input.clipFromAnchor.m22},${input.clipFromAnchor.m41},${input.clipFromAnchor.m42}]`,
			`near=[${input.nearClipVolume.corners.map(({ x, y, z }) => `${x},${y},${z}`).join(";")}]`,
			`topology=[${topologySummary}]`,
		].join(" "),
		topology: topology(scopes, crossings, revision),
	};
}

function mutateCase(
	fixture: DifferentialCase,
	mutation: Metamorphism,
): DifferentialCase {
	const reorderStorage = mutation !== "triangle-order";
	const reorderTriangles = mutation !== "storage-order";
	const crossings = fixture.topology.crossings.map((edge, ordinal) =>
		reorderTriangles ? reorderCrossingTriangles(edge, ordinal) : edge,
	);
	if (reorderStorage) crossings.reverse();
	const scopes = reorderStorage
		? [...fixture.topology.scopes].reverse()
		: fixture.topology.scopes;
	return {
		input: fixture.input,
		label: `${fixture.label} metamorphism=${mutation}`,
		topology: topology(scopes, crossings, fixture.topology.revision),
	};
}

function reorderCrossingTriangles(
	edge: ScenePortalCrossingInput,
	ordinal: number,
): ScenePortalCrossingInput {
	const sourceAperture = reorderSceneAperture(edge.sourceAperture, ordinal);
	return {
		...edge,
		sourceAperture,
		visibilityAperture:
			edge.visibilityAperture === edge.sourceAperture
				? sourceAperture
				: reorderSceneAperture(edge.visibilityAperture, ordinal + 1),
	};
}

function reorderSceneAperture(
	aperture: ScenePortalCrossingInput["sourceAperture"],
	ordinal: number,
): ScenePortalCrossingInput["sourceAperture"] {
	const triangles = Array.from(
		{ length: aperture.indices.length / 3 },
		(_, triangle) => {
			const offset = triangle * 3;
			const indices = [
				aperture.indices[offset]!,
				aperture.indices[offset + 1]!,
				aperture.indices[offset + 2]!,
			];
			const rotation = (ordinal + triangle + 1) % 3;
			return [
				indices[rotation]!,
				indices[(rotation + 1) % 3]!,
				indices[(rotation + 2) % 3]!,
			] as const;
		},
	).reverse();
	return {
		...aperture,
		indices: new Uint32Array(triangles.flat()),
	};
}

function assertDifferential(fixture: DifferentialCase): DifferentialOutput {
	const immutableResult = cullPortalScopeWindowsReference(
		fixture.topology,
		fixture.input,
	);
	const culler = new PortalScopeWindowCuller(cullerCapacity());
	const arenaFrame = culler.cull(fixture.topology, fixture.input);
	expect(arenaFrame.status, fixture.label).toBe("complete");
	const expected = immutableResult.selections
		.map(({ scope, window }) => ({
			scope: scopeIdentity(scope),
			window: immutableWindowSnapshot(window),
		}))
		.sort(compareScopeWindows);
	const actual = arenaWindowSnapshot(arenaFrame);
	assertEquivalentWindows(actual, expected, fixture.label);
	for (let ordinal = 0; ordinal < arenaFrame.selectedScopeCount; ordinal += 1) {
		expect(
			arenaFrame.selectedScopeOrdinal(
				scopeKey(arenaFrame.selectedScope(ordinal)),
			),
			`${fixture.label} selected-scope ordinal`,
		).toBe(ordinal);
	}
	const selectedScopeIdentities = new Set(expected.map(({ scope }) => scope));
	const expectedCrossingIds = fixture.topology.crossings
		.filter(
			({ source, target }) =>
				selectedScopeIdentities.has(scopeIdentity(source)) &&
				selectedScopeIdentities.has(scopeIdentity(target)),
		)
		.map(({ id }) => id)
		.sort();
	const actualCrossingIds = Array.from(
		{ length: arenaFrame.selectedCrossingCount },
		(_, ordinal) => arenaFrame.selectedCrossing(ordinal).id,
	);
	expect(actualCrossingIds, `${fixture.label} selected crossings`).toEqual(
		expectedCrossingIds,
	);
	expect(
		arenaFrame.trace.selectedCrossingInputCount,
		`${fixture.label} selected-crossing inputs`,
	).toBeLessThanOrEqual(fixture.topology.crossings.length);
	expect(
		arenaFrame.trace.nearClipClassificationCount,
		`${fixture.label} near-clip classifications`,
	).toBeLessThanOrEqual(arenaFrame.trace.outgoingCrossingInputCount);
	expect(
		arenaFrame.trace.facingTestCount,
		`${fixture.label} facing tests`,
	).toBeLessThanOrEqual(arenaFrame.trace.nearClipClassificationCount);
	expect(
		arenaFrame.trace.routeProjectionCount,
		`${fixture.label} route projections`,
	).toBeLessThanOrEqual(arenaFrame.trace.nearClipClassificationCount);
	expect(
		arenaFrame.trace.ordinaryRouteProjectionCount +
			arenaFrame.trace.nearPlaneRouteProjectionCount,
		`${fixture.label} classified route projections`,
	).toBe(arenaFrame.trace.routeProjectionCount);
	if (arenaFrame.trace.selectedCrossingMarkerWordInputCount > 0) {
		expect(
			arenaFrame.trace.selectedCrossingInputCount +
				arenaFrame.trace.selectedCrossingMarkerWordInputCount,
			`${fixture.label} selected-crossing sparse materialization`,
		).toBeLessThan(fixture.topology.crossings.length);
	}
	return {
		arena: actual,
		cacheHitCount: arenaFrame.trace.projectionCacheHitCount,
		completedDepth: arenaFrame.completedDepth,
		immutableAdmittedStateCount: immutableResult.diagnostics.admittedStateCount,
		immutableNearPlaneSeedCount: immutableResult.diagnostics.nearPlaneSeedCount,
		immutableRejectedFootprintCount:
			immutableResult.diagnostics.rejectedPortalFootprintCount,
		immutable: expected,
	};
}

function assertFamilyEvidence(
	family: ExpandedFamily,
	ordinal: number,
	output: DifferentialOutput,
	label: string,
): void {
	switch (family) {
		case "one-hop":
		case "cross-landblock":
			expect(output.immutable.length, `${label} branch=selected-child`).toBe(2);
			break;
		case "fan-in":
			expect(
				output.immutableAdmittedStateCount,
				`${label} branch=accumulated-fan-in`,
			).toBeGreaterThan(output.immutable.length);
			break;
		case "multipart":
			expect(
				output.immutable.some(({ window }) => window.length === 2),
				`${label} branch=multipart-window`,
			).toBe(true);
			break;
		case "cycle-and-return":
			expect(output.immutable.length, `${label} branch=reachable-cycle`).toBe(
				4,
			);
			expect(
				output.completedDepth,
				`${label} branch=cycle-frontier-depth`,
			).toBeGreaterThanOrEqual(3);
			break;
		case "near-contact":
			if (ordinal % 4 !== 0) {
				expect(
					output.immutableNearPlaneSeedCount,
					`${label} branch=near-volume-seed`,
				).toBeGreaterThan(0);
			}
			break;
		case "footprint":
			expect(
				output.immutableRejectedFootprintCount,
				`${label} branch=footprint-rejection`,
			).toBeGreaterThan(0);
			expect(output.immutable.length, `${label} branch=visible-sibling`).toBe(
				2,
			);
			break;
	}
}

function assertEquivalentWindows(
	actual: readonly ScopeWindowSnapshot[],
	expected: readonly ScopeWindowSnapshot[],
	label: string,
): void {
	expect(quantizedSnapshot(actual), label).toEqual(quantizedSnapshot(expected));
	assertVerticesWithinTolerance(actual, expected, label);
}

function cullerCapacity(): PortalScopeWindowCullerCapacity {
	return {
		maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
		maximumProjectionPrimitiveCount: 500_000,
		maximumWorkItemCount: 64,
		windowArena: {
			maximumApertureVertexCount: 32,
			maximumFragmentCount: 512,
			maximumTemporaryFragmentCount: 64,
			maximumTemporaryVertexCount: 8_192,
			maximumVertexCount: 4_096,
			maximumVerticesPerFragment: 64,
			maximumWindowCount: 128,
		},
	};
}

function arenaWindowSnapshot(
	frame: ReturnType<PortalScopeWindowCuller["cull"]>,
): readonly ScopeWindowSnapshot[] {
	return Array.from({ length: frame.selectedScopeCount }, (_, ordinal) => ({
		scope: scopeIdentity(frame.selectedScope(ordinal)),
		window: Array.from(
			{ length: frame.selectedFragmentCount(ordinal) },
			(_, fragment) =>
				Array.from(
					{
						length: frame.selectedFragmentVertexCount(ordinal, fragment),
					},
					(_, vertex) =>
						[
							frame.selectedVertexX(ordinal, fragment, vertex),
							frame.selectedVertexY(ordinal, fragment, vertex),
						] as const,
				),
		),
	})).sort(compareScopeWindows);
}

function immutableWindowSnapshot(
	window: PortalViewWindow,
): ScopeWindowSnapshot["window"] {
	return window.fragments.map(({ vertices }) =>
		vertices.map(({ x, y }) => [x, y] as const),
	);
}

function quantizedSnapshot(
	windows: readonly ScopeWindowSnapshot[],
): readonly ScopeWindowSnapshot[] {
	return windows.map(({ scope, window }) => ({
		scope,
		window: window.map((fragment) =>
			fragment.map(
				([x, y]) =>
					[
						Math.round(x / PORTAL_WINDOW_NDC_EPSILON),
						Math.round(y / PORTAL_WINDOW_NDC_EPSILON),
					] as const,
			),
		),
	}));
}

function assertVerticesWithinTolerance(
	actual: readonly ScopeWindowSnapshot[],
	expected: readonly ScopeWindowSnapshot[],
	label: string,
): void {
	for (let scope = 0; scope < expected.length; scope += 1) {
		for (
			let fragment = 0;
			fragment < expected[scope]!.window.length;
			fragment += 1
		) {
			for (
				let vertex = 0;
				vertex < expected[scope]!.window[fragment]!.length;
				vertex += 1
			) {
				const expectedVertex = expected[scope]!.window[fragment]![vertex]!;
				const actualVertex = actual[scope]!.window[fragment]![vertex]!;
				expect(
					Math.abs(actualVertex[0] - expectedVertex[0]),
					`${label} scope=${scope} fragment=${fragment} vertex=${vertex} axis=x`,
				).toBeLessThanOrEqual(PORTAL_WINDOW_NDC_EPSILON);
				expect(
					Math.abs(actualVertex[1] - expectedVertex[1]),
					`${label} scope=${scope} fragment=${fragment} vertex=${vertex} axis=y`,
				).toBeLessThanOrEqual(PORTAL_WINDOW_NDC_EPSILON);
			}
		}
	}
}

function compareScopeWindows(
	left: ScopeWindowSnapshot,
	right: ScopeWindowSnapshot,
): number {
	return left.scope.localeCompare(right.scope);
}

function planInput(
	rootScope: SceneScope,
	overrides: Partial<PortalScopeWindowReferenceInput> = {},
): PortalScopeWindowReferenceInput {
	return {
		anchorCoordinates: getLandblockCoordinates(ANCHOR_LANDBLOCK_ID),
		clipFromAnchor: Mat4.identity(),
		nearClipVolume: createCameraNearClipVolume(
			{ fov: 90, near: 0.5 },
			{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
			1,
		),
		portalFootprint: {
			drawingBuffer: { height: 256, width: 256 },
			minimumPixelArea: 0,
		},
		rootScope,
		safetyWorkItemLimit: 10_000,
		...overrides,
	};
}

function affineClipMatrix(
	scaleX: number,
	scaleY: number,
	translateX: number,
	translateY: number,
): Mat4 {
	return new Mat4(
		scaleX,
		0,
		0,
		0,
		0,
		scaleY,
		0,
		0,
		0,
		0,
		1,
		0,
		translateX,
		translateY,
		0,
		1,
	);
}

function topology(
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossingInput[],
	revision: number,
): SceneTopologyView {
	const outgoingByScope = new Map<string, ScenePortalCrossingInput[]>();
	for (const edge of crossings) {
		const key = scopeIdentity(edge.source);
		const outgoing = outgoingByScope.get(key) ?? [];
		outgoing.push(edge);
		outgoingByScope.set(key, outgoing);
	}
	return {
		crossings,
		outgoing: (scope) => outgoingByScope.get(scopeIdentity(scope)) ?? [],
		revision,
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

function envCellScope(
	id: string,
	landblockId = ANCHOR_LANDBLOCK_ID,
): Extract<SceneScope, { kind: "env-cell" }> {
	return {
		envCellId: id,
		kind: "env-cell",
		landblockId,
	};
}

function crossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	aperture: PlanarAperture,
	options: {
		readonly landblockId?: string;
		readonly reciprocalCrossingId?: PortalCrossingId | null;
	} = {},
): ScenePortalCrossingInput {
	const sceneAperture = scenePortalAperture(
		`portal-aperture:${id}`,
		aperture,
		options.landblockId ?? ANCHOR_LANDBLOCK_ID,
	);
	return {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
		maskDepthPolicy: "allow-equal-depth",
		junctionGroupId: null,
		reciprocalCrossingId: options.reciprocalCrossingId ?? null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "differential-fixture",
		},
		target,
		visibilityAperture: sceneAperture,
	};
}

function scenePortalAperture(
	id: `portal-aperture:${string}`,
	aperture: PlanarAperture,
	landblockId: string,
): ScenePortalCrossingInput["sourceAperture"] {
	return {
		id,
		indices: aperture.indices,
		landblockBounds: apertureBounds(aperture),
		landblockId,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
}

function triangleAperture(vertices: readonly Vec2[], z = 0): PlanarAperture {
	if (vertices.length !== 3) {
		throw new Error("Differential triangle fixture requires three vertices.");
	}
	return {
		indices: new Uint32Array([0, 1, 2]),
		plane: { d: -z, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			vertices[0]!.x,
			vertices[0]!.y,
			z,
			vertices[1]!.x,
			vertices[1]!.y,
			z,
			vertices[2]!.x,
			vertices[2]!.y,
			z,
		]),
	};
}

function randomTriangleAperture(random: () => number): PlanarAperture {
	for (;;) {
		const vertices = [
			new Vec2(random() * 1.6 - 0.8, random() * 1.6 - 0.8),
			new Vec2(random() * 1.6 - 0.8, random() * 1.6 - 0.8),
			new Vec2(random() * 1.6 - 0.8, random() * 1.6 - 0.8),
		];
		if (Math.abs(signedArea(vertices)) > 0.08) {
			return triangleAperture(vertices);
		}
	}
}

function randomMultipartAperture(random: () => number): PlanarAperture {
	const centerOffset = (random() - 0.5) * 0.12;
	const lower = -0.82 + random() * 0.08;
	const upper = 0.62 + random() * 0.16;
	return {
		indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
		plane: { d: 0, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			-0.92,
			lower,
			0,
			-0.18,
			lower,
			0,
			-0.55 + centerOffset,
			upper,
			0,
			0.18,
			lower,
			0,
			0.92,
			lower,
			0,
			0.55 + centerOffset,
			upper,
			0,
		]),
	};
}

function rectangleAperture(
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

function signedArea(vertices: readonly Vec2[]): number {
	return (
		(vertices[0]!.x * (vertices[1]!.y - vertices[2]!.y) +
			vertices[1]!.x * (vertices[2]!.y - vertices[0]!.y) +
			vertices[2]!.x * (vertices[0]!.y - vertices[1]!.y)) /
		2
	);
}

function apertureBounds(aperture: PlanarAperture): AABB3 {
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

function scopeIdentity(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? "outdoor"
		: `${scope.landblockId}/${scope.envCellId}`;
}
