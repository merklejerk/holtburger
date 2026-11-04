import { afterEach, describe, expect, it, vi } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { Mat4, Quat, Vec3 } from "../math/types";
import type {
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import { createCameraNearClipVolume } from "./portal-near-plane";
import type { PortalPropagationStreamView } from "./portal-crossing-triangle-stream";
import { WebGL2PortalScopeAtlasPipeline } from "./webgl2-portal-scope-atlas-pipeline";
import { PortalScopeAtlasPlanner } from "./portal-scope-atlas-planner";
import { PortalPropagationStreamArena } from "./portal-crossing-triangle-stream";

const INDOOR_SCOPE = {
	kind: "env-cell",
	landblockId: "0x0001ffff",
	envCellId: "0x00010100",
} as const;

afterEach(() => vi.restoreAllMocks());

const device = vi.hoisted(() => ({ resize: vi.fn(), execute: vi.fn() }));

// Keep real visibility, packing, routing, and CPU streams; replace only GPU resource owners.
vi.mock("./webgl2-portal-scope-atlas-targets", () => ({
	WebGL2PortalScopeAtlasTargets: class {
		resize(extents: { atlas: { width: number; height: number } }) {
			device.resize(extents);
			return { extents, scene: { framebuffer: null } };
		}
	},
}));
vi.mock("./webgl2-portal-scope-atlas-executor", () => ({
	WebGL2PortalScopeAtlasExecutor: class {
		execute(input: { stream: PortalPropagationStreamView }) {
			device.execute(input.stream.propagationMetadataBytes.slice());
		}
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
		pipeline.beginOpaqueScene(first, [0, 0, 0, 1]);
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
	it("preserves per-view plans and streams, allocating targets only during execution", () => {
		device.resize.mockClear();
		device.execute.mockClear();
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
		pipeline.beginOpaqueScene(first, [0, 0, 0, 1]);
		pipeline.routeTerrainPass(3, {});
		pipeline.execute(null);
		pipeline.beginOpaqueScene(second, [0, 0, 0, 1]);
		pipeline.routeTerrainPass(0, {});
		pipeline.execute(null);
		expect(first.opaqueRouting.trace.terrainSubmissionCount).toBe(3);
		expect(second.opaqueRouting.trace.terrainSubmissionCount).toBe(0);
		expect(device.resize).toHaveBeenCalledTimes(2);
		expect(device.execute.mock.calls[0]).not.toEqual(
			device.execute.mock.calls[1],
		);
		pipeline.beginFrame();
		expect(() => first.atlas).toThrow("no prepared frame");
		expect(() => pipeline.beginOpaqueScene(second, [0, 0, 0, 1])).toThrow(
			"not prepared",
		);
		expect(prepare(otherIsland, 200)).toBe(first);
		expect(first.count).toBe(1);
		expect(first.scopeAt(0)).toEqual(otherIsland);
		expect(
			first.atlas.visibility.selectedRenderDomainOrdinal(indoor.envCellId),
		).toBeNull();
	});
});

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
		bindFramebuffer: calls,
		viewport: calls,
		disable: calls,
		enable: calls,
		colorMask: calls,
		depthFunc: calls,
		depthMask: calls,
		clearDepth: calls,
		clearColor: calls,
		clear: calls,
		uniform4f: calls,
	} as unknown as WebGL2RenderingContext;
}
