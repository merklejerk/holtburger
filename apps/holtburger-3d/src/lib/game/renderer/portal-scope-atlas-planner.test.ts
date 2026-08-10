import { describe, expect, it } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import type { PlanarAperture } from "../scene/planar-aperture";
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
	PortalPropagationStreamArena,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PortalScopeWindowCuller } from "./portal-scope-window-culler";
import { createCameraNearClipVolume } from "./portal-near-plane";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import { PortalScopeAtlasPlanner } from "./portal-scope-atlas-planner";
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
const TEST_RECTANGLE_VERTEX_COUNT = 4;

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

	it("matches near-plane and multipart immutable projection results", () => {
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

		expect(scopeWindowSnapshot(actual)).toEqual(
			expected
				.map(({ scope, window }) => ({
					scope: scopeIdentity(scope),
					window: windowSnapshot(window),
				}))
				.sort((left, right) => left.scope.localeCompare(right.scope)),
		);
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
		expect(actual.selectedFragmentCount(splitOrdinal)).toBe(2);
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

	it("declines a whole frontier when committed polygon capacity is exhausted", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: {
				...scopeWindowArenaCapacity(),
				maximumFragmentCount: 1,
			},
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
		expect(frame.trace.portalOwnedFrameHeapRecordCreationCount).toBe(0);
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
			"unavailable in this topology",
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
			windowVertexReadCount: 8,
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
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
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
		const stream = new PortalPropagationStreamArena(12);
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
		expect(secondView.trace).toMatchObject({
			arenaCapacityBytes:
				12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES +
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			arenaGrowthCount: 0,
			arrivalMetadataStateWriteCount: 3,
			arrivalPlaneScalarWriteCount: 8,
			crossingInputCount: 2,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 36,
			propagationMetadataCapacityBytes:
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			reciprocalArrivalStateReadCount: 2,
			renderDomainMetadataStateWriteCount: 3,
			triangleIndexReadCount: 12,
			triangleCapacityBytes: 12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
			vertexHighWaterCount: 12,
		});
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
		expect(frame.trace.windowVertexReadCount).toBe(
			frame.tileCount * TEST_RECTANGLE_VERTEX_COUNT,
		);
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
		expect(frame.commands.maskPropagationInstanceCount).toBe(
			TEST_ATLAS_MAXIMUM_PATH_DEPTH * TEST_ATLAS_PACKING_CHILD_COUNT,
		);
		expect(frame.commands.scopeEnvelopeReductionInstanceCount).toBe(
			TEST_ATLAS_MAXIMUM_PATH_DEPTH * frame.tileCount,
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
});

function scopeAtlasPlanner(): PortalScopeAtlasPlanner {
	return new PortalScopeAtlasPlanner({
		maximumDepth: TEST_ATLAS_MAXIMUM_PATH_DEPTH,
		maximumProjectionPrimitiveCount: 100_000,
		maximumWorkItemCount: 64,
		windowArena: scopeWindowArenaCapacity(),
	});
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
		window: Array.from(
			{ length: frame.selectedFragmentCount(ordinal) },
			(_, fragment) =>
				Array.from(
					{
						length: frame.selectedFragmentVertexCount(ordinal, fragment),
					},
					(_, vertex) => [
						frame.selectedVertexX(ordinal, fragment, vertex),
						frame.selectedVertexY(ordinal, fragment, vertex),
					],
				),
		),
	})).sort((left, right) => left.scope.localeCompare(right.scope));
}

function scopeWindowArenaCapacity() {
	return {
		maximumApertureVertexCount: 64,
		maximumFragmentCount: 2_048,
		maximumTemporaryFragmentCount: 256,
		maximumTemporaryVertexCount: 16_384,
		maximumVertexCount: 16_384,
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
	crossings: readonly ScenePortalCrossingInput[],
): SceneTopologyView {
	const outgoingByScope = new Map<string, ScenePortalCrossingInput[]>();
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
		readonly acceptedSide?: ScenePortalCrossingInput["acceptedSide"];
		readonly aperture?: PlanarAperture;
		readonly exactMatch?: boolean;
		readonly maskDepthPolicy?: ScenePortalCrossingInput["maskDepthPolicy"];
		readonly reciprocalCrossingId?: PortalCrossingId | null;
		readonly spatialRelationship?: ScenePortalCrossingInput["spatialRelationship"];
		readonly visibilityAperture?: PlanarAperture;
	} = {},
): ScenePortalCrossingInput {
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
