import { afterEach, describe, expect, it, vi } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	ScenePortalCrossing,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import { createCameraNearClipVolume } from "./portal-near-plane";
import type { PortalPropagationStreamView } from "./portal-crossing-triangle-stream";
import { WebGL2PortalScopeAtlasPipeline } from "./webgl2-portal-scope-atlas-pipeline";
import { PortalScopeAtlasPlanner } from "./portal-scope-atlas-planner";
import { PortalPropagationStreamArena } from "./portal-crossing-triangle-stream";
import { PORTAL_SCOPE_TILE_UNBOUNDED_ENVELOPE_FLAG } from "./portal-scope-tile-metadata";
import { PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES } from "./portal-propagation-metadata";

const INDOOR_SCOPE = {
	kind: "env-cell",
	landblockId: "0x0001ffff",
	envCellId: "0x00010100",
} as const;

afterEach(() => vi.restoreAllMocks());

const UNBOUNDED_ENVELOPE_TEXTURE = {
	kind: "unbounded-envelope",
} as unknown as WebGLTexture;
const ENVELOPE_TEXTURE = {
	kind: "atlas-envelope",
} as unknown as WebGLTexture;
const ATLAS_SCENE_FRAMEBUFFER = {
	kind: "atlas-scene",
} as unknown as WebGLFramebuffer;
const DIRECT_OUTPUT_FRAMEBUFFER = {
	kind: "direct-output",
} as unknown as WebGLFramebuffer;

const device = vi.hoisted(() => ({
	bindDirectRootMetadata: vi.fn(),
	execute: vi.fn(),
	resize: vi.fn(),
}));

// Keep real visibility, packing, routing, and CPU streams; replace only GPU resource owners.
vi.mock("./webgl2-portal-scope-atlas-targets", () => ({
	WebGL2PortalScopeAtlasTargets: class {
		resize(extents: { atlas: { width: number; height: number } }) {
			device.resize(extents);
			return {
				envelope: { depth: ENVELOPE_TEXTURE, framebuffer: null },
				extents,
				scene: { framebuffer: ATLAS_SCENE_FRAMEBUFFER },
			};
		}
		destroy() {}
	},
}));
vi.mock("./webgl2-portal-scope-atlas-executor", () => ({
	WebGL2PortalScopeAtlasExecutor: class {
		readonly unboundedEnvelopeDepthTexture = UNBOUNDED_ENVELOPE_TEXTURE;
		bindDirectRootMetadata(stream: PortalPropagationStreamView) {
			device.bindDirectRootMetadata(stream.propagationMetadataBytes.slice());
		}
		execute(input: {
			clearColor: readonly [number, number, number, number];
			stream: PortalPropagationStreamView;
		}) {
			device.execute({
				clearColor: input.clearColor,
				metadata: input.stream.propagationMetadataBytes.slice(),
			});
		}
		destroy() {}
	},
}));

describe("deferred portal view ownership", () => {
	it("reuses each view's plan and stream while resetting per-frame routing", () => {
		const plan = vi.spyOn(PortalScopeAtlasPlanner.prototype, "plan");
		const stream = vi.spyOn(PortalPropagationStreamArena.prototype, "prepare");
		const pipeline = new WebGL2PortalScopeAtlasPipeline(fixtureDevice(vi.fn()));
		const topology = emptyTopology();
		const input = outdoorInput();
		const prepare = () => pipeline.prepare(topology, input);
		pipeline.beginFrame();
		const first = prepare();
		const atlas = first.atlas;
		expect(
			pipeline.beginOpaqueScene(first, [0, 0, 0, 1], DIRECT_OUTPUT_FRAMEBUFFER),
		).toBeNull();
		pipeline.routeTerrainPass(3, {});
		expect(first.opaqueRouting.trace.terrainSubmissionCount).toBe(3);
		pipeline.beginFrame();
		const second = prepare();
		expect(second.atlas).toBe(atlas);
		expect(plan).toHaveBeenCalledTimes(1);
		expect(stream).toHaveBeenCalledTimes(1);
		expect(second.opaqueRouting.trace.terrainSubmissionCount).toBe(0);
		expect(second.projectionPrimitiveCount).toBe(0);
		// A changed second view does not overwrite the first view's retained preparation.
		const indoor = { ...input, rootScope: INDOOR_SCOPE };
		const other = pipeline.prepare(topology, indoor);
		expect(other.scopeAt(0)).toEqual(indoor.rootScope);
		expect(second.scopeAt(0)).toEqual(input.rootScope);
		pipeline.beginFrame();
		prepare();
		pipeline.prepare(topology, indoor);
		expect(plan).toHaveBeenCalledTimes(2);
		expect(stream).toHaveBeenCalledTimes(2);
		input.clipFromAnchor.m41 += 1;
		pipeline.beginFrame();
		prepare();
		expect(plan).toHaveBeenCalledTimes(3);
		expect(stream).toHaveBeenCalledTimes(3);
	});

	it("discards the previous preparation before a failed rebuild mutates its storage", () => {
		const pipeline = new WebGL2PortalScopeAtlasPipeline(fixtureDevice(vi.fn()));
		const topology = emptyTopology();
		const input = outdoorInput();
		pipeline.beginFrame();
		pipeline.prepare(topology, input);
		pipeline.beginFrame();
		const stream = vi
			.spyOn(PortalPropagationStreamArena.prototype, "prepare")
			.mockImplementationOnce(() => {
				throw new Error("stream preparation failed");
			});
		expect(() =>
			pipeline.prepare(topology, { ...input, rootScope: INDOOR_SCOPE }),
		).toThrow("stream preparation failed");
		// Returning to the previous key must rebuild; the failed plan had selected the indoor root.
		const recovered = pipeline.prepare(topology, input);
		expect(recovered.scopeAt(0)).toEqual(input.rootScope);
		expect(stream).toHaveBeenCalledTimes(2);
	});

	it("routes zero-crossing views directly to the output target without allocating atlas targets", () => {
		device.resize.mockClear();
		device.execute.mockClear();
		device.bindDirectRootMetadata.mockClear();
		const calls = vi.fn();
		const gl = fixtureDevice(calls);
		const pipeline = new WebGL2PortalScopeAtlasPipeline(gl);
		const outdoor = { kind: "outdoor" } as const;
		const indoor = {
			kind: "env-cell",
			landblockId: "0x0001ffff",
			envCellId: "0x00010100",
		} as const;
		const unseenIslandMember = {
			...indoor,
			envCellId: "0x00010101",
		} as const;
		const otherIsland = {
			...indoor,
			envCellId: "0x00010102",
		} as const;
		const topology: SceneTopologyView = {
			revision: 1,
			crossings: [],
			outgoing: () => [],
			scopes: [outdoor, indoor, unseenIslandMember, otherIsland].map(
				(scope) => ({
					scope,
					visibilityIslandId:
						scope.kind === "outdoor"
							? null
							: (`env-cell-island:${scope === otherIsland ? "other" : "test"}` as SceneTopologyScope["visibilityIslandId"]),
					potentiallyVisibleEnvCellIds: new Set<string>(),
				}),
			),
		};
		const anchor = getLandblockCoordinates("0x0001ffff");
		function prepare(rootScope: SceneScope, width: number) {
			const clip = Mat4.identity();
			return pipeline.prepare(topology, {
				anchorCoordinates: anchor,
				clipFromAnchor: clip,
				rootScope,
				nearClipVolume: createCameraNearClipVolume(
					{ fov: 90, near: 0.5 },
					{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
					1,
				),
				portalFootprint: {
					drawingBuffer: { width, height: 100 },
					minimumPixelArea: 0,
				},
			});
		}
		pipeline.beginFrame();
		const first = prepare(outdoor, 200);
		const firstTileWidth = first.atlas.tileWidth(0);
		const second = prepare(indoor, 400);
		expect(first).not.toBe(second);
		expect(first.scopeAt(0)).toEqual(outdoor);
		expect(second.scopeAt(0)).toEqual(indoor);
		// Coverage can admit a batch through the root while its owning cell's portal is behind
		// the camera. Tile routing resolves that owner without expanding cell traversal.
		expect(first.count).toBe(1);
		expect(second.count).toBe(1);
		expect(second.atlas.visibility.selectedScopeCount).toBe(1);
		expect(
			second.atlas.visibility.selectedScopeOrdinal(
				unseenIslandMember.envCellId,
			),
		).toBeNull();
		expect(
			second.atlas.tileOrdinalForRenderScopeKey(unseenIslandMember.envCellId),
		).toBe(second.atlas.tileOrdinalForRenderScopeKey(indoor.envCellId));
		expect(
			second.atlas.visibility.selectedRenderDomainOrdinal(
				otherIsland.envCellId,
			),
		).toBeNull();
		expect(first.atlas.tileWidth(0)).toBe(firstTileWidth);
		expect(second.atlas.tileWidth(0)).not.toBe(firstTileWidth);
		expect(calls).not.toHaveBeenCalled();
		expect(device.resize).not.toHaveBeenCalled();

		expect(
			pipeline.beginOpaqueScene(first, [0, 0, 0, 1], DIRECT_OUTPUT_FRAMEBUFFER),
		).toBeNull();
		pipeline.routeTerrainPass(3, {});
		pipeline.execute(DIRECT_OUTPUT_FRAMEBUFFER);
		pipeline.beginDeferredScene(DIRECT_OUTPUT_FRAMEBUFFER);

		expect(
			pipeline.beginOpaqueScene(
				second,
				[0, 0, 0, 1],
				DIRECT_OUTPUT_FRAMEBUFFER,
			),
		).toBeNull();
		pipeline.routeTerrainPass(0, {});
		pipeline.execute(DIRECT_OUTPUT_FRAMEBUFFER);
		pipeline.beginDeferredScene(DIRECT_OUTPUT_FRAMEBUFFER);

		expect(first.opaqueRouting.trace.terrainSubmissionCount).toBe(3);
		expect(second.opaqueRouting.trace.terrainSubmissionCount).toBe(0);
		expect(device.resize).not.toHaveBeenCalled();
		expect(device.execute).not.toHaveBeenCalled();
		expect(device.bindDirectRootMetadata).toHaveBeenCalledTimes(2);
		expect(device.bindDirectRootMetadata.mock.calls[0]).not.toEqual(
			device.bindDirectRootMetadata.mock.calls[1],
		);
		const uploadedUints = new Uint32Array(
			(device.bindDirectRootMetadata.mock.calls[0]![0] as Uint8Array).buffer,
		);
		const scopeOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		expect(uploadedUints[scopeOffset + 6]).toBe(
			PORTAL_SCOPE_TILE_UNBOUNDED_ENVELOPE_FLAG,
		);

		pipeline.beginFrame();
		expect(() => first.atlas).toThrow("no prepared frame");
		expect(() =>
			pipeline.beginOpaqueScene(
				second,
				[0, 0, 0, 1],
				DIRECT_OUTPUT_FRAMEBUFFER,
			),
		).toThrow("not prepared");
		expect(prepare(otherIsland, 200)).toBe(first);
		expect(first.count).toBe(1);
		expect(first.scopeAt(0)).toEqual(otherIsland);
		expect(
			first.atlas.visibility.selectedRenderDomainOrdinal(indoor.envCellId),
		).toBeNull();
	});

	it("allocates atlas targets only during execution and scissors clears to active tiles", () => {
		device.resize.mockClear();
		device.execute.mockClear();
		device.bindDirectRootMetadata.mockClear();
		const scissor = vi.fn();
		const bindTexture = vi.fn();
		const gl = {
			...fixtureDevice(vi.fn()),
			scissor,
			bindTexture,
		} as unknown as WebGL2RenderingContext;
		const pipeline = new WebGL2PortalScopeAtlasPipeline(gl);
		const crossing = singleOutdoorToIndoorCrossing();
		const topology: SceneTopologyView = {
			revision: 1,
			crossings: [crossing],
			outgoing: (scope) => (scope.kind === "outdoor" ? [crossing] : []),
			scopes: [
				{
					scope: { kind: "outdoor" },
					visibilityIslandId: null,
					potentiallyVisibleEnvCellIds: new Set<string>(),
				},
				{
					scope: INDOOR_SCOPE,
					visibilityIslandId: "env-cell-island:test",
					potentiallyVisibleEnvCellIds: new Set<string>(),
				},
			],
		};
		pipeline.beginFrame();
		const prepared = pipeline.prepare(topology, outdoorInput());
		expect(prepared.atlas.commands.traversalDepth).toBe(1);
		expect(device.resize).not.toHaveBeenCalled();

		const clearColor = [0.1, 0.2, 0.3, 1] as const;
		const targets = pipeline.beginOpaqueScene(
			prepared,
			clearColor,
			DIRECT_OUTPUT_FRAMEBUFFER,
		);
		expect(targets).not.toBeNull();
		expect(device.resize).toHaveBeenCalledTimes(1);
		expect(scissor.mock.calls).toEqual(
			Array.from({ length: prepared.atlas.tileCount }, (_, ordinal) => [
				prepared.atlas.tileX(ordinal),
				prepared.atlas.tileY(ordinal),
				prepared.atlas.tileWidth(ordinal),
				prepared.atlas.tileHeight(ordinal),
			]),
		);
		const clearedPixels = Array.from(
			{ length: prepared.atlas.tileCount },
			(_, ordinal) =>
				prepared.atlas.tileWidth(ordinal) * prepared.atlas.tileHeight(ordinal),
		).reduce((sum, area) => sum + area, 0);
		expect(clearedPixels).toBeLessThan(
			prepared.atlas.packedWidth * prepared.atlas.packedHeight,
		);

		pipeline.execute(DIRECT_OUTPUT_FRAMEBUFFER);
		pipeline.beginDeferredScene(DIRECT_OUTPUT_FRAMEBUFFER);
		expect(device.execute).toHaveBeenCalledTimes(1);
		expect(device.execute.mock.calls[0]![0]).toMatchObject({
			clearColor,
		});
		expect(device.bindDirectRootMetadata).not.toHaveBeenCalled();
		expect(bindTexture).toHaveBeenCalledWith(undefined, ENVELOPE_TEXTURE);
	});
});

function singleOutdoorToIndoorCrossing(): ScenePortalCrossing {
	const vertices = new Float32Array([
		-0.25, -0.25, 0, 0.25, -0.25, 0, 0.25, 0.25, 0, -0.25, 0.25, 0,
	]);
	const aperture = {
		id: "portal-aperture:test" as const,
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		landblockBounds: new AABB3(
			new Vec3(-0.25, -0.25, 0),
			new Vec3(0.25, 0.25, 0),
		),
		landblockId: "0x0001ffff" as const,
		plane: { d: 0, normal: new Vec3(0, 0, 1) },
		vertices,
	};
	return {
		acceptedSide: "positive",
		exactMatch: true,
		id: "portal-crossing:test",
		junctionGroupId: null,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId: null,
		source: { kind: "outdoor" },
		sourceAperture: aperture,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "test",
		},
		target: INDOOR_SCOPE,
		visibilityAperture: aperture,
	};
}

function emptyTopology(): SceneTopologyView {
	return {
		revision: 1,
		crossings: [],
		outgoing: () => [],
		scopes: [
			{
				scope: { kind: "outdoor" },
				visibilityIslandId: null,
				potentiallyVisibleEnvCellIds: new Set<string>(),
			},
			{
				scope: INDOOR_SCOPE,
				visibilityIslandId: "env-cell-island:test",
				potentiallyVisibleEnvCellIds: new Set<string>(),
			},
		],
	};
}

function outdoorInput() {
	return {
		anchorCoordinates: getLandblockCoordinates("0x0001ffff"),
		clipFromAnchor: Mat4.identity(),
		rootScope: { kind: "outdoor" } as const,
		nearClipVolume: createCameraNearClipVolume(
			{ fov: 90, near: 0.5 },
			{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
			1,
		),
		portalFootprint: {
			drawingBuffer: { width: 200, height: 100 },
			minimumPixelArea: 0,
		},
	};
}

function fixtureDevice(
	calls: ReturnType<typeof vi.fn>,
): WebGL2RenderingContext {
	return {
		activeTexture: calls,
		bindFramebuffer: calls,
		bindSampler: calls,
		bindTexture: calls,
		viewport: calls,
		disable: calls,
		enable: calls,
		scissor: calls,
		colorMask: calls,
		depthFunc: calls,
		depthMask: calls,
		clearDepth: calls,
		clearColor: calls,
		clear: calls,
		uniform4f: calls,
	} as unknown as WebGL2RenderingContext;
}
