import { scopeKey } from "../scene/scope";
import { describe, expect, it } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	PortalCrossingId,
	ScenePortalCrossing,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	type PlanarAperture,
} from "../scene/planar-aperture";
import {
	createFullPortalViewWindow,
	type PortalViewWindow,
} from "./portal-view-window";
import {
	cullPortalScopeWindowsReference,
	type PortalScopeWindowReferenceInput,
} from "./portal-scope-window-reference";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
} from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
	PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
	PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
	PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
	PortalPropagationStreamArena,
} from "./portal-crossing-triangle-stream";
import { PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS } from "./portal-envelope-sampling-glsl";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PortalScopeWindowCuller } from "./portal-scope-window-culler";
import { createCameraNearClipVolume } from "./portal-near-plane";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import { compilePortalScopeAtlasWebGLCalls } from "./portal-scope-atlas-command-model";
import {
	PORTAL_QUAD_MODE_MAX_REDUCE,
	PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP,
	PortalScopeAtlasPlanner,
	portalScopeAtlasMaximumQuadCount,
} from "./portal-scope-atlas-planner";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";

const LANDBLOCK_ID = "0x0001ffff";
const OUTDOOR_SCOPE = { kind: "outdoor" } as const satisfies SceneScope;
const DEFAULT_SAFETY_WORK_ITEM_LIMIT = 10_000;
const TEST_ATLAS_MAXIMUM_PATH_DEPTH = 4;
const TEST_ATLAS_PACKING_CHILD_COUNT = 24;
const TEST_ATLAS_PACKING_EXTENT = 400;
const TEST_ATLAS_UNSAFE_PIXEL_EXTENT = 100_000_000;
const TEST_ATLAS_UNSAFE_TILE_EXTENT = 20_000_000;
const TEST_UINT32_OVERFLOW = 0x1_0000_0000;

describe("portal scope-window culler bridge", () => {
	it("matches the immutable planner coverage through a cyclic topology", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("out-middle", OUTDOOR_SCOPE, middle, {
					aperture: rectangle(-0.9, -0.9, -0.1, 0.9),
				}),
				crossing("middle-leaf", middle, leaf, {
					aperture: rectangle(-0.8, -0.8, -0.2, 0.8),
				}),
				crossing("leaf-out", leaf, OUTDOOR_SCOPE, {
					aperture: rectangle(-0.7, -0.7, -0.3, 0.7),
				}),
			],
		);
		const input = planInput(OUTDOOR_SCOPE);
		const expected = cullPortalScopeWindowsReference(graph, input).selections;
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 64,
			windowArena: scopeWindowArenaCapacity(),
		});

		const actual = culler.cull(graph, input);

		expect(actual.status).toBe("complete");
		expect(scopeWindowSnapshot(actual)).toEqual(
			expected
				.map(({ scope, window }) => ({
					scope: scopeIdentity(scope),
					window: windowSnapshot(window),
				}))
				.sort((left, right) => left.scope.localeCompare(right.scope)),
		);
		expect(actual.trace.queueHighWaterCount).toBeGreaterThan(0);
		expect(actual.trace.arenaCapacityBytes).toBeGreaterThan(0);
	});

	it("encloses near-plane and multipart exact coverage in rectangles", () => {
		const nearChild = envCellScope("near-child");
		const splitChild = envCellScope("split-child");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(nearChild, "near-child"),
				topologyScope(splitChild, "split-child"),
			],
			[
				crossing("near", OUTDOOR_SCOPE, nearChild, {
					aperture: rectangle(-0.8, -0.8, 0.8, 0.8, 0.75),
				}),
				crossing("split", OUTDOOR_SCOPE, splitChild, {
					aperture: splitAperture(),
				}),
			],
		);
		const input = planInput(OUTDOOR_SCOPE);
		const expected = cullPortalScopeWindowsReference(graph, input).selections;
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 64,
			windowArena: scopeWindowArenaCapacity(),
		});

		const actual = culler.cull(graph, input);

		for (const reference of expected) {
			const ordinal = actual.selectedScopeOrdinal(scopeKey(reference.scope));
			if (ordinal === null)
				throw new Error("Reference scope missing from rectangle traversal.");
			const left = actual.selectedMinimumNdcX(ordinal),
				bottom = actual.selectedMinimumNdcY(ordinal);
			const right = actual.selectedMaximumNdcX(ordinal),
				top = actual.selectedMaximumNdcY(ordinal);
			for (const fragment of reference.window.fragments)
				for (const { x, y } of fragment.vertices) {
					expect(x).toBeGreaterThanOrEqual(left - 1e-6);
					expect(x).toBeLessThanOrEqual(right + 1e-6);
					expect(y).toBeGreaterThanOrEqual(bottom - 1e-6);
					expect(y).toBeLessThanOrEqual(top + 1e-6);
				}
		}
		let splitOrdinal = -1;
		for (let ordinal = 0; ordinal < actual.selectedScopeCount; ordinal += 1) {
			if (
				scopeIdentity(actual.selectedScope(ordinal)).endsWith("/split-child")
			) {
				splitOrdinal = ordinal;
				break;
			}
		}
		expect(splitOrdinal).toBeGreaterThanOrEqual(0);
	});

	it("declines a whole fan-out frontier when fixed queue capacity is exhausted", () => {
		const left = envCellScope("left");
		const right = envCellScope("right");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(left, "left"),
				topologyScope(right, "right"),
			],
			[
				crossing("left", OUTDOOR_SCOPE, left),
				crossing("right", OUTDOOR_SCOPE, right),
			],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 2,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(0);
		expect(frame.declinedDepth).toBe(1);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(1);
		expect(scopeWindowSnapshot(frame)).toEqual([
			{
				scope: "outdoor",
				window: windowSnapshot(createFullPortalViewWindow()),
			},
		]);
	});

	it("reports the first unexpanded frontier when fixed traversal depth is reached", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("middle", OUTDOOR_SCOPE, middle),
				crossing("leaf", middle, leaf),
			],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: 1,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(1);
		expect(frame.declinedDepth).toBe(2);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(0);
		expect(scopeWindowSnapshot(frame).map(({ scope }) => scope)).toEqual([
			scopeIdentity(middle),
			"outdoor",
		]);
	});

	it("rejects rectangle storage too small for the work queue", () => {
		expect(
			() =>
				new PortalScopeWindowCuller({
					maximumDepth: 8,
					maximumProjectionPrimitiveCount: 100_000,
					maximumWorkItemCount: 8,
					windowArena: { ...scopeWindowArenaCapacity(), maximumWindowCount: 1 },
				}),
		).toThrow("windows for the work-item budget");
	});

	it("completes cell traversal beyond the independent GPU propagation limit", () => {
		const count = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth + 8;
		const cells = Array.from({ length: count }, (_, i) =>
			envCellScope(`long-${i}`),
		);
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				...cells.map((s, i) => topologyScope(s, `long-${i}`)),
			],
			cells.map((cell, i) =>
				crossing(`long-${i}`, i === 0 ? OUTDOOR_SCOPE : cells[i - 1]!, cell),
			),
		);
		const culler = new PortalScopeWindowCuller(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
		);
		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));
		expect(frame.status).toBe("complete");
		expect(frame.selectedScopeCount).toBe(count + 1);
		expect(frame.completedDepth).toBeGreaterThan(
			PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
		);
	});

	it("declines the frontier before a projection exceeds its atomic primitive budget", () => {
		const child = envCellScope("child");
		const maximumProjectionPrimitiveCount = 1;
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(0);
		expect(frame.declinedDepth).toBe(1);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(1);
		expect(frame.selectedScopeCount).toBe(1);
		expect(scopeIdentity(frame.selectedScope(0))).toBe("outdoor");
		expect(frame.trace.projectionPrimitiveCount).toBeGreaterThan(
			maximumProjectionPrimitiveCount,
		);
	});

	it("reuses its frame view and arena until topology actually changes", () => {
		const firstGraph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);
		const secondGraph = {
			...topology([topologyScope(OUTDOOR_SCOPE, null)], []),
			revision: firstGraph.revision,
		};
		const capacity = {
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		};
		const culler = new PortalScopeWindowCuller(capacity);
		const firstFrame = culler.cull(firstGraph, planInput(OUTDOOR_SCOPE));
		const trace = firstFrame.trace;
		const secondFrame = culler.cull(firstGraph, planInput(OUTDOOR_SCOPE));

		expect(secondFrame).toBe(firstFrame);
		expect(secondFrame.trace).toBe(trace);
		expect(secondFrame.trace.topologyBuildCount).toBe(1);
		expect(secondFrame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(
			0,
		);
		expect(secondFrame.trace.portalOwnedFrameHeapRecordCreationCount).toBe(0);
		expect(secondFrame.trace.arenaGrowthCount).toBe(0);

		const changedFrame = culler.cull(secondGraph, planInput(OUTDOOR_SCOPE));
		expect(changedFrame.trace.topologyBuildCount).toBe(2);
	});
});

describe("portal scope-atlas planning", () => {
	it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid GPU propagation depth %s",
		(depth) => {
			expect(
				() =>
					new PortalScopeAtlasPlanner(
						PORTAL_RENDER_CAPACITY_POLICY.culler,
						depth,
					),
			).toThrow(
				"Portal GPU propagation depth must be a nonnegative safe integer.",
			);
		},
	);
	it("accepts zero GPU propagation rounds", () => {
		expect(
			() =>
				new PortalScopeAtlasPlanner(PORTAL_RENDER_CAPACITY_POLICY.culler, 0),
		).not.toThrow();
	});

	it("packs conservative tile bounds and derives clip transforms without heap records", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[
				crossing("child", OUTDOOR_SCOPE, child, {
					aperture: rectangle(-0.5, -0.5, 0.5, 0.5),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 100, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("complete");
		expect(frame.tileCount).toBe(2);
		expect(frame.packedWidth).toBe(150);
		expect(frame.packedHeight).toBe(100);
		expect(frame.tileX(0)).toBe(0);
		expect(frame.tileY(0)).toBe(0);
		expect(frame.tileWidth(0)).toBe(100);
		expect(frame.tileHeight(0)).toBe(100);
		expect(frame.tileX(1)).toBe(100);
		expect(frame.tileY(1)).toBe(0);
		expect(frame.tileWidth(1)).toBe(50);
		expect(frame.tileHeight(1)).toBe(50);
		expect(frame.tileClipScaleX(1)).toBe(2);
		expect(frame.tileClipScaleY(1)).toBe(2);
		expect(frame.tileClipOffsetX(1)).toBe(0);
		expect(frame.tileClipOffsetY(1)).toBe(0);
		expect(frame.tileScreenX(1)).toBe(25);
		expect(frame.tileScreenY(1)).toBe(25);
		expect(frame.tileOrdinalForRenderScopeKey("outdoor")).toBe(0);
		expect(frame.tileOrdinalForRenderScopeKey(child.envCellId)).toBe(1);
		expect(() => frame.tileOrdinalForRenderScopeKey("missing")).toThrow(
			"has no selected atlas tile",
		);
		expect(frame.trace).toMatchObject({
			arenaGrowthCount: 0,
			atlasPackedExtentPixelCount: 15_000,
			atlasPixelCapacity: 20_000,
			frontierRetreatCount: 0,
			packingAttemptCount: 1,
			portalOwnedFrameHeapRecordCreationCount: 0,
			tilePixelCount: 12_500,
			tilePlacementAttemptCount: 2,
		});
		expect(frame.trace.arenaCapacityBytes).toBeGreaterThan(0);
	});

	it("collapses selected depth-continuous cells into one render-domain tile", () => {
		const root = envCellScope("island-root");
		const neighbor = envCellScope("island-neighbor");
		const destination = envCellScope("island-destination");
		const graph = topology(
			[
				topologyScope(root, "shared"),
				topologyScope(neighbor, "shared"),
				topologyScope(destination, "destination"),
			],
			[
				crossing("internal-seam", root, neighbor, {
					aperture: rectangle(-0.5, -0.5, 0.5, 0.5),
					spatialRelationship: {
						kind: "indoor-depth-continuous",
						reciprocalApertureId: "portal-aperture:internal-seam/reciprocal",
					},
				}),
				crossing("island-exit", neighbor, destination, {
					aperture: rectangle(-0.25, -0.25, 0.25, 0.25),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(root);

		const frame = planner.plan(graph, input, {
			atlas: { height: 100, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.selectedScopeCount).toBe(3);
		expect(frame.visibility.selectedRenderDomainCount).toBe(2);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.visibility.selectedCrossing(0).id).toBe(
			"portal-crossing:island-exit",
		);
		expect(frame.visibility.selectedCrossingSourceRenderDomainOrdinal(0)).toBe(
			0,
		);
		expect(frame.visibility.selectedCrossingTargetRenderDomainOrdinal(0)).toBe(
			1,
		);
		expect(frame.tileCount).toBe(2);
		expect(frame.tileOrdinalForRenderScopeKey(root.envCellId)).toBe(0);
		expect(frame.tileOrdinalForRenderScopeKey(neighbor.envCellId)).toBe(0);
		expect(frame.tileOrdinalForRenderScopeKey(destination.envCellId)).toBe(1);
		expect(frame.commands).toMatchObject({
			crossingInstancePreparationCount: 1,
			opaqueCompositeInstanceCount: 2,
			scopeEnvelopeReductionInstanceCount: 2,
			traversalDepth: 1,
		});
	});

	it("retreats complete frontiers until fixed atlas capacity fits without re-culling", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const middleMember = envCellScope("middle-member");
		const leafMember = envCellScope("leaf-member");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
				topologyScope(middleMember, "middle"),
				topologyScope(leafMember, "leaf"),
			],
			[
				crossing("root-middle", OUTDOOR_SCOPE, middle, {
					aperture: rectangle(-1, -0.5, 1, 0.5),
				}),
				crossing("middle-leaf", middle, leaf, {
					aperture: rectangle(-1, -0.25, 1, 0.25, 0.75),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 150, width: 100 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.declinedDepth).toBe(2);
		expect(frame.visibility.selectedScopeCount).toBe(2);
		expect(frame.tileOrdinalForRenderScopeKey(middleMember.envCellId)).toBe(
			frame.tileOrdinalForRenderScopeKey(middle.envCellId),
		);
		expect(() =>
			frame.tileOrdinalForRenderScopeKey(leafMember.envCellId),
		).toThrow("has no selected atlas tile");
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.visibility.selectedCrossing(0).id).toBe(
			"portal-crossing:root-middle",
		);
		expect(frame.visibility.selectedCrossingNearPlaneStraddle(0)).toBe(false);
		expect(() => frame.tileOrdinalForRenderScopeKey(leaf.envCellId)).toThrow(
			"has no selected atlas tile",
		);
		expect(frame.trace.frontierRetreatCount).toBe(2);
		expect(frame.trace.atlasCapacityRetreatCount).toBe(2);
		expect(frame.trace.arrivalStateCapacityRetreatCount).toBe(0);
		expect(frame.trace.packingAttemptCount).toBe(3);
		expect(frame.commands).toEqual({
			crossingInstancePreparationCount: 1,
			frontierClearCommandCount: 1,
			maskPropagationCommandCount: 1,
			maskPropagationInstanceCount: 1,
			opaqueCompositeCommandCount: 1,
			opaqueCompositeInstanceCount: 2,
			scopeEnvelopeReductionCommandCount: 1,
			scopeEnvelopeReductionInstanceCount: 2,
			traversalDepth: 1,
		});
		// Projection is charged once by culling; packing retries only revisit retained window vertices.
		expect(frame.visibility.trace.projectionPrimitiveCount).toBeGreaterThan(0);
	});

	it("retreats before packing when arrival-state ids exceed their fixed format", () => {
		const middle = envCellScope("state-middle");
		const leaf = envCellScope("state-leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "state-middle"),
				topologyScope(leaf, "state-leaf"),
			],
			[
				crossing("state-middle", OUTDOOR_SCOPE, middle),
				crossing("state-leaf", middle, leaf),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount: 2,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.declinedDepth).toBe(2);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.trace).toMatchObject({
			atlasCapacityRetreatCount: 0,
			// The terminal empty frontier is discarded before the crossing-bearing frontier.
			arrivalStateCapacityRetreatCount: 2,
			frontierRetreatCount: 2,
			packingAttemptCount: 1,
		});
	});

	it("retreats before packing when expanded crossing triangles exceed fixed storage", () => {
		const middle = envCellScope("stream-middle");
		const leaf = envCellScope("stream-leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "stream-middle"),
				topologyScope(leaf, "stream-leaf"),
			],
			[
				crossing("stream-middle", OUTDOOR_SCOPE, middle),
				crossing("stream-leaf", middle, leaf),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 6,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.trace).toMatchObject({
			atlasCapacityRetreatCount: 0,
			arrivalStateCapacityRetreatCount: 0,
			crossingTriangleVertexCapacityRetreatCount: 2,
			crossingTriangleVertexCount: 6,
			frontierRetreatCount: 2,
			packingAttemptCount: 1,
		});
	});

	it("expands retained indexed apertures once into one reused interleaved stream", () => {
		const first = envCellScope("stream-first");
		const second = envCellScope("stream-second");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(first, "stream-first"),
				topologyScope(second, "stream-second"),
			],
			[
				crossing("a-stream-first", OUTDOOR_SCOPE, first, {
					aperture: rectangle(-0.45, -0.45, 0.45, 0.45, 0.75),
				}),
				crossing("b-stream-second", OUTDOOR_SCOPE, second, {
					maskDepthPolicy: "reject-equal-depth",
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 12,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});
		const stream = new PortalPropagationStreamArena(
			12,
			TEST_ATLAS_MAXIMUM_PATH_DEPTH,
		);
		expect(frame.visibility.selectedCrossingNearPlaneStraddle(0)).toBe(true);
		expect(frame.visibility.selectedCrossingNearPlaneStraddle(1)).toBe(false);

		const firstView = stream.prepare(
			frame,
			input.anchorCoordinates,
			input.clipFromAnchor,
		);
		const secondView = stream.prepare(
			frame,
			input.anchorCoordinates,
			input.clipFromAnchor,
		);
		const slots = new Uint32Array(stream.bytes.buffer);
		const metadataRecordSlotCount =
			PORTAL_ARRIVAL_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
		const cameraSlotCount =
			PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES /
			Float32Array.BYTES_PER_ELEMENT;
		const firstCrossingRecordOffset = cameraSlotCount + metadataRecordSlotCount;
		const secondCrossingRecordOffset =
			cameraSlotCount + metadataRecordSlotCount * 2;
		const metadataScopeSlot =
			PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const metadataReciprocalSlot =
			PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const metadataFlagsSlot =
			PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;

		expect(secondView).toBe(firstView);
		expect(secondView.vertexCount).toBe(12);
		expect(secondView.usedByteLength).toBe(
			12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		expect(secondView.indexCount).toBe(12);
		expect(secondView.roundIndexOffset(0)).toBe(0);
		expect(secondView.roundIndexCount(0)).toBe(12);
		expect(secondView.trace).toMatchObject({
			arenaGrowthCount: 0,
			arrivalMetadataStateWriteCount: 3,
			arrivalPlaneScalarWriteCount: 8,
			crossingInputCount: 2,
			indexCapacityBytes:
				TEST_ATLAS_MAXIMUM_PATH_DEPTH * 12 * Uint16Array.BYTES_PER_ELEMENT,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 36,
			propagationMetadataCapacityBytes:
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			quadCapacityBytes:
				PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT * PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
			reciprocalArrivalStateReadCount: 2,
			renderDomainMetadataStateWriteCount: 3,
			triangleIndexReadCount: 12,
			triangleCapacityBytes: 12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
			vertexHighWaterCount: 12,
		});
		expect(secondView.trace.arenaCapacityBytes).toBeGreaterThan(
			secondView.trace.triangleCapacityBytes +
				secondView.trace.propagationMetadataCapacityBytes +
				secondView.trace.indexCapacityBytes +
				secondView.trace.quadCapacityBytes,
		);
		expect(secondView.arrivalMetadataStateCount).toBe(3);
		expect(secondView.renderDomainMetadataStateCount).toBe(3);
		expect(secondView.usedPropagationMetadataByteLength).toBe(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		);
		const arrivalFloats = new Float32Array(
			stream.propagationMetadataBytes.buffer,
		);
		const arrivalUints = new Uint32Array(
			stream.propagationMetadataBytes.buffer,
		);
		expect(
			Array.from(
				arrivalFloats.slice(
					firstCrossingRecordOffset,
					firstCrossingRecordOffset + PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
				),
			),
		).toEqual([-0, -0, -1, 0.75]);
		expect(
			[metadataScopeSlot, metadataReciprocalSlot, metadataFlagsSlot].map(
				(slot) => arrivalUints[firstCrossingRecordOffset + slot],
			),
		).toEqual([1, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE]);
		expect(
			[metadataScopeSlot, metadataReciprocalSlot, metadataFlagsSlot].map(
				(slot) => arrivalUints[secondCrossingRecordOffset + slot],
			),
		).toEqual([2, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE]);
		const rootScopeMetadataOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		expect(
			Array.from(
				arrivalUints.slice(
					rootScopeMetadataOffset,
					rootScopeMetadataOffset +
						PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES /
							Uint32Array.BYTES_PER_ELEMENT,
				),
			),
		).toEqual([
			frame.tileX(0),
			frame.tileY(0),
			frame.tileScreenX(0),
			frame.tileScreenY(0),
			frame.tileWidth(0),
			frame.tileHeight(0),
			0,
			0,
		]);
		// Slot 3/4/5 are output arrival, source scope, and packed crossing policy.
		expect(Array.from(slots.slice(3, 6))).toEqual([
			2,
			0,
			PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL |
				PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG,
		]);
		expect(Array.from(slots.slice(6 * 6 + 3, 6 * 6 + 6))).toEqual([
			3,
			0,
			PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
		]);
	});

	it("resolves selected reciprocal crossings to their packed arrival ids", () => {
		const left = envCellScope("reciprocal-left");
		const right = envCellScope("reciprocal-right");
		const leftToRightId = "portal-crossing:left-right" as const;
		const rightToLeftId = "portal-crossing:right-left" as const;
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(left, "reciprocal-left"),
				topologyScope(right, "reciprocal-right"),
			],
			[
				crossing("root-left", OUTDOOR_SCOPE, left, {
					aperture: rectangle(-0.9, -0.8, -0.1, 0.8),
				}),
				crossing("root-right", OUTDOOR_SCOPE, right, {
					aperture: rectangle(0.1, -0.8, 0.9, 0.8),
				}),
				crossing("left-right", left, right, {
					aperture: rectangle(-0.9, -0.8, -0.1, 0.8),
					reciprocalCrossingId: rightToLeftId,
				}),
				crossing("right-left", right, left, {
					aperture: rectangle(0.1, -0.8, 0.9, 0.8),
					reciprocalCrossingId: leftToRightId,
				}),
			],
		);
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = scopeAtlasPlanner().plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 24,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});
		const selectedOrdinalById = new Map<PortalCrossingId, number>();
		for (
			let ordinal = 0;
			ordinal < frame.visibility.selectedCrossingCount;
			ordinal += 1
		) {
			selectedOrdinalById.set(
				frame.visibility.selectedCrossing(ordinal).id,
				ordinal,
			);
		}
		const leftToRightOrdinal = selectedOrdinalById.get(leftToRightId);
		const rightToLeftOrdinal = selectedOrdinalById.get(rightToLeftId);
		expect(leftToRightOrdinal).toBeTypeOf("number");
		expect(rightToLeftOrdinal).toBeTypeOf("number");
		if (leftToRightOrdinal === undefined || rightToLeftOrdinal === undefined) {
			throw new Error("Reciprocal cycle crossings were not selected.");
		}

		expect(
			frame.visibility.selectedCrossingReciprocalArrivalStateId(
				leftToRightOrdinal,
			),
		).toBe(rightToLeftOrdinal + 2);
		expect(
			frame.visibility.selectedCrossingReciprocalArrivalStateId(
				rightToLeftOrdinal,
			),
		).toBe(leftToRightOrdinal + 2);
	});

	it("bounds propagation by selected crossings and reuses its frame records", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const resource = {
			atlas: { height: 100, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		};

		const first = planner.plan(graph, input, resource);
		const commands = first.commands;
		const trace = first.trace;
		const second = planner.plan(graph, input, resource);

		expect(second).toBe(first);
		expect(second.commands).toBe(commands);
		expect(second.trace).toBe(trace);
		expect(second.commands.traversalDepth).toBe(1);
		expect(second.commands.maskPropagationCommandCount).toBe(1);
		expect(second.commands.scopeEnvelopeReductionCommandCount).toBe(1);
	});

	it("keeps a dense deterministic tile corpus in bounds without overlap", () => {
		const children = Array.from(
			{ length: TEST_ATLAS_PACKING_CHILD_COUNT },
			(_, ordinal) => envCellScope(`packing-${ordinal}`),
		);
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				...children.map((scope, ordinal) =>
					topologyScope(scope, `packing-${ordinal}`),
				),
			],
			children.map((target, ordinal) => {
				const column = ordinal % 6;
				const row = Math.floor(ordinal / 6);
				const centerX = -0.75 + column * 0.3;
				const centerY = -0.75 + row * 0.5;
				const width = 0.1 + (ordinal % 4) * 0.08;
				const height = 0.1 + (ordinal % 3) * 0.1;
				return crossing(`packing-${ordinal}`, OUTDOOR_SCOPE, target, {
					aperture: rectangle(
						centerX - width / 2,
						centerY - height / 2,
						centerX + width / 2,
						centerY + height / 2,
					),
				});
			}),
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: {
				height: TEST_ATLAS_PACKING_EXTENT,
				width: TEST_ATLAS_PACKING_EXTENT,
			},
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.tileCount).toBe(TEST_ATLAS_PACKING_CHILD_COUNT + 1);
		expect(frame.trace.packingAttemptCount).toBe(1);
		expect(frame.trace.tilePlacementAttemptCount).toBe(frame.tileCount);
		expect(frame.trace.tileSortComparisonCount).toBeLessThanOrEqual(
			frame.tileCount * Math.ceil(Math.log2(frame.tileCount)),
		);
		expect(frame.trace.atlasPackedExtentPixelCount).toBeLessThanOrEqual(
			frame.trace.atlasPixelCapacity,
		);
		for (let left = 0; left < frame.tileCount; left += 1) {
			expect(frame.tileX(left) + frame.tileWidth(left)).toBeLessThanOrEqual(
				TEST_ATLAS_PACKING_EXTENT,
			);
			expect(frame.tileY(left) + frame.tileHeight(left)).toBeLessThanOrEqual(
				TEST_ATLAS_PACKING_EXTENT,
			);
			for (let right = left + 1; right < frame.tileCount; right += 1) {
				const separated =
					frame.tileX(left) + frame.tileWidth(left) <= frame.tileX(right) ||
					frame.tileX(right) + frame.tileWidth(right) <= frame.tileX(left) ||
					frame.tileY(left) + frame.tileHeight(left) <= frame.tileY(right) ||
					frame.tileY(right) + frame.tileHeight(right) <= frame.tileY(left);
				expect(separated, `tile overlap ${left}/${right}`).toBe(true);
			}
		}
		expect(frame.commands.traversalDepth).toBe(1);
		expect(frame.commands.maskPropagationInstanceCount).toBe(
			TEST_ATLAS_PACKING_CHILD_COUNT,
		);
		expect(frame.commands.scopeEnvelopeReductionInstanceCount).toBeLessThan(
			TEST_ATLAS_MAXIMUM_PATH_DEPTH * frame.tileCount,
		);
	});

	it("terminates shallow multi-branch graphs early and prunes unreachable side branches", () => {
		const hall = envCellScope("hall");
		const room = envCellScope("room");
		const annex = envCellScope("annex");
		const vault = envCellScope("vault");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(hall, "hall"),
				topologyScope(room, "room"),
				topologyScope(annex, "annex"),
				topologyScope(vault, "vault"),
			],
			[
				crossing("0-out-hall", OUTDOOR_SCOPE, hall, {
					aperture: rectangle(-0.6, -0.4, -0.2, 0.4, 0.2),
				}),
				crossing("1-hall-room", hall, room, {
					aperture: rectangle(-0.55, -0.35, -0.25, 0.35, -0.2),
				}),
				crossing("2-out-annex", OUTDOOR_SCOPE, annex, {
					aperture: rectangle(0.2, -0.4, 0.6, 0.4, 0.2),
				}),
				// Visually overlaps `2-out-annex` on screen so culling retains `vault`, but sits on the
				// camera side (z = +0.35 > +0.2) of `2-out-annex`'s oriented entry half-space.
				crossing("3-annex-vault", annex, vault, {
					aperture: rectangle(0.25, -0.35, 0.55, 0.35, 0.35),
				}),
			],
		);
		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
		);
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.selectedCrossingCount).toBeGreaterThanOrEqual(3);
		expect(frame.commands.traversalDepth).toBe(2);
		expect(frame.roundCrossingCount(0)).toBe(2);
		expect(frame.roundCrossingCount(1)).toBe(1);
		expect(
			frame.visibility.selectedCrossing(frame.roundCrossingOrdinal(1, 0)).id,
		).toBe("portal-crossing:1-hall-room");
		expect(
			frame.roundFrontierScissorWidth(1) * frame.roundFrontierScissorHeight(1),
		).toBeLessThan(100 * 100);
	});

	it("schedules all 16 rounds of a genuine depth-16 cyclic chain without full-screen root sweeps", () => {
		const maxDepth = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
		const chainCells = Array.from({ length: maxDepth - 1 }, (_, index) =>
			envCellScope(`chain-${String(index).padStart(2, "0")}`),
		);
		const crossings: ScenePortalCrossing[] = [];
		for (let step = 0; step < maxDepth; step += 1) {
			const source = step === 0 ? OUTDOOR_SCOPE : chainCells[step - 1]!;
			const target = step === maxDepth - 1 ? OUTDOOR_SCOPE : chainCells[step]!;
			const z = 0.4 - step * 0.05;
			crossings.push(
				crossing(`step-${String(step).padStart(2, "0")}`, source, target, {
					aperture: rectangle(-0.18, -0.18, 0.18, 0.18, z),
				}),
			);
		}
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				...chainCells.map((scope, index) =>
					topologyScope(scope, `chain-${String(index).padStart(2, "0")}`),
				),
			],
			crossings,
		);
		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			maxDepth,
		);
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 400, width: 400 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.commands.traversalDepth).toBe(maxDepth);
		expect(frame.commands.maskPropagationInstanceCount).toBe(maxDepth);
		for (let round = 0; round < maxDepth; round += 1) {
			expect(frame.roundCrossingCount(round)).toBe(1);
			expect(
				frame.visibility.selectedCrossing(frame.roundCrossingOrdinal(round, 0))
					.id,
			).toBe(`portal-crossing:step-${String(round).padStart(2, "0")}`);
		}
		const rootTileArea = frame.tileWidth(0) * frame.tileHeight(0);
		expect(rootTileArea).toBe(10_000);
		let sawRound0RootClamp = false;
		let sawTerminalRootReentryReduce = false;
		for (let quad = 0; quad < frame.resolveQuadOffset; quad += 1) {
			const area = frame.quadWidth(quad) * frame.quadHeight(quad);
			// No reduction quad on any of the 16 rounds (including Round 0 and Round 15 outdoor
			// re-entry) may sweep the full 100x100 root tile; every quad is aperture-bounded.
			expect(area).toBeLessThanOrEqual(22 * 22);
			if (
				frame.quadRenderDomain(quad) === 0 &&
				frame.quadMode(quad) === PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP
			) {
				sawRound0RootClamp = true;
			}
			if (
				frame.quadRenderDomain(quad) === 0 &&
				frame.quadMode(quad) === PORTAL_QUAD_MODE_MAX_REDUCE
			) {
				sawTerminalRootReentryReduce = true;
			}
		}
		expect(sawRound0RootClamp).toBe(true);
		expect(sawTerminalRootReentryReduce).toBe(true);
		expect(frame.trace.arenaGrowthCount).toBe(0);
		expect(frame.trace.portalOwnedFrameHeapRecordCreationCount).toBe(0);
	});

	it("admits equal-depth coincident-junction transits while pruning ungrouped coplanar advances", () => {
		const middle = envCellScope("junction-middle");
		const leaf = envCellScope("junction-leaf");
		const buildGraph = (junctionGroupId: number | null) =>
			topology(
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(middle, "junction-middle"),
					topologyScope(leaf, "junction-leaf"),
				],
				[
					crossing("0-root-middle", OUTDOOR_SCOPE, middle, {
						aperture: rectangle(-0.4, -0.4, 0.4, 0.4, 0),
						junctionGroupId,
					}),
					crossing("1-middle-leaf", middle, leaf, {
						aperture: rectangle(-0.4, -0.4, 0.4, 0.4, 0),
						junctionGroupId,
					}),
				],
			);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const resource = {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		};

		const ungrouped = planner.plan(buildGraph(null), input, resource);
		expect(ungrouped.commands.traversalDepth).toBe(1);
		expect(ungrouped.roundCrossingCount(0)).toBe(1);

		const grouped = planner.plan(buildGraph(7), input, resource);
		expect(grouped.commands.traversalDepth).toBe(2);
		expect(grouped.roundCrossingCount(0)).toBe(1);
		expect(grouped.roundCrossingCount(1)).toBe(1);
	});

	it("keeps distant multi-window apertures disjoint and expands child resolve quads by the gutter radius", () => {
		const wideHall = envCellScope("wide-hall");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(wideHall, "wide-hall"),
			],
			[
				crossing("left-window", OUTDOOR_SCOPE, wideHall, {
					aperture: rectangle(-0.9, -0.2, -0.7, 0.2, 0),
				}),
				crossing("right-window", OUTDOOR_SCOPE, wideHall, {
					aperture: rectangle(0.7, -0.2, 0.9, 0.2, 0),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = planner.plan(graph, input, {
			atlas: { height: 200, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.tileCount).toBe(2);
		expect(frame.tileWidth(1)).toBe(90);
		expect(frame.tileHeight(1)).toBe(22);
		expect(frame.commands.traversalDepth).toBe(1);

		const childReductionQuads: {
			screenX: number;
			screenY: number;
			width: number;
			height: number;
		}[] = [];
		for (let quad = 0; quad < frame.resolveQuadOffset; quad += 1) {
			if (frame.quadRenderDomain(quad) === 1) {
				childReductionQuads.push({
					height: frame.quadHeight(quad),
					screenX: frame.quadScreenX(quad),
					screenY: frame.quadScreenY(quad),
					width: frame.quadWidth(quad),
				});
			}
		}
		expect(childReductionQuads).toHaveLength(2);

		expect(frame.resolveQuadCount).toBe(3);
		expect(frame.quadRenderDomain(frame.resolveQuadOffset)).toBe(0);
		expect(frame.quadWidth(frame.resolveQuadOffset)).toBe(100);
		expect(frame.quadHeight(frame.resolveQuadOffset)).toBe(100);

		const tileMinX = frame.tileScreenX(1);
		const tileMinY = frame.tileScreenY(1);
		const tileMaxX = tileMinX + frame.tileWidth(1);
		const tileMaxY = tileMinY + frame.tileHeight(1);
		let childResolveArea = 0;
		for (let index = 0; index < 2; index += 1) {
			const resolveIndex = frame.resolveQuadOffset + 1 + index;
			const base = childReductionQuads[index]!;
			const expectedMinX = Math.max(
				tileMinX,
				base.screenX - PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
			);
			const expectedMinY = Math.max(
				tileMinY,
				base.screenY - PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
			);
			const expectedMaxX = Math.min(
				tileMaxX,
				base.screenX + base.width + PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
			);
			const expectedMaxY = Math.min(
				tileMaxY,
				base.screenY + base.height + PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
			);
			expect(frame.quadRenderDomain(resolveIndex)).toBe(1);
			expect(frame.quadScreenX(resolveIndex)).toBe(expectedMinX);
			expect(frame.quadScreenY(resolveIndex)).toBe(expectedMinY);
			expect(frame.quadWidth(resolveIndex)).toBe(expectedMaxX - expectedMinX);
			expect(frame.quadHeight(resolveIndex)).toBe(expectedMaxY - expectedMinY);
			childResolveArea +=
				frame.quadWidth(resolveIndex) * frame.quadHeight(resolveIndex);
		}
		// The uncovered 70-pixel wall gap between the two windows is never shaded in resolve.
		expect(childResolveArea).toBeLessThan(
			frame.tileWidth(1) * frame.tileHeight(1) * 0.5,
		);
	});

	it("rejects a resource that cannot always retain the root tile", () => {
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const graph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);

		expect(() =>
			planner.plan(graph, input, {
				atlas: { height: 100, width: 99 },
				drawingBuffer: input.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("retain the full drawing-buffer root tile");
	});

	it("rejects resource dimensions and trace totals that cannot fit their storage", () => {
		const planner = scopeAtlasPlanner();
		const graph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);
		const ordinaryInput = atlasPlanInput(OUTDOOR_SCOPE);

		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 0, width: 100 },
				drawingBuffer: ordinaryInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("fit a positive Uint32");
		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 100, width: TEST_UINT32_OVERFLOW },
				drawingBuffer: ordinaryInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("fit a positive Uint32");
		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 100, width: 100 },
				drawingBuffer: { height: 100, width: 99 },
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("culler drawing-buffer extents differ");

		const unsafePixelInput = planInput(OUTDOOR_SCOPE, {
			portalFootprint: {
				drawingBuffer: {
					height: TEST_ATLAS_UNSAFE_PIXEL_EXTENT,
					width: TEST_ATLAS_UNSAFE_PIXEL_EXTENT,
				},
				minimumPixelArea: 0,
			},
		});
		expect(() =>
			planner.plan(graph, unsafePixelInput, {
				atlas: unsafePixelInput.portalFootprint.drawingBuffer,
				drawingBuffer: unsafePixelInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("pixel capacity exceeds safe integer storage");

		const unsafeTraceInput = planInput(OUTDOOR_SCOPE, {
			portalFootprint: {
				drawingBuffer: {
					height: TEST_ATLAS_UNSAFE_TILE_EXTENT,
					width: TEST_ATLAS_UNSAFE_TILE_EXTENT,
				},
				minimumPixelArea: 0,
			},
		});
		expect(() =>
			planner.plan(graph, unsafeTraceInput, {
				atlas: unsafeTraceInput.portalFootprint.drawingBuffer,
				drawingBuffer: unsafeTraceInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("tile-area trace exceeds safe integer storage");
	});

	it("rejects duplicate canonical renderer keys at the topology boundary", () => {
		const first = envCellScope("duplicate");
		const second = {
			envCellId: first.envCellId,
			kind: "env-cell",
			landblockId: "0x0002ffff",
		} as const satisfies SceneScope;
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(first);

		expect(() =>
			planner.plan(
				topology(
					[topologyScope(first, "first"), topologyScope(second, "second")],
					[],
				),
				input,
				{
					atlas: { height: 100, width: 100 },
					drawingBuffer: input.portalFootprint.drawingBuffer,
					maximumCrossingTriangleVertexCount:
						PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
							.maximumCrossingTriangleVertexCount,
					maximumArrivalStateCount:
						PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
				},
			),
		).toThrow("duplicate authored scope key duplicate");
	});

	it("schedules zero-depth multi-domain plans cleanly without direct-root routing", () => {
		const child = envCellScope("zero-depth-child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("a-zero-depth-child", OUTDOOR_SCOPE, child)],
		);
		const planner = new PortalScopeAtlasPlanner(
			{
				maximumDepth: TEST_ATLAS_MAXIMUM_PATH_DEPTH,
				maximumProjectionPrimitiveCount: 100_000,
				maximumWorkItemCount: 64,
				windowArena: scopeWindowArenaCapacity(),
			},
			0,
		);
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 12,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});
		const stream = new PortalPropagationStreamArena(12, 0);
		const prepared = stream.prepare(
			frame,
			input.anchorCoordinates,
			input.clipFromAnchor,
		);
		const callPlan = compilePortalScopeAtlasWebGLCalls({
			crossingIndexCount: prepared.indexCount,
			crossingVertexCount: prepared.vertexCount,
			metadataBindingPoint: 0,
			quadInstanceCount: prepared.quadCount,
			renderDomainCount: prepared.renderDomainMetadataStateCount,
			resolveQuadCount: prepared.resolveQuadCount,
			resolveQuadOffset: prepared.resolveQuadOffset,
			roundIndexCount: (round) => prepared.roundIndexCount(round),
			roundIndexOffset: (round) => prepared.roundIndexOffset(round),
			roundReductionQuadCount: (round) =>
				prepared.roundReductionQuadCount(round),
			roundReductionQuadOffset: (round) =>
				prepared.roundReductionQuadOffset(round),
			traversalDepth: frame.commands.traversalDepth,
		});
		expect(frame.tileCount).toBe(2);
		expect(frame.directRootOutput).toBe(false);
		expect(frame.commands.traversalDepth).toBe(0);
		expect(prepared.vertexCount).toBe(0);
		expect(prepared.indexCount).toBe(0);
		expect(prepared.resolveQuadCount).toBe(1);
		expect(callPlan.trace).toEqual({ totalWebGLCallCount: 38 });

		const rootOnlyFrame = planner.plan(
			topology([topologyScope(OUTDOOR_SCOPE, null)], []),
			input,
			{
				atlas: { height: 300, width: 300 },
				drawingBuffer: input.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount: 12,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			},
		);
		expect(rootOnlyFrame.tileCount).toBe(1);
		expect(rootOnlyFrame.directRootOutput).toBe(true);
	});

	it("computes the exact pigeonhole quad capacity and coalesces > 8 disjoint windows to 8", () => {
		expect(portalScopeAtlasMaximumQuadCount(0)).toBe(1);
		expect(portalScopeAtlasMaximumQuadCount(1)).toBe(2_295);
		expect(
			portalScopeAtlasMaximumQuadCount(
				PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			),
		).toBe(PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT);
		expect(() => portalScopeAtlasMaximumQuadCount(-1)).toThrow(
			"non-negative safe integer",
		);

		const child = envCellScope("coalesce-child");
		const disjointCrossings = Array.from({ length: 12 }, (_, index) => {
			const column = index % 4;
			const row = Math.floor(index / 4);
			const minX = -0.9 + column * 0.52;
			const minY = -0.8 + row * 0.65;
			return crossing(
				`window-${index.toString().padStart(2, "0")}`,
				OUTDOOR_SCOPE,
				child,
				{
					aperture: rectangle(minX, minY, minX + 0.04, minY + 0.04),
				},
			);
		});
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			disjointCrossings,
		);
		const input = planInput(OUTDOOR_SCOPE, {
			portalFootprint: {
				drawingBuffer: { height: 400, width: 400 },
				minimumPixelArea: 0,
			},
		});
		const frame = scopeAtlasPlanner().plan(graph, input, {
			atlas: { height: 800, width: 800 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 256,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.commands.traversalDepth).toBe(1);
		// Round 0 is also terminal here: 8 coalesced root-clamp quads + 8 coalesced child quads.
		expect(frame.roundReductionQuadCount(0)).toBe(16);
		// Resolve: 1 root quad + 8 coalesced child quads.
		expect(frame.resolveQuadCount).toBe(9);
		expect(frame.quadCount).toBe(25);
	});

	it("retains far-anchor grazing entry-plane candidates while still rejecting clearly-behind crossings", () => {
		const middle = envCellScope("far-middle");
		const grazingTarget = envCellScope("far-grazing");
		const behindTarget = envCellScope("far-behind");
		// Anchor is 10 landblocks away (+1,920 world units in Z), where float32 plane evaluation error
		// exceeds the fixed 0.5 * PORTAL_QUERY_EPSILON margin.
		const farAnchor = getLandblockCoordinates("0x000bffff");
		const farClipFromAnchor = Mat4.identity();
		farClipFromAnchor.m43 = -1_920;
		const input = planInput(OUTDOOR_SCOPE, {
			anchorCoordinates: farAnchor,
			clipFromAnchor: farClipFromAnchor,
			nearClipVolume: testNearClipVolume(0.5, new Vec3(0, 0, 1_922)),
			portalFootprint: {
				drawingBuffer: { height: 100, width: 100 },
				minimumPixelArea: 0,
			},
		});
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "far-middle"),
				topologyScope(grazingTarget, "far-grazing"),
				topologyScope(behindTarget, "far-behind"),
			],
			[
				crossing("a-out-middle", OUTDOOR_SCOPE, middle, {
					acceptedSide: "positive",
					aperture: rectangle(-0.6, -0.6, 0.6, 0.6, 0),
				}),
				// z = +0.005 is 0.005 units behind z = 0 toward the camera (rejected by a naive +0.0001
				// margin, but within the float32 ULP error envelope at 1,920 world units from the anchor).
				crossing("b-middle-grazing", middle, grazingTarget, {
					acceptedSide: "positive",
					aperture: rectangle(-0.4, -0.4, 0.4, 0.4, 0.005),
				}),
				// z = +0.5 is far behind z = 0 even at 1,920 world units and must still be rejected.
				crossing("c-middle-behind", middle, behindTarget, {
					acceptedSide: "positive",
					aperture: rectangle(-0.4, -0.4, 0.4, 0.4, 0.5),
				}),
			],
		);
		const frame = scopeAtlasPlanner().plan(graph, input, {
			atlas: { height: 400, width: 400 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 64,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.selectedCrossingCount).toBe(3);
		expect(frame.commands.traversalDepth).toBe(2);
		expect(frame.roundCrossingCount(0)).toBe(1);
		expect(frame.roundCrossingCount(1)).toBe(1);
		expect(
			frame.visibility.selectedCrossing(frame.roundCrossingOrdinal(1, 0)).id,
		).toBe("portal-crossing:b-middle-grazing");
	});

	it("includes allow-equal-depth GPU biased triangles in conservative screen bounds while excluding unbiased ones", () => {
		const allowTarget = envCellScope("bias-allow");
		const rejectTarget = envCellScope("bias-reject");
		// Camera sits at z = +2 (acceptedSide = "positive"), so oriented entryPlane.xyz = (0, 0, -1)
		// and allow-equal-depth adds depthBias.z = -PORTAL_QUERY_EPSILON, pulling z = 1 + 0.5 * eps
		// into canonical [-1, 1] clip space on the GPU.
		const grazingZ = 1 + PORTAL_QUERY_EPSILON * 0.5;
		const splitGrazingAperture: PlanarAperture = {
			indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
			plane: { d: 0, normal: new Vec3(0, 0, 1) },
			vertices: new Float32Array([
				// Left triangle well inside canonical clip space (x in [-0.9, -0.8], z = 0).
				-0.9,
				-0.2,
				0,
				-0.8,
				-0.2,
				0,
				-0.85,
				0.2,
				0,
				// Right triangle just outside z = -1 by 0.5 * PORTAL_QUERY_EPSILON (x in [0.7, 0.8]),
				// shifted inside [-1, 1] on GPU only when allow-equal-depth adds +PORTAL_QUERY_EPSILON.
				0.7,
				-0.2,
				grazingZ,
				0.8,
				-0.2,
				grazingZ,
				0.75,
				0.2,
				grazingZ,
			]),
		};
		const input = planInput(OUTDOOR_SCOPE, {
			nearClipVolume: testNearClipVolume(0.25, new Vec3(0, 0, 2)),
			portalFootprint: {
				drawingBuffer: { height: 100, width: 100 },
				minimumPixelArea: 0,
			},
		});
		const planner = scopeAtlasPlanner();
		const resource = {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 64,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		};

		const rejectFrame = planner.plan(
			topology(
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(rejectTarget, "bias-reject"),
				],
				[
					crossing("reject", OUTDOOR_SCOPE, rejectTarget, {
						acceptedSide: "positive",
						maskDepthPolicy: "reject-equal-depth",
						visibilityAperture: splitGrazingAperture,
					}),
				],
			),
			input,
			resource,
		);
		const rejectMaxX =
			rejectFrame.roundFrontierScissorX(0) +
			rejectFrame.roundFrontierScissorWidth(0);

		const allowFrame = planner.plan(
			topology(
				[
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(allowTarget, "bias-allow"),
				],
				[
					crossing("allow", OUTDOOR_SCOPE, allowTarget, {
						acceptedSide: "positive",
						maskDepthPolicy: "allow-equal-depth",
						visibilityAperture: splitGrazingAperture,
					}),
				],
			),
			input,
			resource,
		);
		const allowMaxX =
			allowFrame.roundFrontierScissorX(0) +
			allowFrame.roundFrontierScissorWidth(0);

		expect(rejectMaxX).toBeLessThanOrEqual(12);
		expect(allowMaxX).toBeGreaterThanOrEqual(90);
	});

	it("schedules full-viewport branching and cyclic depth-16 workloads within bounded scissored clear and quad budgets", () => {
		const maximumDepth = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
		const leftScopes = Array.from({ length: maximumDepth - 1 }, (_, index) =>
			envCellScope(`full-left-${index.toString().padStart(2, "0")}`),
		);
		const rightScopes = Array.from({ length: maximumDepth - 1 }, (_, index) =>
			envCellScope(`full-right-${index.toString().padStart(2, "0")}`),
		);
		const sharedIslands = ["hub-0", "hub-1", "hub-2"] as const;
		const drawingBuffer = { height: 861, width: 1_424 };
		const atlas = {
			height:
				drawingBuffer.height *
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.rowCount,
			width:
				drawingBuffer.width *
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.columnCount,
		};
		const branchCrossings: ScenePortalCrossing[] = [];
		for (let step = 0; step < maximumDepth; step += 1) {
			const z = 0.9 - step * 0.1;
			branchCrossings.push(
				crossing(
					`left-${step.toString().padStart(2, "0")}`,
					step === 0 ? OUTDOOR_SCOPE : leftScopes[step - 1]!,
					step === maximumDepth - 1 ? OUTDOOR_SCOPE : leftScopes[step]!,
					{ aperture: rectangle(-0.85, -0.7, -0.05, 0.7, z) },
				),
				crossing(
					`right-${step.toString().padStart(2, "0")}`,
					step === 0 ? OUTDOOR_SCOPE : rightScopes[step - 1]!,
					step === maximumDepth - 1 ? OUTDOOR_SCOPE : rightScopes[step]!,
					{ aperture: rectangle(0.05, -0.7, 0.85, 0.7, z) },
				),
			);
		}
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				...leftScopes.map((scope, index) =>
					topologyScope(scope, sharedIslands[index % sharedIslands.length]!),
				),
				...rightScopes.map((scope, index) =>
					topologyScope(
						scope,
						sharedIslands[(index + 1) % sharedIslands.length]!,
					),
				),
			],
			branchCrossings,
		);
		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			maximumDepth,
		);
		const input = planInput(OUTDOOR_SCOPE, {
			nearClipVolume: testNearClipVolume(0.25, new Vec3(0, 0, 2)),
			portalFootprint: { drawingBuffer, minimumPixelArea: 0 },
		});
		const frame = planner.plan(graph, input, {
			atlas,
			drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("complete");
		expect(frame.tileCount).toBe(4);
		expect(frame.packedWidth).toBeLessThanOrEqual(atlas.width);
		expect(frame.packedHeight).toBeLessThanOrEqual(atlas.height);
		expect(frame.commands.traversalDepth).toBe(maximumDepth);
		expect(frame.quadCount).toBeLessThanOrEqual(
			PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
		);

		let previousScissorMinX = 0;
		let previousScissorMinY = 0;
		let previousScissorMaxX = drawingBuffer.width;
		let previousScissorMaxY = drawingBuffer.height;
		let scissoredFrontierClearPixels = 0;
		for (let round = 0; round < maximumDepth; round += 1) {
			expect(frame.roundCrossingCount(round)).toBeGreaterThanOrEqual(2);
			const minX = frame.roundFrontierScissorX(round);
			const minY = frame.roundFrontierScissorY(round);
			const width = frame.roundFrontierScissorWidth(round);
			const height = frame.roundFrontierScissorHeight(round);
			const maxX = minX + width;
			const maxY = minY + height;
			expect(minX).toBeGreaterThanOrEqual(previousScissorMinX);
			expect(minY).toBeGreaterThanOrEqual(previousScissorMinY);
			expect(maxX).toBeLessThanOrEqual(previousScissorMaxX);
			expect(maxY).toBeLessThanOrEqual(previousScissorMaxY);
			previousScissorMinX = minX;
			previousScissorMinY = minY;
			previousScissorMaxX = maxX;
			previousScissorMaxY = maxY;
			scissoredFrontierClearPixels += width * height;
		}
		const round0CoverageRatio =
			(frame.roundFrontierScissorWidth(0) *
				frame.roundFrontierScissorHeight(0)) /
			(drawingBuffer.width * drawingBuffer.height);
		expect(round0CoverageRatio).toBeGreaterThan(0.55);
		const fullViewportClearPixels =
			maximumDepth * drawingBuffer.width * drawingBuffer.height;
		expect(scissoredFrontierClearPixels).toBeLessThan(fullViewportClearPixels);
		expect(frame.commands.scopeEnvelopeReductionInstanceCount).toBeLessThan(80);
		expect(frame.resolveQuadCount).toBeLessThanOrEqual(9);
	});
});

function scopeAtlasPlanner(): PortalScopeAtlasPlanner {
	return new PortalScopeAtlasPlanner(
		{
			maximumDepth: TEST_ATLAS_MAXIMUM_PATH_DEPTH,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 64,
			windowArena: scopeWindowArenaCapacity(),
		},
		TEST_ATLAS_MAXIMUM_PATH_DEPTH,
	);
}

function atlasPlanInput(
	rootScope: SceneScope,
): PortalScopeWindowReferenceInput {
	return planInput(rootScope, {
		portalFootprint: {
			drawingBuffer: { height: 100, width: 100 },
			minimumPixelArea: 0,
		},
	});
}

function scopeWindowSnapshot(
	frame: ReturnType<PortalScopeWindowCuller["cull"]>,
): readonly {
	readonly scope: string;
	readonly window: readonly number[][][];
}[] {
	return Array.from({ length: frame.selectedScopeCount }, (_, ordinal) => ({
		scope: scopeIdentity(frame.selectedScope(ordinal)),
		window: [
			[
				[
					frame.selectedMinimumNdcX(ordinal),
					frame.selectedMinimumNdcY(ordinal),
				],
				[
					frame.selectedMaximumNdcX(ordinal),
					frame.selectedMinimumNdcY(ordinal),
				],
				[
					frame.selectedMaximumNdcX(ordinal),
					frame.selectedMaximumNdcY(ordinal),
				],
				[
					frame.selectedMinimumNdcX(ordinal),
					frame.selectedMaximumNdcY(ordinal),
				],
			],
		],
	})).sort((left, right) => left.scope.localeCompare(right.scope));
}

function scopeWindowArenaCapacity() {
	return {
		maximumApertureVertexCount: 64,

		maximumVerticesPerFragment: 64,
		maximumWindowCount: 512,
	};
}

function windowSnapshot(window: PortalViewWindow): readonly number[][][] {
	return window.fragments.map(({ vertices }) =>
		vertices.map(({ x, y }) => [x, y]),
	);
}

function planInput(
	rootScope: SceneScope,
	overrides: Partial<PortalScopeWindowReferenceInput> = {},
): PortalScopeWindowReferenceInput {
	return {
		anchorCoordinates: getLandblockCoordinates(LANDBLOCK_ID),
		clipFromAnchor: Mat4.identity(),
		nearClipVolume: testNearClipVolume(0.5),
		portalFootprint: {
			drawingBuffer: { height: 1, width: 1 },
			minimumPixelArea: 0,
		},
		rootScope,
		safetyWorkItemLimit: DEFAULT_SAFETY_WORK_ITEM_LIMIT,
		...overrides,
	};
}

function testNearClipVolume(near: number, position = new Vec3(0, 0, 1)) {
	return createCameraNearClipVolume(
		{ fov: 90, near },
		{ position, rotation: Quat.identity() },
		1,
	);
}

function topology(
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossing[],
): SceneTopologyView {
	const outgoingByScope = new Map<string, ScenePortalCrossing[]>();
	for (const edge of crossings) {
		const key = scopeIdentity(edge.source);
		const outgoing = outgoingByScope.get(key) ?? [];
		outgoing.push(edge);
		outgoingByScope.set(key, outgoing);
	}
	for (const outgoing of outgoingByScope.values()) {
		outgoing.sort((left, right) => left.id.localeCompare(right.id));
	}
	return {
		crossings: [...crossings].sort((left, right) =>
			left.id.localeCompare(right.id),
		),
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
	options: {
		readonly acceptedSide?: ScenePortalCrossing["acceptedSide"];
		readonly aperture?: PlanarAperture;
		readonly exactMatch?: boolean;
		readonly junctionGroupId?: number | null;
		readonly maskDepthPolicy?: ScenePortalCrossing["maskDepthPolicy"];
		readonly reciprocalCrossingId?: PortalCrossingId | null;
		readonly spatialRelationship?: ScenePortalCrossing["spatialRelationship"];
		readonly visibilityAperture?: PlanarAperture;
	} = {},
): ScenePortalCrossing {
	const aperture = options.aperture ?? rectangle(-0.9, -0.9, 0.9, 0.9);
	const sceneAperture = {
		id: `portal-aperture:${id}` as const,
		indices: aperture.indices,
		landblockBounds: boundsForAperture(aperture),
		landblockId: LANDBLOCK_ID,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
	const visibility = options.visibilityAperture;
	const visibilityAperture = visibility
		? {
				id: `portal-aperture:${id}/visibility` as const,
				indices: visibility.indices,
				landblockBounds: boundsForAperture(visibility),
				landblockId: LANDBLOCK_ID,
				plane: visibility.plane,
				vertices: visibility.vertices,
			}
		: sceneAperture;
	return {
		acceptedSide: options.acceptedSide ?? "positive",
		exactMatch: options.exactMatch ?? true,
		id: `portal-crossing:${id}`,
		maskDepthPolicy: options.maskDepthPolicy ?? "allow-equal-depth",
		junctionGroupId: options.junctionGroupId ?? null,
		reciprocalCrossingId: options.reciprocalCrossingId ?? null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship: options.spatialRelationship ?? {
			kind: "indoor-topology-boundary",
			reason: "synthetic-boundary",
		},
		target,
		visibilityAperture,
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

function splitAperture(): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
		plane: { d: 0, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			-0.9, -0.8, 0, -0.2, -0.8, 0, -0.55, 0.7, 0, 0.2, -0.8, 0, 0.9, -0.8, 0,
			0.55, 0.7, 0,
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

function scopeIdentity(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? "outdoor"
		: `${scope.landblockId}/${scope.envCellId}`;
}
